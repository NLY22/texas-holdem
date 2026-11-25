import { DurableObject } from "cloudflare:workers";
import {
  addBotToSeat,
  addPlayerToSeat,
  applyTimeoutAction,
  clearAllBots,
  createInitialState,
  dissolveRoomRollback,
  getNextPlayerIndex,
  handlePlayerAction,
  leaveSeat,
  rebuyOrTopUpPlayer,
  removeOrToggleBot,
  resetTableForNewRound,
  revealEarlyWinCards,
  revealRabbitHunt,
  sitPlayerAtSeat,
  startNewHand,
  syncLedger,
  togglePlayerSitOut,
} from "../src/engine/state-machine";
import { getBotAction } from "../src/engine/bot";
import { Card, DEFAULT_ROOM_CONFIG, GameState, RoomConfig } from "../src/types/poker";

const ROOM_TTL_MS = 60 * 60 * 1000; // 60 分钟完全无人活跃才过期
const DISCONNECT_GRACE_MS = 90 * 1000; // 断线 90 秒标为 DISCONNECTED（保留席位和筹码）
const HOST_FAILOVER_MS = 120 * 1000; // 房主彻底失联 120 秒自动顺延移交

interface RoomRecord {
  active: boolean;
  createdAt: number;
  lastActiveAt: number;
  state: GameState | null;
  deck: Card[];
  botActAt?: number;
  turnDeadline?: number;
  autoNextAt?: number;
  disconnectDeadlines: Record<string, number>;
  hostFailoverAt?: number;
}

function maskStateForPeer(state: GameState, peerId: string): GameState {
  const maskedPlayers = state.players.map((p) => {
    if (!p) return null;
    if (p.id === peerId || p.showCards) {
      return p;
    }
    return {
      ...p,
      holeCards: Array.isArray(p.holeCards)
        ? p.holeCards.map(() => ({ suit: "spades" as const, rank: 0 }))
        : [],
    };
  });
  return { ...state, players: maskedPlayers };
}

function sendJson(ws: WebSocket, payload: unknown): boolean {
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export class PokerRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("PING", "PONG"));
  }

  private async getRecord(): Promise<RoomRecord> {
    const rec = await this.ctx.storage.get<RoomRecord>("roomRecord");
    return (
      rec || {
        active: false,
        createdAt: 0,
        lastActiveAt: 0,
        state: null,
        deck: [],
        disconnectDeadlines: {},
      }
    );
  }

  private refreshTimers(rec: RoomRecord) {
    const state = rec.state;
    if (!rec.active || !state) {
      rec.botActAt = undefined;
      rec.turnDeadline = undefined;
      rec.autoNextAt = undefined;
      return;
    }

    const now = Date.now();
    const cfg = state.config || DEFAULT_ROOM_CONFIG;

    if (
      state.stage !== "WAITING" &&
      state.stage !== "SHOWDOWN" &&
      state.activePlayerIndex !== -1
    ) {
      rec.autoNextAt = undefined;
      const activePlayer = state.players[state.activePlayerIndex];
      if (activePlayer?.isBot) {
        rec.botActAt = now + 850;
        rec.turnDeadline = undefined;
        state.turnDeadline = undefined;
      } else {
        rec.botActAt = undefined;
        if (cfg.actionTimeoutSec > 0) {
          const deadline = state.turnDeadline && state.turnDeadline > now
            ? state.turnDeadline
            : now + cfg.actionTimeoutSec * 1000;
          rec.turnDeadline = deadline;
          state.turnDeadline = deadline;
        } else {
          rec.turnDeadline = undefined;
          state.turnDeadline = undefined;
        }
      }
      state.nextHandDeadline = undefined;
    } else if (state.stage === "SHOWDOWN" && cfg.autoNextHand) {
      rec.botActAt = undefined;
      rec.turnDeadline = undefined;
      state.turnDeadline = undefined;
      const eligibleCount = state.players.filter(
        (p) => p && p.chips > 0 && (p.status || "ACTIVE") === "ACTIVE" && !p.removeAfterHand && !p.sitOutAfterHand
      ).length;
      if (eligibleCount >= 2) {
        const nextAt = state.nextHandDeadline && state.nextHandDeadline > now
          ? state.nextHandDeadline
          : now + 5000;
        rec.autoNextAt = nextAt;
        state.nextHandDeadline = nextAt;
      } else {
        rec.autoNextAt = undefined;
        state.nextHandDeadline = undefined;
      }
    } else {
      rec.botActAt = undefined;
      rec.turnDeadline = undefined;
      rec.autoNextAt = undefined;
      state.turnDeadline = undefined;
      state.nextHandDeadline = undefined;
    }
  }

  private async saveAndSchedule(rec: RoomRecord) {
    rec.lastActiveAt = Date.now();
    await this.ctx.storage.put("roomRecord", rec);

    const candidates: number[] = [];
    if (rec.botActAt) candidates.push(rec.botActAt);
    if (rec.turnDeadline) candidates.push(rec.turnDeadline);
    if (rec.autoNextAt) candidates.push(rec.autoNextAt);
    if (rec.hostFailoverAt) candidates.push(rec.hostFailoverAt);
    for (const ts of Object.values(rec.disconnectDeadlines)) {
      candidates.push(ts);
    }

    if (candidates.length > 0) {
      const nextAlarm = Math.max(Math.min(...candidates), Date.now() + 250);
      await this.ctx.storage.setAlarm(nextAlarm);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private getSocketsByPeer(peerId: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const att = ws.deserializeAttachment() as { peerId?: string } | null;
      return att?.peerId === peerId;
    });
  }

  private broadcastState(state: GameState) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as { peerId?: string } | null;
      if (!att?.peerId) continue;
      sendJson(ws, {
        type: "STATE_UPDATE",
        state: maskStateForPeer(state, att.peerId),
      });
    }
  }

  private broadcastAll(payload: unknown) {
    for (const ws of this.ctx.getWebSockets()) {
      sendJson(ws, payload);
    }
  }

  private onHandMutation(rec: RoomRecord, prevHostId: string | undefined, prevActiveIndex: number | undefined) {
    if (!rec.state) return;
    if (rec.state.activePlayerIndex !== prevActiveIndex) {
      rec.state.turnDeadline = undefined;
    }
    this.refreshTimers(rec);
    this.broadcastState(rec.state);
    if (prevHostId && rec.state.hostId !== prevHostId) {
      const newHost = rec.state.players.find((p) => p?.id === rec.state!.hostId);
      if (newHost) {
        this.broadcastAll({ type: "TOAST", text: `房主已变更为 ${newHost.name}` });
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      const rec = await this.getRecord();
      return Response.json(
        {
          ok: true,
          active: rec.active,
          players: rec.state?.players.filter(Boolean).length || 0,
        },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const url = new URL(request.url);
    const roomId = (url.searchParams.get("roomId") || "TX-0000").toUpperCase();
    const peerId = (url.searchParams.get("peerId") || "").trim();
    const mode = url.searchParams.get("mode") || "join"; // create | join | reattach
    const name = (url.searchParams.get("name") || "玩家").slice(0, 16);
    const configRaw = url.searchParams.get("config");

    if (!peerId) {
      return new Response("Missing peerId", { status: 400 });
    }

    const pair = new WebSocketPair();
    const clientWs = pair[0];
    const serverWs = pair[1];

    const rec = await this.getRecord();
    const now = Date.now();
    const isExpired = rec.lastActiveAt > 0 && now - rec.lastActiveAt > ROOM_TTL_MS;

    if (mode === "create") {
      const hasOnlineSockets = this.ctx.getWebSockets().length > 0;
      if (rec.active && !isExpired && hasOnlineSockets && rec.state?.hostId !== peerId) {
        this.ctx.acceptWebSocket(serverWs);
        sendJson(serverWs, {
          type: "ROOM_ERROR",
          error: "该房间号正在使用中，请重新生成房号",
        });
        serverWs.close(4001, "ROOM_IN_USE");
        return new Response(null, { status: 101, webSocket: clientWs });
      }

      // 清理旧连接
      for (const oldWs of this.ctx.getWebSockets()) {
        sendJson(oldWs, { type: "ROOM_ERROR", error: "房间已重新开启" });
        try {
          oldWs.close(4000, "ROOM_RESET");
        } catch {}
      }

      let customConfig: Partial<RoomConfig> | undefined;
      if (configRaw) {
        try {
          customConfig = JSON.parse(configRaw);
        } catch {}
      }

      let initState = createInitialState(roomId, peerId, customConfig);
      initState = addPlayerToSeat(initState, { id: peerId, name }).state;

      rec.active = true;
      rec.createdAt = now;
      rec.state = initState;
      rec.deck = [];
      rec.disconnectDeadlines = {};
      rec.hostFailoverAt = undefined;
      this.refreshTimers(rec);

      this.ctx.acceptWebSocket(serverWs);
      serverWs.serializeAttachment({ peerId, name, explicitLeave: false });

      sendJson(serverWs, { type: "ROOM_READY", peerId, reattached: false });
      sendJson(serverWs, {
        type: "STATE_UPDATE",
        state: maskStateForPeer(initState, peerId),
      });

      await this.saveAndSchedule(rec);
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    // join 或 reattach
    if (!rec.active || isExpired || !rec.state) {
      this.ctx.acceptWebSocket(serverWs);
      sendJson(serverWs, {
        type: "ROOM_ERROR",
        error: "房间不存在或已解散，请核对房间号",
      });
      serverWs.close(4004, "ROOM_NOT_FOUND");
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    const alreadySeated = rec.state.players.some((p) => p?.id === peerId);
    if (mode === "reattach" && !alreadySeated) {
      this.ctx.acceptWebSocket(serverWs);
      sendJson(serverWs, {
        type: "ROOM_ERROR",
        error: "您已不在该房间座位中，请重新输入房号加入",
      });
      serverWs.close(4004, "NOT_IN_ROOM");
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    // 替换同 peerId 的旧 socket
    for (const oldWs of this.getSocketsByPeer(peerId)) {
      const att = oldWs.deserializeAttachment() as { explicitLeave?: boolean; peerId?: string } | null;
      if (att) {
        att.explicitLeave = true;
        oldWs.serializeAttachment(att);
      }
      try {
        oldWs.close(4002, "REPLACED");
      } catch {}
    }

    delete rec.disconnectDeadlines[peerId];
    if (rec.state.hostId === peerId) {
      rec.hostFailoverAt = undefined;
    }

    const joinRes = addPlayerToSeat(rec.state, { id: peerId, name });
    if (!joinRes.joined) {
      this.ctx.acceptWebSocket(serverWs);
      sendJson(serverWs, {
        type: "ROOM_ERROR",
        error: joinRes.error || "加入房间失败",
      });
      serverWs.close(4003, "ROOM_FULL");
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    rec.state = joinRes.state;
    this.ctx.acceptWebSocket(serverWs);
    serverWs.serializeAttachment({ peerId, name, explicitLeave: false });

    sendJson(serverWs, {
      type: "ROOM_READY",
      peerId,
      reattached: mode === "reattach" || alreadySeated,
    });
    this.broadcastState(rec.state);

    await this.saveAndSchedule(rec);
    return new Response(null, { status: 101, webSocket: clientWs });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer) {
    if (typeof rawMessage !== "string") return;
    if (rawMessage === "PING") {
      ws.send("PONG");
      return;
    }

    let msg: any;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const att = ws.deserializeAttachment() as { peerId: string; name: string; explicitLeave?: boolean } | null;
    if (!att?.peerId) return;

    const rec = await this.getRecord();
    if (!rec.active || !rec.state) return;

    const peerId = att.peerId;
    const isHost = rec.state.hostId === peerId;
    const prevHostId = rec.state.hostId;
    const prevActiveIdx = rec.state.activePlayerIndex;

    switch (msg.type) {
      case "PLAYER_ACTION": {
        if (!msg.action) return;
        const safeAction = { ...msg.action, playerId: peerId };
        const res = handlePlayerAction(rec.state, safeAction, rec.deck);
        rec.state = res.state;
        rec.deck = res.deck;
        this.onHandMutation(rec, prevHostId, prevActiveIdx);
        await this.saveAndSchedule(rec);
        break;
      }

      case "START_HAND": {
        if (!isHost) return;
        const res = startNewHand(rec.state);
        rec.state = res.state;
        rec.deck = res.deck;
        this.onHandMutation(rec, prevHostId, prevActiveIdx);
        await this.saveAndSchedule(rec);
        break;
      }

      case "ADD_BOT": {
        if (!isHost) return;
        rec.state = addBotToSeat(rec.state, msg.seatIndex, msg.personality);
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "REMOVE_BOT": {
        if (!isHost || typeof msg.seatIndex !== "number") return;
        rec.state = removeOrToggleBot(rec.state, msg.seatIndex);
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "CLEAR_BOTS": {
        if (!isHost) return;
        rec.state = clearAllBots(rec.state);
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "SIT_AT_SEAT": {
        if (typeof msg.seatIndex !== "number") return;
        rec.state = sitPlayerAtSeat(rec.state, peerId, msg.seatIndex);
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "TOGGLE_SIT_OUT": {
        rec.state = togglePlayerSitOut(rec.state, peerId);
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "REBUY_REQUEST": {
        rec.state = rebuyOrTopUpPlayer(rec.state, peerId, msg.mode === "topup" ? "topup" : "rebuy");
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "UPDATE_CONFIG": {
        if (!isHost || !msg.config) return;
        const nextCfg: RoomConfig = {
          ...(rec.state.config || DEFAULT_ROOM_CONFIG),
          ...msg.config,
        };
        rec.state = {
          ...rec.state,
          config: nextCfg,
          ...(rec.state.stage === "WAITING"
            ? {
                smallBlind: nextCfg.smallBlind,
                bigBlind: nextCfg.bigBlind,
                ante: nextCfg.ante,
                minRaise: nextCfg.bigBlind,
              }
            : {}),
        };
        this.refreshTimers(rec);
        this.broadcastState(rec.state);
        this.broadcastAll({
          type: "TOAST",
          text: rec.state.stage === "WAITING" ? "房间设置已生效" : "房间设置已更新（盲注将在下一手生效）",
        });
        await this.saveAndSchedule(rec);
        break;
      }

      case "TRANSFER_HOST": {
        if (!isHost || !msg.targetPlayerId) return;
        const target = rec.state.players.find((p) => p?.id === msg.targetPlayerId && !p.isBot);
        if (!target) return;
        rec.state = { ...rec.state, hostId: target.id };
        rec.hostFailoverAt = undefined;
        this.broadcastState(rec.state);
        this.broadcastAll({ type: "TOAST", text: `房主已移交给 ${target.name}` });
        await this.saveAndSchedule(rec);
        break;
      }

      case "KICK_PLAYER": {
        if (!isHost || typeof msg.seatIndex !== "number") return;
        const target = rec.state.players[msg.seatIndex];
        if (!target || target.id === peerId || target.isBot) return;
        const res = leaveSeat(rec.state, target.id, rec.deck);
        rec.state = res.state;
        rec.deck = res.deck;
        delete rec.disconnectDeadlines[target.id];

        for (const tWs of this.getSocketsByPeer(target.id)) {
          const tAtt = tWs.deserializeAttachment() as { explicitLeave?: boolean } | null;
          if (tAtt) {
            tAtt.explicitLeave = true;
            tWs.serializeAttachment(tAtt);
          }
          sendJson(tWs, { type: "KICKED", error: "您已被房主请离房间" });
          try {
            tWs.close(4005, "KICKED");
          } catch {}
        }

        this.onHandMutation(rec, prevHostId, prevActiveIdx);
        this.broadcastAll({ type: "TOAST", text: `${target.name} 已离开牌桌` });
        await this.saveAndSchedule(rec);
        break;
      }

      case "SHOW_WINNER_CARDS": {
        rec.state = revealEarlyWinCards(rec.state, peerId);
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "RABBIT_HUNT": {
        rec.state = revealRabbitHunt(rec.state, rec.deck);
        this.broadcastState(rec.state);
        await this.saveAndSchedule(rec);
        break;
      }

      case "QUICK_CHAT": {
        const text = String(msg.text || "").trim().slice(0, 32);
        if (!text) return;
        const player = rec.state.players.find((p) => p?.id === peerId);
        this.broadcastAll({
          type: "QUICK_CHAT",
          event: {
            id: Math.random().toString(36).slice(2, 9),
            playerId: peerId,
            name: player?.name || att.name,
            text,
            timestamp: Date.now(),
          },
        });
        break;
      }

      case "RESET_TABLE": {
        if (!isHost) return;
        rec.state = resetTableForNewRound(rec.state);
        rec.deck = [];
        this.refreshTimers(rec);
        this.broadcastState(rec.state);
        this.broadcastAll({ type: "TOAST", text: `第 ${rec.state.roundNumber} 轮开始，全员筹码已重置` });
        await this.saveAndSchedule(rec);
        break;
      }

      case "PLAYER_LEAVE": {
        att.explicitLeave = true;
        ws.serializeAttachment(att);
        delete rec.disconnectDeadlines[peerId];
        if (peerId === rec.state.hostId) {
          rec.hostFailoverAt = undefined;
        }
        const res = leaveSeat(rec.state, peerId, rec.deck);
        rec.state = res.state;
        rec.deck = res.deck;

        sendJson(ws, { type: "LEFT_CONFIRMED", ledger: rec.state.ledger });
        try {
          ws.close(1000, "PLAYER_LEAVE");
        } catch {}

        // 若桌内已无任何真人，直接休眠/标记等待或销毁
        const remainingHumans = rec.state.players.filter((p) => p && !p.isBot);
        if (remainingHumans.length === 0) {
          rec.active = false;
        } else {
          this.onHandMutation(rec, prevHostId, prevActiveIdx);
          this.broadcastAll({ type: "TOAST", text: `${att.name} 已离桌结算` });
        }
        await this.saveAndSchedule(rec);
        break;
      }

      case "DISSOLVE_ROOM": {
        if (!isHost) return;
        const finalState = dissolveRoomRollback(rec.state);
        rec.state = finalState;
        rec.active = false;
        rec.deck = [];
        rec.botActAt = undefined;
        rec.turnDeadline = undefined;
        rec.autoNextAt = undefined;
        rec.hostFailoverAt = undefined;
        rec.disconnectDeadlines = {};

        for (const clientWs of this.ctx.getWebSockets()) {
          const cAtt = clientWs.deserializeAttachment() as { explicitLeave?: boolean } | null;
          if (cAtt) {
            cAtt.explicitLeave = true;
            clientWs.serializeAttachment(cAtt);
          }
          sendJson(clientWs, {
            type: "ROOM_DISSOLVED",
            ledger: finalState.ledger || {},
            roundNumber: finalState.roundNumber || 1,
            handNumber: finalState.handNumber || 0,
            error: "房主已散场解散房间",
          });
          try {
            clientWs.close(4000, "DISSOLVED");
          } catch {}
        }
        await this.saveAndSchedule(rec);
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as { peerId?: string; explicitLeave?: boolean } | null;
    if (!att?.peerId || att.explicitLeave) return;

    const rec = await this.getRecord();
    if (!rec.active || !rec.state) return;

    const stillOpen = this.getSocketsByPeer(att.peerId).some((s) => s !== ws);
    if (stillOpen) return;

    const now = Date.now();
    rec.disconnectDeadlines[att.peerId] = now + DISCONNECT_GRACE_MS;
    if (rec.state.hostId === att.peerId) {
      rec.hostFailoverAt = now + HOST_FAILOVER_MS;
    }
    await this.saveAndSchedule(rec);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    const rec = await this.getRecord();
    if (!rec.active || !rec.state) return;

    const now = Date.now();
    let changed = false;
    const prevHostId = rec.state.hostId;
    const prevActiveIdx = rec.state.activePlayerIndex;

    // 1. 断线宽限超时：仅标记 DISCONNECTED（不丢筹码），并在当前回合已开启限时时允许继续推进
    for (const [peerId, deadline] of Object.entries(rec.disconnectDeadlines)) {
      if (this.getSocketsByPeer(peerId).length > 0) {
        delete rec.disconnectDeadlines[peerId];
        changed = true;
      } else if (now >= deadline) {
        delete rec.disconnectDeadlines[peerId];
        rec.state = syncLedger({
          ...rec.state,
          players: rec.state.players.map((p) =>
            p && p.id === peerId ? { ...p, status: "DISCONNECTED" } : p
          ),
        });
        changed = true;

        // 若正好轮到断线玩家且房间原本是不限时模式，为了不永久锁死牌桌，超过 90s 断线也代为托管一次
        const activeP = rec.state.players[rec.state.activePlayerIndex];
        if (activeP?.id === peerId) {
          const res = applyTimeoutAction(rec.state, rec.deck);
          rec.state = res.state;
          rec.deck = res.deck;
        }
      }
    }

    // 2. 房主失联超过 120s 自动顺延移交房主权限
    if (rec.hostFailoverAt && now >= rec.hostFailoverAt) {
      rec.hostFailoverAt = undefined;
      const curHostOnline = this.getSocketsByPeer(rec.state.hostId).length > 0;
      if (!curHostOnline) {
        const curHostIdx = rec.state.players.findIndex((p) => p?.id === rec.state!.hostId);
        const nextIdx = getNextPlayerIndex(
          rec.state.players,
          curHostIdx,
          (p) => !p.isBot && this.getSocketsByPeer(p.id).length > 0
        );
        if (nextIdx !== -1 && rec.state.players[nextIdx]) {
          rec.state = { ...rec.state, hostId: rec.state.players[nextIdx]!.id };
          changed = true;
        }
      }
    }

    // 3. AI Bot 自动出牌
    if (rec.botActAt && now >= rec.botActAt) {
      rec.botActAt = undefined;
      const activeP = rec.state.players[rec.state.activePlayerIndex];
      if (
        rec.state.stage !== "WAITING" &&
        rec.state.stage !== "SHOWDOWN" &&
        activeP?.isBot &&
        !activeP.folded &&
        !activeP.isAllIn
      ) {
        const botAction = getBotAction(rec.state, activeP);
        const res = handlePlayerAction(rec.state, botAction, rec.deck);
        rec.state = res.state;
        rec.deck = res.deck;
        changed = true;
      }
    }

    // 4. 玩家行动倒计时超时托管
    if (rec.turnDeadline && now >= rec.turnDeadline) {
      rec.turnDeadline = undefined;
      if (rec.state.stage !== "WAITING" && rec.state.stage !== "SHOWDOWN") {
        const res = applyTimeoutAction(rec.state, rec.deck);
        rec.state = res.state;
        rec.deck = res.deck;
        changed = true;
      }
    }

    // 5. 自动续局（开启 autoNextHand 时 5 秒自动下一手）
    if (rec.autoNextAt && now >= rec.autoNextAt) {
      rec.autoNextAt = undefined;
      if (rec.state.stage === "SHOWDOWN") {
        const res = startNewHand(rec.state);
        rec.state = res.state;
        rec.deck = res.deck;
        changed = true;
      }
    }

    if (changed) {
      this.onHandMutation(rec, prevHostId, prevActiveIdx);
    } else {
      this.refreshTimers(rec);
    }
    await this.saveAndSchedule(rec);
  }
}

export default {
  async fetch(request: Request, env: { POKER_ROOMS: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json(
        { ok: true, service: "texas-holdem-ws", authoritative: true, timestamp: Date.now() },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Za-z0-9_-]{2,32})$/);
    if (wsMatch) {
      const roomId = wsMatch[1].toUpperCase();
      const id = env.POKER_ROOMS.idFromName(roomId);
      const stub = env.POKER_ROOMS.get(id);
      const forwardUrl = new URL(request.url);
      forwardUrl.searchParams.set("roomId", roomId);
      return stub.fetch(new Request(forwardUrl.toString(), request));
    }

    return new Response("Not Found", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  },
};
