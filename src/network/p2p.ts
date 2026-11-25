import { GameAction, GameState } from '../types/poker';

const WS_BASE_URL =
  import.meta.env.VITE_WS_URL || 'wss://poker.nly22pv.dpdns.org';

const CONNECT_TIMEOUT_MS = 12_000;
const JOIN_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 20_000;

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

export interface P2PCallbacks {
  onStateUpdate?: (state: GameState) => void;
  onDealCards?: (cards: any[]) => void;
  onActionReceived?: (action: GameAction) => void;
  onPlayerJoinRequest?: (peerId: string, data: any) => void;
  onPlayerDisconnect?: (peerId: string) => void;
  onRebuyRequest?: (playerId: string) => void;
}

export class P2PNetwork {
  public myId: string = '';
  public isHost: boolean = false;
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
  private unloadHandler: (() => void) | null = null;

  constructor(callbacks: P2PCallbacks) {
    this.callbacks = callbacks;
  }

  private buildWsUrl(mode: 'create' | 'join' | 'reattach'): string {
    const role = this.isHost ? 'host' : 'client';
    const params = new URLSearchParams({
      role,
      peerId: this.myId,
      mode,
      name: this.playerName,
    });
    return `${WS_BASE_URL}/ws/${encodeURIComponent(this.roomId)}?${params.toString()}`;
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send('PING');
        } catch {
          // Ignore send failure; close handler will trigger reconnect
        }
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
            this.scheduleReconnect(100);
          }
        }
      };
      window.addEventListener('online', this.onlineHandler);
    }

    if (typeof window !== 'undefined' && !this.unloadHandler) {
      this.unloadHandler = () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.myId) {
          try {
            this.ws.send(
              JSON.stringify({
                type: this.isHost ? 'HOST_CLOSE' : 'PLAYER_LEAVE',
                playerId: this.myId,
              })
            );
          } catch {
            // Ignore errors during unload
          }
        }
      };
      window.addEventListener('beforeunload', this.unloadHandler);
    }
  }

  private scheduleReconnect(explicitDelayMs?: number) {
    if (this.destroyed || !this.readyOnce) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const delay =
      explicitDelayMs !== undefined
        ? explicitDelayMs
        : Math.min(1000 * Math.pow(1.6, this.reconnectAttempts), 10_000);
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

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string' || event.data === 'PONG') return;
        this.handleIncomingMessage(event.data);
      };

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startKeepAlive();
      };

      ws.onclose = (ev) => {
        this.stopKeepAlive();
        if (this.destroyed) return;
        // 4000 / 4004 = room closed/not found intentionally
        if (ev.code === 4000 || ev.code === 4004) return;
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will handle scheduling reconnect
      };
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

  private sendOrQueue(payloadObj: Record<string, unknown>, coalesceBroadcast = false) {
    if (this.destroyed) return;
    const raw = JSON.stringify(payloadObj);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(raw);
        return;
      } catch {
        // Fall through to queue
      }
    }

    if (coalesceBroadcast) {
      this.pendingOutbound = this.pendingOutbound.filter((item) => {
        try {
          return JSON.parse(item).type !== 'STATE_BROADCAST';
        } catch {
          return true;
        }
      });
    }
    this.pendingOutbound.push(raw);
    if (this.pendingOutbound.length > 30) {
      this.pendingOutbound.shift();
    }

    if (this.readyOnce && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.scheduleReconnect(100);
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
        this.flushPendingOutbound();
        break;
      case 'JOIN_REQUEST':
        if (this.isHost) {
          this.callbacks.onPlayerJoinRequest?.(msg.peerId, {
            name: msg.name,
            avatar: msg.avatar,
          });
        }
        break;
      case 'STATE_UPDATE':
        if (!this.isHost && msg.state) {
          this.callbacks.onStateUpdate?.(msg.state);
        }
        break;
      case 'DEAL_CARDS':
        if (!this.isHost && Array.isArray(msg.cards)) {
          this.callbacks.onDealCards?.(msg.cards);
        }
        break;
      case 'PLAYER_ACTION':
        if (this.isHost && msg.action) {
          this.callbacks.onActionReceived?.(msg.action);
        }
        break;
      case 'REBUY_REQUEST':
        if (this.isHost && msg.playerId) {
          this.callbacks.onRebuyRequest?.(msg.playerId);
        }
        break;
      case 'PLAYER_DISCONNECT':
        if (this.isHost && msg.peerId) {
          this.callbacks.onPlayerDisconnect?.(msg.peerId);
        }
        break;
      default:
        break;
    }
  }

  async createRoom(rawRoomId: string): Promise<string> {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      throw new Error('请输入有效的房间号');
    }

    this.roomId = roomId;
    this.isHost = true;
    this.destroyed = false;
    this.myId = 'host-' + Math.random().toString(36).slice(2, 10);

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (errMsg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(errMsg));
      };

      const timer = setTimeout(() => {
        try {
          this.ws?.close();
        } catch {}
        fail('连接联机服务器超时，请检查网络后重试');
      }, CONNECT_TIMEOUT_MS);

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.buildWsUrl('create'));
        this.ws = ws;
      } catch {
        clearTimeout(timer);
        reject(new Error('无法创建 WebSocket 连接'));
        return;
      }

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string' || event.data === 'PONG') return;
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (!settled && msg.type === 'ROOM_ERROR') {
          fail(msg.error || '创建房间失败');
          return;
        }

        if (!settled && msg.type === 'ROOM_READY') {
          settled = true;
          clearTimeout(timer);
          this.readyOnce = true;
          this.reconnectAttempts = 0;
          this.startKeepAlive();
          this.setupLifecycleListeners();
          resolve(this.roomId);
          return;
        }

        this.handleIncomingMessage(event.data);
      };

      ws.onerror = () => {
        if (!settled) {
          fail('无法连接到联机服务器，请稍后重试');
        }
      };

      ws.onclose = (ev) => {
        this.stopKeepAlive();
        if (!settled) {
          fail(ev.code === 4001 ? '该房间号正在使用中，请重试' : '与联机服务器断开连接');
          return;
        }
        if (!this.destroyed && ev.code !== 4000) {
          this.scheduleReconnect();
        }
      };
    });
  }

  async joinRoom(rawRoomId: string, playerName: string, avatar: string): Promise<void> {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      throw new Error('请输入有效的 4 位房间号');
    }

    this.roomId = roomId;
    this.isHost = false;
    this.destroyed = false;
    this.playerName = playerName || '玩家';
    this.myId = 'player-' + Math.random().toString(36).slice(2, 10);

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (errMsg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(errMsg));
      };

      const timer = setTimeout(() => {
        try {
          this.ws?.close();
        } catch {}
        fail('加入房间超时：请确认房间号正确，且房主手机停留在牌桌页面');
      }, JOIN_TIMEOUT_MS);

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.buildWsUrl('join'));
        this.ws = ws;
      } catch {
        clearTimeout(timer);
        reject(new Error('无法创建 WebSocket 连接'));
        return;
      }

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string' || event.data === 'PONG') return;
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (!settled && msg.type === 'ROOM_ERROR') {
          fail(msg.error || '房间不存在或已关闭');
          return;
        }

        if (!settled && msg.type === 'ROOM_READY') {
          ws.send(
            JSON.stringify({
              type: 'JOIN_REQUEST',
              name: this.playerName,
              avatar,
            })
          );
          return;
        }

        if (!settled && msg.type === 'JOIN_RESPONSE') {
          if (msg.success) {
            settled = true;
            clearTimeout(timer);
            this.readyOnce = true;
            this.reconnectAttempts = 0;
            this.startKeepAlive();
            this.setupLifecycleListeners();
            if (msg.state) {
              this.callbacks.onStateUpdate?.(msg.state);
            }
            resolve();
          } else {
            fail(msg.error || '加入房间失败');
            try {
              ws.close(1000, 'JOIN_REJECTED');
            } catch {}
          }
          return;
        }

        this.handleIncomingMessage(event.data);
      };

      ws.onerror = () => {
        if (!settled) {
          fail('无法连接到联机服务器，请检查网络后重试');
        }
      };

      ws.onclose = (ev) => {
        this.stopKeepAlive();
        if (!settled) {
          fail(ev.code === 4004 ? '房间不存在，请核对房间号或让房主先创建房间' : '连接已断开，请重试');
          return;
        }
        if (!this.destroyed && ev.code !== 4000 && ev.code !== 4004) {
          this.scheduleReconnect();
        }
      };
    });
  }

  sendJoinResponse(peerId: string, success: boolean, state?: GameState, error?: string) {
    if (!this.isHost) return;
    this.sendOrQueue({
      type: 'JOIN_RESPONSE',
      peerId,
      success,
      state,
      error,
    });
  }

  broadcastState(state: GameState) {
    if (!this.isHost) return;
    this.sendOrQueue(
      {
        type: 'STATE_BROADCAST',
        state,
      },
      true
    );
  }

  sendPrivateCards(peerId: string, cards: any[]) {
    if (!this.isHost) return;
    this.sendOrQueue({
      type: 'DEAL_CARDS',
      peerId,
      cards,
    });
  }

  sendAction(action: GameAction) {
    this.sendOrQueue({
      type: 'PLAYER_ACTION',
      action,
    });
  }

  sendRebuyRequest(playerId: string) {
    this.sendOrQueue({
      type: 'REBUY_REQUEST',
      playerId,
    });
  }

  destroy() {
    this.destroyed = true;
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) {
        window.removeEventListener('online', this.onlineHandler);
        this.onlineHandler = null;
      }
      if (this.unloadHandler) {
        window.removeEventListener('beforeunload', this.unloadHandler);
        this.unloadHandler = null;
      }
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN && this.myId) {
        try {
          this.ws.send(
            JSON.stringify({
              type: this.isHost ? 'HOST_CLOSE' : 'PLAYER_LEAVE',
              playerId: this.myId,
            })
          );
        } catch {}
      }
      try {
        this.ws.close(1000, 'DESTROY');
      } catch {}
      this.ws = null;
    }
    this.pendingOutbound = [];
  }
}
