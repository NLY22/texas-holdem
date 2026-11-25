import Peer, { DataConnection } from 'peerjs';
import { GameAction, GameState, P2PMessage } from '../types/poker';

export class P2PNetwork {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private hostConnection: DataConnection | null = null;
  public myId: string = '';
  public isHost: boolean = false;

  private onStateUpdateCb?: (state: GameState) => void;
  private onDealCardsCb?: (cards: any[]) => void;
  private onActionReceivedCb?: (action: GameAction) => void;
  private onPlayerJoinRequestCb?: (conn: DataConnection, data: any) => void;
  private onPlayerDisconnectCb?: (peerId: string) => void;
  private onRebuyRequestCb?: (playerId: string) => void;

  constructor(
    callbacks: {
      onStateUpdate?: (state: GameState) => void;
      onDealCards?: (cards: any[]) => void;
      onActionReceived?: (action: GameAction) => void;
      onPlayerJoinRequest?: (conn: DataConnection, data: any) => void;
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

  // 1. 作为房主创建房间
  createRoom(roomId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.isHost = true;
      const peerId = `poker-room-${roomId.toLowerCase()}`;

      this.peer = new Peer(peerId, {
        debug: 1,
      });

      this.peer.on('open', id => {
        this.myId = id;
        console.log('房主 P2P 初始化成功，PeerID:', id);
        resolve(id);
      });

      this.peer.on('connection', conn => {
        console.log('有新玩家连接进来:', conn.peer);
        this.setupConnection(conn);
      });

      this.peer.on('error', err => {
        console.error('PeerJS 出错:', err);
        if (err.type === 'unavailable-id') {
          reject(new Error('房间号已被占用，请换一个房间号'));
        } else {
          reject(err);
        }
      });
    });
  }

  // 2. 作为玩家加入房间
  joinRoom(roomId: string, playerName: string, avatar: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.peer = new Peer({ debug: 1 });
      let settled = false;

      this.peer.on('open', myId => {
        this.myId = myId;
        const targetHostId = `poker-room-${roomId.toLowerCase()}`;
        console.log('玩家 Peer 初始化完成，正在连接房主:', targetHostId);

        const conn = this.peer!.connect(targetHostId, {
          reliable: true,
        });

        conn.on('open', () => {
          console.log('已连通房主，正在发送入座请求...');
          this.hostConnection = conn;
          this.setupConnection(conn, response => {
            if (!settled) {
              settled = true;
              if (response.success) {
                resolve();
              } else {
                conn.close();
                reject(new Error(response.error || '加入房间失败'));
              }
            }
          });

          conn.send({
            type: 'JOIN_REQUEST',
            name: playerName,
            avatar,
          });
        });

        conn.on('error', err => {
          console.error('连接房主失败:', err);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });

        setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('连接房间超时，请检查房间号是否正确或房主是否在线'));
          }
        }, 8000);
      });

      this.peer.on('error', err => {
        console.error('P2P 错误:', err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  private setupConnection(
    conn: DataConnection,
    onJoinResponse?: (res: { success: boolean; error?: string }) => void
  ) {
    conn.on('data', rawData => {
      const msg = rawData as P2PMessage;

      switch (msg.type) {
        case 'JOIN_REQUEST':
          if (this.isHost) {
            this.connections.set(conn.peer, conn);
            this.onPlayerJoinRequestCb?.(conn, msg);
          }
          break;

        case 'JOIN_RESPONSE':
          onJoinResponse?.({ success: msg.success, error: msg.error });
          if (msg.success && msg.state) {
            this.onStateUpdateCb?.(msg.state);
          }
          break;

        case 'STATE_UPDATE':
          this.onStateUpdateCb?.(msg.state);
          break;

        case 'DEAL_CARDS':
          this.onDealCardsCb?.(msg.cards);
          break;

        case 'PLAYER_ACTION':
          if (this.isHost) {
            this.onActionReceivedCb?.(msg.action);
          }
          break;

        case 'REBUY_REQUEST':
          if (this.isHost) {
            this.onRebuyRequestCb?.(msg.playerId);
          }
          break;
      }
    });

    conn.on('close', () => {
      console.log('连接断开:', conn.peer);
      this.connections.delete(conn.peer);
      if (this.isHost) {
        this.onPlayerDisconnectCb?.(conn.peer);
      }
    });
  }

  sendJoinResponse(peerId: string, success: boolean, state?: GameState, error?: string) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      const maskedState = state ? this.maskStateForPeer(state, peerId) : undefined;
      conn.send({
        type: 'JOIN_RESPONSE',
        success,
        state: maskedState,
        error
      });
    }
  }

  private maskStateForPeer(state: GameState, peerId: string): GameState {
    const maskedPlayers = state.players.map(p => {
      if (!p) return null;
      // 仅允许该玩家本人查看自己底牌，或合法摊牌亮牌玩家 (showCards === true)
      if (p.id === peerId || p.showCards) {
        return p;
      }
      return {
        ...p,
        holeCards: p.holeCards.map(() => ({ suit: 'spades' as const, rank: 0 }))
      };
    });
    return { ...state, players: maskedPlayers };
  }

  // 房主广播全场状态（底牌自动安全掩码）
  broadcastState(state: GameState) {
    if (!this.isHost) return;

    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        conn.send({
          type: 'STATE_UPDATE',
          state: this.maskStateForPeer(state, peerId)
        });
      }
    });
  }

  // 房主给指定玩家发送私有手牌
  sendPrivateCards(peerId: string, cards: any[]) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send({
        type: 'DEAL_CARDS',
        cards
      });
    }
  }

  // 玩家向房主发送出牌操作
  sendAction(action: GameAction) {
    if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({
        type: 'PLAYER_ACTION',
        action
      });
    }
  }

  // 玩家向房主请求补买筹码
  sendRebuyRequest(playerId: string) {
    if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({
        type: 'REBUY_REQUEST',
        playerId
      });
    }
  }

  destroy() {
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    this.hostConnection?.close();
    this.peer?.destroy();
  }
}
