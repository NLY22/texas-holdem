import { DurableObject } from "cloudflare:workers";

const ROOM_TTL_MS = 30 * 60 * 1000; // 30 minutes idle expiry for abandoned rooms
const DISCONNECT_GRACE_MS = 90 * 1000; // 90s grace for mobile WeChat switching

function maskStateForPeer(state, peerId) {
  if (!state || !Array.isArray(state.players)) return state;
  const maskedPlayers = state.players.map((p) => {
    if (!p) return null;
    if (p.id === peerId || p.showCards) {
      return p;
    }
    return {
      ...p,
      holeCards: Array.isArray(p.holeCards)
        ? p.holeCards.map(() => ({ suit: "spades", rank: 0 }))
        : [],
    };
  });
  return { ...state, players: maskedPlayers };
}

function sendJson(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export class PokerRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Edge-level auto ping/pong keeps mobile carrier NAT open without waking DO
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("PING", "PONG"));
  }

  async getRoomData() {
    const data = await this.ctx.storage.get("roomData");
    return (
      data || {
        active: false,
        hostId: null,
        createdAt: 0,
        lastActiveAt: 0,
        lastState: null,
        privateCards: {},
        hostQueue: [],
        disconnectedPeers: {},
      }
    );
  }

  async saveRoomData(data) {
    data.lastActiveAt = Date.now();
    await this.ctx.storage.put("roomData", data);
  }

  getSocketsByRole(role, peerId = null) {
    return this.ctx.getWebSockets().filter((ws) => {
      const att = ws.deserializeAttachment();
      if (!att || att.role !== role) return false;
      if (peerId !== null && att.peerId !== peerId) return false;
      return true;
    });
  }

  sendToHost(data, payload) {
    const hosts = this.getSocketsByRole("host");
    let delivered = false;
    for (const ws of hosts) {
      if (sendJson(ws, payload)) {
        delivered = true;
      }
    }
    if (!delivered) {
      // Host temporarily backgrounded (e.g. switched to WeChat) — queue up to 50 events
      data.hostQueue.push(payload);
      if (data.hostQueue.length > 50) {
        data.hostQueue.shift();
      }
      return false;
    }
    return true;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      const data = await this.getRoomData();
      return Response.json(
        {
          ok: true,
          active: data.active,
          clients: this.getSocketsByRole("client").length,
          hostConnected: this.getSocketsByRole("host").length > 0,
        },
        {
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "client";
    const peerId = (url.searchParams.get("peerId") || "").trim();
    const mode = url.searchParams.get("mode") || (role === "host" ? "create" : "join");
    const name = url.searchParams.get("name") || "玩家";

    if (!peerId) {
      return new Response("Missing peerId", { status: 400 });
    }

    const pair = new WebSocketPair();
    const clientWs = pair[0];
    const serverWs = pair[1];

    const data = await this.getRoomData();
    const now = Date.now();
    const isExpired = data.lastActiveAt > 0 && now - data.lastActiveAt > ROOM_TTL_MS;

    if (role === "host") {
      const existingHosts = this.getSocketsByRole("host").filter((ws) => {
        const att = ws.deserializeAttachment();
        return att && att.peerId !== peerId;
      });

      if (mode === "create" && data.active && !isExpired && existingHosts.length > 0) {
        this.ctx.acceptWebSocket(serverWs);
        sendJson(serverWs, {
          type: "ROOM_ERROR",
          error: "该房间号正在使用中，请换一个 4 位房间号",
        });
        serverWs.close(4001, "ROOM_IN_USE");
        return new Response(null, { status: 101, webSocket: clientWs });
      }

      if (mode === "create" || isExpired || !data.active) {
        // Close any stale sockets from an expired previous room
        for (const oldWs of this.ctx.getWebSockets()) {
          sendJson(oldWs, { type: "ROOM_CLOSED", error: "房间已重置" });
          try {
            oldWs.close(4000, "ROOM_RESET");
          } catch {}
        }
        data.active = true;
        data.hostId = peerId;
        data.createdAt = now;
        data.lastState = null;
        data.privateCards = {};
        data.hostQueue = [];
        data.disconnectedPeers = {};
      } else {
        // Reattach existing host after network drop / WeChat switch
        data.active = true;
        data.hostId = peerId;
        for (const oldHost of this.getSocketsByRole("host")) {
          try {
            oldHost.close(4002, "HOST_REPLACED");
          } catch {}
        }
      }

      this.ctx.acceptWebSocket(serverWs);
      serverWs.serializeAttachment({
        role: "host",
        peerId,
        explicitLeave: false,
      });

      sendJson(serverWs, {
        type: "ROOM_READY",
        role: "host",
        peerId,
        reattached: mode === "reattach",
      });

      if (data.hostQueue.length > 0) {
        const queued = [...data.hostQueue];
        data.hostQueue = [];
        for (const item of queued) {
          sendJson(serverWs, item);
        }
      }

      await this.saveRoomData(data);
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    // Client connection
    if (!data.active || isExpired) {
      this.ctx.acceptWebSocket(serverWs);
      sendJson(serverWs, {
        type: "ROOM_ERROR",
        error: "房间不存在，请核对房间号或让房主先创建房间",
      });
      serverWs.close(4004, "ROOM_NOT_FOUND");
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    // Replace any stale socket with same peerId
    for (const oldClient of this.getSocketsByRole("client", peerId)) {
      const att = oldClient.deserializeAttachment();
      if (att) {
        att.explicitLeave = true;
        oldClient.serializeAttachment(att);
      }
      try {
        oldClient.close(4002, "CLIENT_REPLACED");
      } catch {}
    }

    if (data.disconnectedPeers[peerId]) {
      delete data.disconnectedPeers[peerId];
    }

    this.ctx.acceptWebSocket(serverWs);
    serverWs.serializeAttachment({
      role: "client",
      peerId,
      name,
      explicitLeave: false,
    });

    sendJson(serverWs, {
      type: "ROOM_READY",
      role: "client",
      peerId,
      reattached: mode === "reattach",
    });

    if (mode === "reattach" && data.lastState) {
      sendJson(serverWs, {
        type: "STATE_UPDATE",
        state: maskStateForPeer(data.lastState, peerId),
      });
      const cards = data.privateCards?.[peerId];
      if (Array.isArray(cards) && cards.length > 0) {
        sendJson(serverWs, {
          type: "DEAL_CARDS",
          cards,
        });
      }
    }

    await this.saveRoomData(data);
    return new Response(null, { status: 101, webSocket: clientWs });
  }

  async webSocketMessage(ws, rawMessage) {
    if (typeof rawMessage !== "string") return;
    if (rawMessage === "PING") {
      ws.send("PONG");
      return;
    }

    let msg;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const att = ws.deserializeAttachment();
    if (!att) return;

    const data = await this.getRoomData();

    if (att.role === "host") {
      if (msg.type === "STATE_BROADCAST" && msg.state) {
        data.lastState = msg.state;
        if (msg.state.stage === "WAITING" || msg.state.stage === "SHOWDOWN") {
          data.privateCards = {};
        }
        for (const clientWs of this.getSocketsByRole("client")) {
          const cAtt = clientWs.deserializeAttachment();
          if (!cAtt) continue;
          sendJson(clientWs, {
            type: "STATE_UPDATE",
            state: maskStateForPeer(msg.state, cAtt.peerId),
          });
        }
        await this.saveRoomData(data);
        return;
      }

      if (msg.type === "JOIN_RESPONSE" && msg.peerId) {
        if (msg.state) {
          data.lastState = msg.state;
        }
        for (const clientWs of this.getSocketsByRole("client", msg.peerId)) {
          sendJson(clientWs, {
            type: "JOIN_RESPONSE",
            success: msg.success,
            state: msg.state ? maskStateForPeer(msg.state, msg.peerId) : undefined,
            error: msg.error,
          });
        }
        await this.saveRoomData(data);
        return;
      }

      if (msg.type === "DEAL_CARDS" && msg.peerId && Array.isArray(msg.cards)) {
        data.privateCards[msg.peerId] = msg.cards;
        for (const clientWs of this.getSocketsByRole("client", msg.peerId)) {
          sendJson(clientWs, {
            type: "DEAL_CARDS",
            cards: msg.cards,
          });
        }
        await this.saveRoomData(data);
        return;
      }

      if (msg.type === "HOST_CLOSE") {
        att.explicitLeave = true;
        ws.serializeAttachment(att);
        data.active = false;
        data.lastState = null;
        data.privateCards = {};
        data.hostQueue = [];
        data.disconnectedPeers = {};
        for (const clientWs of this.getSocketsByRole("client")) {
          const cAtt = clientWs.deserializeAttachment();
          if (cAtt) {
            cAtt.explicitLeave = true;
            clientWs.serializeAttachment(cAtt);
          }
          sendJson(clientWs, { type: "ROOM_CLOSED", error: "房主已解散房间" });
          try {
            clientWs.close(4000, "HOST_CLOSED");
          } catch {}
        }
        await this.saveRoomData(data);
        return;
      }
      return;
    }

    // Client -> Host messages
    if (msg.type === "JOIN_REQUEST") {
      this.sendToHost(data, {
        type: "JOIN_REQUEST",
        peerId: att.peerId,
        name: msg.name || att.name || "玩家",
        avatar: msg.avatar || "",
      });
      await this.saveRoomData(data);
      return;
    }

    if (msg.type === "PLAYER_ACTION" && msg.action) {
      this.sendToHost(data, {
        type: "PLAYER_ACTION",
        action: msg.action,
      });
      await this.saveRoomData(data);
      return;
    }

    if (msg.type === "REBUY_REQUEST") {
      this.sendToHost(data, {
        type: "REBUY_REQUEST",
        playerId: msg.playerId || att.peerId,
      });
      await this.saveRoomData(data);
      return;
    }

    if (msg.type === "PLAYER_LEAVE") {
      att.explicitLeave = true;
      ws.serializeAttachment(att);
      delete data.disconnectedPeers[att.peerId];
      this.sendToHost(data, {
        type: "PLAYER_DISCONNECT",
        peerId: att.peerId,
      });
      await this.saveRoomData(data);
      try {
        ws.close(1000, "PLAYER_LEAVE");
      } catch {}
    }
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    if (!att || att.explicitLeave || att.role !== "client") return;

    // Only notify disconnect if the client doesn't reconnect within grace period
    const data = await this.getRoomData();
    if (!data.active) return;

    const stillConnected = this.getSocketsByRole("client", att.peerId).some((s) => s !== ws);
    if (stillConnected) return;

    data.disconnectedPeers[att.peerId] = Date.now() + DISCONNECT_GRACE_MS;
    await this.saveRoomData(data);
    await this.scheduleNextAlarm(data.disconnectedPeers);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async scheduleNextAlarm(disconnectedPeers) {
    const timestamps = Object.values(disconnectedPeers);
    if (timestamps.length === 0) return;
    const earliest = Math.min(...timestamps);
    await this.ctx.storage.setAlarm(Math.max(earliest, Date.now() + 1000));
  }

  async alarm() {
    const data = await this.getRoomData();
    if (!data.active) return;

    const now = Date.now();
    let changed = false;
    for (const [peerId, deadline] of Object.entries(data.disconnectedPeers)) {
      const reconnected = this.getSocketsByRole("client", peerId).length > 0;
      if (reconnected) {
        delete data.disconnectedPeers[peerId];
        changed = true;
      } else if (now >= deadline) {
        delete data.disconnectedPeers[peerId];
        this.sendToHost(data, {
          type: "PLAYER_DISCONNECT",
          peerId,
        });
        changed = true;
      }
    }

    if (changed) {
      await this.saveRoomData(data);
    }
    await this.scheduleNextAlarm(data.disconnectedPeers);
  }
}

export default {
  async fetch(request, env) {
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
        { ok: true, service: "texas-holdem-ws", timestamp: Date.now() },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Za-z0-9_-]{2,32})$/);
    if (wsMatch) {
      const roomId = wsMatch[1].toUpperCase();
      const id = env.POKER_ROOMS.idFromName(roomId);
      const stub = env.POKER_ROOMS.get(id);
      return stub.fetch(request);
    }

    return new Response("Not Found", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  },
};
