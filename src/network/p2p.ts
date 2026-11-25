import mqtt, { MqttClient } from 'mqtt';
import { GameAction, GameState, P2PMessage } from '../types/poker';

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

/**
 * 规范化房间号：支持用户输入 "8821"、"tx-8821"、"tx8821" 或完整邀请 URL
 */
export function normalizeRoomId(raw: string): string {
  let clean = raw.trim();
  const urlMatch = clean.match(/[?&]room=([^&]+)/i);
  if (urlMatch && urlMatch[1]) {
    clean = decodeURIComponent(urlMatch[1]).trim();
  }
  clean = clean.toUpperCase();
  if (/^\d{4}$/.test(clean)) {
    return `TX-${clean}`;
  }
  if (/^TX(\d{4})$/.test(clean)) {
    return `TX-${clean.slice(2)}`;
  }
  return clean;
}

export class P2PNetwork {
  private client: MqttClient | null = null;
  private connectedClients: Set<string> = new Set();
  private topicPrefix: string = '';
  private visibilityHandler?: () => void;
  private unloadHandler?: () => void;

  public myId: string = '';
  public isHost: boolean = false;

  private onStateUpdateCb?: (state: GameState) => void;
  private onDealCardsCb?: (cards: any[]) => void;
  private onActionReceivedCb?: (action: GameAction) => void;
  private onPlayerJoinRequestCb?: (peerId: string, data: any) => void;
  private onPlayerDisconnectCb?: (peerId: string) => void;
  private onRebuyRequestCb?: (playerId: string) => void;

  constructor(
    callbacks: {
      onStateUpdate?: (state: GameState) => void;
      onDealCards?: (cards: any[]) => void;
      onActionReceived?: (action: GameAction) => void;
      onPlayerJoinRequest?: (peerId: string, data: any) => void;
      onPlayerDisconnect?: (peerId: string) => void;
      onRebuyRequest?: (playerId: string) => void;
    }
  ) {
    this.onStateUpdateCb = callbacks.onStateUpdate;
    this.onDealCardsCb = callbacks.onDealCards;
    this.onActionReceivedCb = callbacks.onActionReceived;
    this.onPlayerJoinRequestCb = callbacks.onPlayerJoinRequest;
    this.onPlayerDisconnectCb = callbacks.onPlayerDisconnect;
    this.onRebuyRequestCb = callbacks.onRebuyRequest;
  }

  private connectWithFallback(
    optionsFactory: (brokerUrl: string) => { url: string; opts: mqtt.IClientOptions }
  ): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      let currentIdx = 0;
      let resolved = false;

      const tryNext = () => {
        if (currentIdx >= BROKERS.length) {
          if (!resolved) {
            resolved = true;
            reject(new Error('无法连接到联机服务器，请检查手机网络后重试'));
          }
          return;
        }

        const brokerUrl = BROKERS[currentIdx++];
        const { url, opts } = optionsFactory(brokerUrl);
        const client = mqtt.connect(url, opts);

        const connectTimer = setTimeout(() => {
          if (!resolved && !client.connected) {
            client.end(true);
            tryNext();
          }
        }, 5000);

        client.on('connect', () => {
          clearTimeout(connectTimer);
          if (!resolved) {
            resolved = true;
            resolve(client);
          }
        });

        client.on('error', err => {
          console.warn('MQTT 连接异常:', brokerUrl, err.message);
          if (!resolved) {
            clearTimeout(connectTimer);
            client.end(true);
            tryNext();
          }
        });
      };

      tryNext();
    });
  }

  private attachMobileLifecycleHooks() {
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible' && this.client && !this.client.connected) {
          console.log('页面切回前台，自动恢复房间连接...');
          this.client.reconnect();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    if (typeof window !== 'undefined' && !this.isHost) {
      this.unloadHandler = () => {
        if (this.client && this.client.connected && this.myId) {
          this.client.publish(
            `${this.topicPrefix}/to/host`,
            JSON.stringify({ type: 'PLAYER_LEAVE', playerId: this.myId })
          );
        }
      };
      window.addEventListener('pagehide', this.unloadHandler);
      window.addEventListener('beforeunload', this.unloadHandler);
    }
  }

  // 1. 作为房主创建房间
  async createRoom(rawRoomId: string): Promise<string> {
    const roomId = normalizeRoomId(rawRoomId);
    this.isHost = true;
    this.myId = 'host-' + Math.random().toString(36).substring(2, 8);
    this.topicPrefix = `txholdem/v2/${roomId}`;

    const client = await this.connectWithFallback(url => ({
      url,
      opts: {
        clientId: `txh_${this.myId}_${Date.now()}`,
        clean: true,
        connectTimeout: 5000,
        keepalive: 20,
        reconnectPeriod: 1500,
      },
    }));

    this.client = client;
    this.attachMobileLifecycleHooks();

    await new Promise<void>((resolve, reject) => {
      client.subscribe(`${this.topicPrefix}/to/host`, { qos: 1 }, err => {
        if (err) reject(err);
        else resolve();
      });
    });

    client.on('message', (_topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString()) as P2PMessage;
        this.handleHostMessage(msg);
      } catch (e) {
        console.error('解析消息失败:', e);
      }
    });

    console.log('房主房间初始化成功，房间:', roomId, 'HostID:', this.myId);
    return this.myId;
  }

  private handleHostMessage(msg: P2PMessage) {
    switch (msg.type) {
      case 'JOIN_REQUEST':
        if (msg.senderId) {
          this.connectedClients.add(msg.senderId);
          this.onPlayerJoinRequestCb?.(msg.senderId, msg);
        }
        break;

      case 'PLAYER_ACTION':
        this.onActionReceivedCb?.(msg.action);
        break;

      case 'REBUY_REQUEST':
        this.onRebuyRequestCb?.(msg.playerId);
        break;

      case 'PLAYER_LEAVE':
        if (this.connectedClients.has(msg.playerId)) {
          this.connectedClients.delete(msg.playerId);
          this.onPlayerDisconnectCb?.(msg.playerId);
        }
        break;
    }
  }

  // 2. 作为玩家加入房间 (内置重发机制，防止房主切微信发链接时短暂掉线漏包)
  async joinRoom(rawRoomId: string, playerName: string, avatar: string): Promise<void> {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      throw new Error('请输入有效的房间号');
    }

    this.isHost = false;
    this.myId = 'p-' + Math.random().toString(36).substring(2, 10);
    this.topicPrefix = `txholdem/v2/${roomId}`;

    const client = await this.connectWithFallback(url => ({
      url,
      opts: {
        clientId: `txc_${this.myId}_${Date.now()}`,
        clean: true,
        connectTimeout: 5000,
        keepalive: 20,
        reconnectPeriod: 1500,
        will: {
          topic: `${this.topicPrefix}/to/host`,
          payload: JSON.stringify({ type: 'PLAYER_LEAVE', playerId: this.myId }),
          qos: 1,
          retain: false,
        },
      },
    }));

    this.client = client;
    this.attachMobileLifecycleHooks();

    await new Promise<void>((resolve, reject) => {
      client.subscribe(`${this.topicPrefix}/to/${this.myId}`, { qos: 1 }, err => {
        if (err) reject(err);
        else resolve();
      });
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let retryTimer: any = null;
      let timeoutTimer: any = null;

      const cleanupTimers = () => {
        if (retryTimer) clearInterval(retryTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      client.on('message', (_topic, payload) => {
        try {
          const msg = JSON.parse(payload.toString()) as P2PMessage;
          switch (msg.type) {
            case 'JOIN_RESPONSE':
              if (!settled) {
                settled = true;
                cleanupTimers();
                if (msg.success) {
                  if (msg.state) this.onStateUpdateCb?.(msg.state);
                  resolve();
                } else {
                  this.destroy();
                  reject(new Error(msg.error || '加入房间失败'));
                }
              }
              break;

            case 'STATE_UPDATE':
              this.onStateUpdateCb?.(msg.state);
              break;

            case 'DEAL_CARDS':
              this.onDealCardsCb?.(msg.cards);
              break;
          }
        } catch (e) {
          console.error('解析客户端消息失败:', e);
        }
      });

      const sendJoin = () => {
        if (!client.connected) return;
        client.publish(
          `${this.topicPrefix}/to/host`,
          JSON.stringify({
            type: 'JOIN_REQUEST',
            senderId: this.myId,
            name: playerName,
            avatar,
          }),
          { qos: 1 }
        );
      };

      // 立即发送一次，若房主切到后台刚恢复，每 1.5 秒自动补发一次
      sendJoin();
      retryTimer = setInterval(sendJoin, 1500);

      timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanupTimers();
          this.destroy();
          reject(new Error(`未找到房间 ${roomId}，请核对房间号并确认房主页面处于打开状态`));
        }
      }, 9000);
    });
  }

  sendJoinResponse(peerId: string, success: boolean, state?: GameState, error?: string) {
    if (!this.client || !this.client.connected) return;
    const maskedState = state ? this.maskStateForPeer(state, peerId) : undefined;
    this.client.publish(
      `${this.topicPrefix}/to/${peerId}`,
      JSON.stringify({
        type: 'JOIN_RESPONSE',
        success,
        state: maskedState,
        error,
      }),
      { qos: 1 }
    );
  }

  private maskStateForPeer(state: GameState, peerId: string): GameState {
    const maskedPlayers = state.players.map(p => {
      if (!p) return null;
      if (p.id === peerId || p.showCards) {
        return p;
      }
      return {
        ...p,
        holeCards: p.holeCards.map(() => ({ suit: 'spades' as const, rank: 0 })),
      };
    });
    return { ...state, players: maskedPlayers };
  }

  broadcastState(state: GameState) {
    if (!this.isHost || !this.client || !this.client.connected) return;

    this.connectedClients.forEach(peerId => {
      this.client!.publish(
        `${this.topicPrefix}/to/${peerId}`,
        JSON.stringify({
          type: 'STATE_UPDATE',
          state: this.maskStateForPeer(state, peerId),
        }),
        { qos: 1 }
      );
    });
  }

  sendPrivateCards(peerId: string, cards: any[]) {
    if (!this.client || !this.client.connected) return;
    this.client.publish(
      `${this.topicPrefix}/to/${peerId}`,
      JSON.stringify({
        type: 'DEAL_CARDS',
        cards,
      }),
      { qos: 1 }
    );
  }

  sendAction(action: GameAction) {
    if (!this.client || !this.client.connected) return;
    this.client.publish(
      `${this.topicPrefix}/to/host`,
      JSON.stringify({
        type: 'PLAYER_ACTION',
        action,
      }),
      { qos: 1 }
    );
  }

  sendRebuyRequest(playerId: string) {
    if (!this.client || !this.client.connected) return;
    this.client.publish(
      `${this.topicPrefix}/to/host`,
      JSON.stringify({
        type: 'REBUY_REQUEST',
        playerId,
      }),
      { qos: 1 }
    );
  }

  destroy() {
    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (typeof window !== 'undefined' && this.unloadHandler) {
      window.removeEventListener('pagehide', this.unloadHandler);
      window.removeEventListener('beforeunload', this.unloadHandler);
    }
    if (this.client) {
      if (!this.isHost && this.client.connected && this.myId) {
        this.client.publish(
          `${this.topicPrefix}/to/host`,
          JSON.stringify({ type: 'PLAYER_LEAVE', playerId: this.myId })
        );
      }
      this.client.end(true);
      this.client = null;
    }
    this.connectedClients.clear();
  }
}
