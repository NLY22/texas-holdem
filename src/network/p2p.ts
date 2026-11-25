import {
  BotPersonality,
  GameAction,
  GameState,
  LedgerEntry,
  QuickChatEvent,
  RoomConfig,
} from '../types/poker';

const WS_BASE_URL =
  import.meta.env.VITE_WS_URL || 'wss://poker.nly22pv.dpdns.org';

const CONNECT_TIMEOUT_MS = 12_000;
const PING_INTERVAL_MS = 20_000;
const SESSION_PREFIX = 'tx_holdem_session_';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface RoomSessionInfo {
  roomId: string;
  peerId: string;
  name: string;
}

export interface DissolvedInfo {
  ledger: Record<string, LedgerEntry>;
  roundNumber: number;
  handNumber: number;
  reason: string;
}

export function normalizeRoomId(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('TX-')) {
    const code = cleaned.slice(3).replace(/[^A-Z0-9]/g, '');
    return code ? `TX-${code}` : '';
  }
  const plain = cleaned.replace(/-/g, '');
  if (!plain) return '';
  if (plain.startsWith('TX') && plain.length > 2) {
    return `TX-${plain.slice(2)}`;
  }
  return `TX-${plain}`;
}

export function getSavedSession(rawRoomId: string): RoomSessionInfo | null {
  try {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId || typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_PREFIX + roomId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(info: RoomSessionInfo) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(SESSION_PREFIX + info.roomId, JSON.stringify(info));
  } catch {}
}

export function clearSavedSession(rawRoomId?: string) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (rawRoomId) {
      sessionStorage.removeItem(SESSION_PREFIX + normalizeRoomId(rawRoomId));
    } else {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith(SESSION_PREFIX))
        .forEach(k => sessionStorage.removeItem(k));
    }
  } catch {}
}

export interface P2PCallbacks {
  onStateUpdate?: (state: GameState) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onToast?: (text: string) => void;
  onQuickChat?: (event: QuickChatEvent) => void;
  onRoomDissolved?: (info: DissolvedInfo) => void;
  onKicked?: (reason: string) => void;
}

export class P2PNetwork {
  public myId: string = '';
  public roomId: string = '';

  private ws: WebSocket | null = null;
  private callbacks: P2PCallbacks;
  private playerName: string = '玩家';
  private destroyed: boolean = false;
  private readyOnce: boolean = false;
  private reconnectAttempts: number = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOutbound: string[] = [];

  private visibilityHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;

  constructor(callbacks: P2PCallbacks) {
    this.callbacks = callbacks;
  }

  private emitStatus(status: ConnectionStatus) {
    this.callbacks.onConnectionChange?.(status);
  }

  private buildWsUrl(mode: 'create' | 'join' | 'reattach', config?: Partial<RoomConfig>): string {
    const params = new URLSearchParams({
      peerId: this.myId,
      mode,
      name: this.playerName,
    });
    if (mode === 'create' && config) {
      params.set('config', JSON.stringify(config));
    }
    return `${WS_BASE_URL}/ws/${encodeURIComponent(this.roomId)}?${params.toString()}`;
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send('PING');
        } catch {}
      }
    }, PING_INTERVAL_MS);
  }

  private stopKeepAlive() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setupLifecycleListeners() {
    if (typeof document !== 'undefined' && !this.visibilityHandler) {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible' && !this.destroyed && this.readyOnce) {
          if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
            this.reconnectAttempts = 0;
            this.scheduleReconnect(50);
          } else if (this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send('PING');
            } catch {
              this.scheduleReconnect(50);
            }
          }
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    if (typeof window !== 'undefined' && !this.onlineHandler) {
      this.onlineHandler = () => {
        if (!this.destroyed && this.readyOnce) {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.reconnectAttempts = 0;
            this.scheduleReconnect(80);
          }
        }
      };
      window.addEventListener('online', this.onlineHandler);
    }
  }

  private scheduleReconnect(explicitDelayMs?: number) {
    if (this.destroyed || !this.readyOnce) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.emitStatus('reconnecting');
    const delay =
      explicitDelayMs !== undefined
        ? explicitDelayMs
        : Math.min(800 * Math.pow(1.6, this.reconnectAttempts), 10_000);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      this.openReattachSocket();
    }, delay);
  }

  private openReattachSocket() {
    if (this.destroyed) return;
    try {
      const ws = new WebSocket(this.buildWsUrl('reattach'));
      this.ws = ws;

      ws.onmessage = event => {
        if (typeof event.data !== 'string' || event.data === 'PONG') return;
        this.handleIncomingMessage(event.data);
      };

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startKeepAlive();
        this.emitStatus('connected');
      };

      ws.onclose = ev => {
        this.stopKeepAlive();
        if (this.destroyed) return;
        if (ev.code === 4000 || ev.code === 4004 || ev.code === 4005) {
          this.emitStatus('closed');
          return;
        }
        this.scheduleReconnect();
      };

      ws.onerror = () => {};
    } catch {
      this.scheduleReconnect();
    }
  }

  private flushPendingOutbound() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.pendingOutbound.length > 0) {
      const payload = this.pendingOutbound.shift()!;
      try {
        this.ws.send(payload);
      } catch {
        this.pendingOutbound.unshift(payload);
        break;
      }
    }
  }

  private sendCommand(payloadObj: Record<string, unknown>) {
    if (this.destroyed) return;
    const raw = JSON.stringify(payloadObj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(raw);
        return;
      } catch {}
    }
    this.pendingOutbound.push(raw);
    if (this.pendingOutbound.length > 30) {
      this.pendingOutbound.shift();
    }
    if (this.readyOnce && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.scheduleReconnect(80);
    }
  }

  private handleIncomingMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'ROOM_READY':
        this.emitStatus('connected');
        this.flushPendingOutbound();
        break;
      case 'STATE_UPDATE':
        if (msg.state) {
          this.callbacks.onStateUpdate?.(msg.state);
        }
        break;
      case 'TOAST':
        if (msg.text) {
          this.callbacks.onToast?.(msg.text);
        }
        break;
      case 'QUICK_CHAT':
        if (msg.event) {
          this.callbacks.onQuickChat?.(msg.event);
        }
        break;
      case 'ROOM_DISSOLVED':
        this.destroyed = true;
        clearSavedSession(this.roomId);
        this.emitStatus('closed');
        this.callbacks.onRoomDissolved?.({
          ledger: msg.ledger || {},
          roundNumber: msg.roundNumber || 1,
          handNumber: msg.handNumber || 0,
          reason: msg.error || '房主已解散房间',
        });
        break;
      case 'KICKED':
        this.destroyed = true;
        clearSavedSession(this.roomId);
        this.emitStatus('closed');
        this.callbacks.onKicked?.(msg.error || '您已被房主请离房间');
        break;
      default:
        break;
    }
  }

  private connectInitial(
    rawRoomId: string,
    playerName: string,
    mode: 'create' | 'join' | 'reattach',
    existingPeerId?: string,
    config?: Partial<RoomConfig>
  ): Promise<GameState> {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      return Promise.reject(new Error('请输入有效的 4 位房间号'));
    }

    this.roomId = roomId;
    this.playerName = playerName || '玩家';
    this.destroyed = false;
    this.myId = existingPeerId || 'p-' + Math.random().toString(36).slice(2, 10);
    this.emitStatus('connecting');

    return new Promise((resolve, reject) => {
      let settled = false;
      let latestState: GameState | null = null;
      let roomReady = false;

      const fail = (errMsg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.emitStatus('closed');
        reject(new Error(errMsg));
      };

      const maybeResolve = () => {
        if (!settled && roomReady && latestState) {
          settled = true;
          clearTimeout(timer);
          this.readyOnce = true;
          this.reconnectAttempts = 0;
          saveSession({ roomId: this.roomId, peerId: this.myId, name: this.playerName });
          this.startKeepAlive();
          this.setupLifecycleListeners();
          this.emitStatus('connected');
          resolve(latestState);
        }
      };

      const timer = setTimeout(() => {
        try {
          this.ws?.close();
        } catch {}
        fail('连接联机服务器超时，请检查网络后重试');
      }, CONNECT_TIMEOUT_MS);

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.buildWsUrl(mode, config));
        this.ws = ws;
      } catch {
        clearTimeout(timer);
        reject(new Error('无法创建 WebSocket 连接'));
        return;
      }

      ws.onmessage = event => {
        if (typeof event.data !== 'string' || event.data === 'PONG') return;
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (!settled && msg.type === 'ROOM_ERROR') {
          if (mode === 'reattach') clearSavedSession(this.roomId);
          fail(msg.error || '加入房间失败');
          return;
        }

        if (!settled && msg.type === 'ROOM_READY') {
          roomReady = true;
          maybeResolve();
          return;
        }

        if (!settled && msg.type === 'STATE_UPDATE' && msg.state) {
          latestState = msg.state;
          this.callbacks.onStateUpdate?.(msg.state);
          maybeResolve();
          return;
        }

        this.handleIncomingMessage(event.data);
      };

      ws.onerror = () => {
        if (!settled) {
          fail('无法连接到联机服务器，请稍后重试');
        }
      };

      ws.onclose = ev => {
        this.stopKeepAlive();
        if (!settled) {
          if (ev.code === 4001) fail('该房间号正在使用中，请重试');
          else if (ev.code === 4003) fail('房间已满 (最多 6 人)');
          else if (ev.code === 4004) fail('房间不存在或已解散');
          else fail('与联机服务器断开连接');
          return;
        }
        if (!this.destroyed && ev.code !== 4000 && ev.code !== 4004 && ev.code !== 4005) {
          this.scheduleReconnect();
        }
      };
    });
  }

  async createRoom(rawRoomId: string, playerName: string, config?: Partial<RoomConfig>): Promise<GameState> {
    return this.connectInitial(rawRoomId, playerName, 'create', undefined, config);
  }

  async joinRoom(rawRoomId: string, playerName: string): Promise<GameState> {
    const saved = getSavedSession(rawRoomId);
    if (saved) {
      try {
        return await this.connectInitial(rawRoomId, saved.name || playerName, 'reattach', saved.peerId);
      } catch {
        clearSavedSession(rawRoomId);
      }
    }
    return this.connectInitial(rawRoomId, playerName, 'join');
  }

  async reattachRoom(session: RoomSessionInfo): Promise<GameState> {
    return this.connectInitial(session.roomId, session.name, 'reattach', session.peerId);
  }

  // 全部权威操作指令
  sendAction(action: GameAction) {
    this.sendCommand({ type: 'PLAYER_ACTION', action });
  }
  startHand() {
    this.sendCommand({ type: 'START_HAND' });
  }
  addBot(seatIndex?: number, personality?: BotPersonality) {
    this.sendCommand({ type: 'ADD_BOT', seatIndex, personality });
  }
  removeBot(seatIndex: number) {
    this.sendCommand({ type: 'REMOVE_BOT', seatIndex });
  }
  clearBots() {
    this.sendCommand({ type: 'CLEAR_BOTS' });
  }
  sitAtSeat(seatIndex: number) {
    this.sendCommand({ type: 'SIT_AT_SEAT', seatIndex });
  }
  toggleSitOut() {
    this.sendCommand({ type: 'TOGGLE_SIT_OUT' });
  }
  sendRebuyRequest(mode: 'rebuy' | 'topup' = 'rebuy') {
    this.sendCommand({ type: 'REBUY_REQUEST', mode });
  }
  updateConfig(config: Partial<RoomConfig>) {
    this.sendCommand({ type: 'UPDATE_CONFIG', config });
  }
  kickPlayer(seatIndex: number) {
    this.sendCommand({ type: 'KICK_PLAYER', seatIndex });
  }
  transferHost(targetPlayerId: string) {
    this.sendCommand({ type: 'TRANSFER_HOST', targetPlayerId });
  }
  showWinnerCards() {
    this.sendCommand({ type: 'SHOW_WINNER_CARDS' });
  }
  rabbitHunt() {
    this.sendCommand({ type: 'RABBIT_HUNT' });
  }
  sendQuickChat(text: string) {
    this.sendCommand({ type: 'QUICK_CHAT', text });
  }
  resetTable() {
    this.sendCommand({ type: 'RESET_TABLE' });
  }
  dissolveRoom() {
    clearSavedSession(this.roomId);
    this.sendCommand({ type: 'DISSOLVE_ROOM' });
  }
  leaveRoom() {
    clearSavedSession(this.roomId);
    this.destroyed = true;
    this.stopKeepAlive();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'PLAYER_LEAVE' }));
      } catch {}
    }
    this.cleanupListeners();
  }

  private cleanupListeners() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (typeof window !== 'undefined' && this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this.stopKeepAlive();
    this.cleanupListeners();
    if (this.ws) {
      try {
        this.ws.close(1000, 'DESTROY');
      } catch {}
      this.ws = null;
    }
    this.pendingOutbound = [];
  }
}
