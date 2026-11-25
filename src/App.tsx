import React, { useState, useEffect, useRef } from 'react';
import { GameAction, GameState, Player, Card } from './types/poker';
import { createInitialState, startNewHand, handlePlayerAction, advanceStage } from './engine/state-machine';
import { getBotAction } from './engine/bot';
import { P2PNetwork } from './network/p2p';
import { Table } from './components/Table';
import { ActionControls } from './components/ActionControls';
import { HeaderBar } from './components/HeaderBar';
import { LobbyModal } from './components/LobbyModal';
import { soundManager } from './audio/sounds';

export const App: React.FC = () => {
  const [inLobby, setInLobby] = useState(true);
  const [gameState, setGameState] = useState<GameState>(createInitialState('TX-8821', 'host'));
  const [localPlayerId, setLocalPlayerId] = useState<string>('local-user');
  const [isHost, setIsHost] = useState(true);
  const [myPrivateCards, setMyPrivateCards] = useState<Card[]>([]);

  const deckRef = useRef<Card[]>([]);
  const networkRef = useRef<P2PNetwork | null>(null);
  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  // 检查 URL 中是否有房间参数 ?room=TX-1234
  const urlParams = new URLSearchParams(window.location.search);
  const initialRoomParam = urlParams.get('room') || '';

  // 1. 初始化房主网络 (联机模式)
  const initHostGame = async (roomId: string, playerName: string) => {
    const net = new P2PNetwork({
      onPlayerJoinRequest: (peerId, data) => {
        handleNewPlayerJoin(peerId, data.name, data.avatar);
      },
      onActionReceived: (action) => {
        processActionAsHost(action);
      },
      onPlayerDisconnect: (peerId) => {
        handlePlayerDisconnectAsHost(peerId);
      },
      onRebuyRequest: (playerId) => {
        handleRebuyAsHost(playerId);
      }
    });

    await net.createRoom(roomId);
    networkRef.current = net;
    setIsHost(true);
    setLocalPlayerId(net.myId);

    const hostPlayer: Player = {
      id: net.myId,
      name: playerName,
      avatar: '',
      chips: 1000,
      currentBet: 0,
      totalRoundBet: 0,
      holeCards: [],
      folded: false,
      isAllIn: false,
      isBot: false,
      seatIndex: 0
    };

    const newPlayers = [hostPlayer, null, null, null, null, null];
    const initState = {
      ...createInitialState(roomId, net.myId),
      players: newPlayers
    };

    stateRef.current = initState;
    setGameState(initState);
    setInLobby(false);
  };

  // 2. 初始化加入玩家网络
  const initClientGame = async (roomId: string, playerName: string) => {
    let myAssignedId = '';
    const net = new P2PNetwork({
      onStateUpdate: (state) => {
        stateRef.current = state;
        setGameState(state);

        if (state.stage === 'WAITING' || state.stage === 'SHOWDOWN') {
          setMyPrivateCards([]);
        } else {
          const self = state.players.find(p => p && p.id === (net.myId || myAssignedId));
          if (self && self.holeCards.length === 2 && self.holeCards[0].rank > 0) {
            setMyPrivateCards(self.holeCards);
          } else if (self && self.holeCards.length === 0) {
            setMyPrivateCards([]);
          }
        }
      },
      onDealCards: (cards) => {
        setMyPrivateCards(cards);
      }
    });

    await net.joinRoom(roomId, playerName, '');
    myAssignedId = net.myId;
    networkRef.current = net;
    setIsHost(false);
    setLocalPlayerId(net.myId);
    setInLobby(false);
  };

  // 3. 房主处理新玩家入座 (含满座拒绝与中途加入观战保护)
  const handleNewPlayerJoin = (peerId: string, name: string, avatar: string) => {
    const currentState = stateRef.current;
    // 防重连重复占座
    const existingIdx = currentState.players.findIndex(p => p && p.id === peerId);
    if (existingIdx !== -1) {
      networkRef.current?.sendJoinResponse(peerId, true, currentState);
      return;
    }

    const emptySeatIndex = currentState.players.findIndex(p => p === null);
    if (emptySeatIndex === -1) {
      networkRef.current?.sendJoinResponse(peerId, false, undefined, '房间已满 (最多6人)');
      return;
    }

    const isMidHand = currentState.stage !== 'WAITING' && currentState.stage !== 'SHOWDOWN';

    const newPlayer: Player = {
      id: peerId,
      name,
      avatar,
      chips: 1000,
      currentBet: 0,
      totalRoundBet: 0,
      holeCards: [],
      folded: isMidHand, // 若牌局已开始中途加入，本局观战，下一手自动参与
      isAllIn: false,
      isBot: false,
      seatIndex: emptySeatIndex
    };

    const updatedPlayers = [...currentState.players];
    updatedPlayers[emptySeatIndex] = newPlayer;

    const updatedState = {
      ...currentState,
      players: updatedPlayers
    };

    stateRef.current = updatedState;
    setGameState(updatedState);
    networkRef.current?.sendJoinResponse(peerId, true, updatedState);
    networkRef.current?.broadcastState(updatedState);
  };

  // 4. 房主处理远端玩家掉线，避免牌局卡死
  const handlePlayerDisconnectAsHost = (peerId: string) => {
    const currentState = stateRef.current;
    const idx = currentState.players.findIndex(p => p && p.id === peerId);
    if (idx === -1) return;

    // 若未在牌局中，直接释放席位
    if (currentState.stage === 'WAITING' || currentState.stage === 'SHOWDOWN') {
      const updatedPlayers = [...currentState.players];
      updatedPlayers[idx] = null;
      const nextState = { ...currentState, players: updatedPlayers };
      stateRef.current = nextState;
      setGameState(nextState);
      networkRef.current?.broadcastState(nextState);
      return;
    }

    // 牌局进行中掉线：若正好轮到他，直接替他 FOLD 推进牌局
    if (currentState.activePlayerIndex === idx) {
      const { state: afterFold, deck } = handlePlayerAction(
        currentState,
        { type: 'FOLD', playerId: peerId },
        deckRef.current
      );
      deckRef.current = deck;
      const cleanedPlayers = afterFold.players.map((p, i) => (i === idx ? null : p));
      const nextState = { ...afterFold, players: cleanedPlayers };
      stateRef.current = nextState;
      setGameState(nextState);
      networkRef.current?.broadcastState(nextState);
      return;
    }

    // 未轮到他：标记弃牌、移出待行动列表，若只剩一人则直接结束
    const updatedPlayers = currentState.players.map((p, i) => (i === idx ? null : p));
    const remainingPending = currentState.pendingPlayerIds.filter(id => id !== peerId);
    const nonFolded = updatedPlayers.filter((p): p is Player => p !== null && !p.folded);

    let nextState: GameState = {
      ...currentState,
      players: updatedPlayers,
      pendingPlayerIds: remainingPending
    };

    if (nonFolded.length === 1) {
      const winner = nonFolded[0];
      nextState = {
        ...nextState,
        stage: 'SHOWDOWN',
        totalPot: 0,
        currentBet: 0,
        activePlayerIndex: -1,
        pendingPlayerIds: [],
        players: updatedPlayers.map(p =>
          p
            ? {
                ...p,
                currentBet: 0,
                chips: p.id === winner.id ? p.chips + currentState.totalPot : p.chips
              }
            : null
        ),
        winners: [{
          playerId: winner.id,
          name: winner.name,
          amount: currentState.totalPot,
          handName: '对手离线获胜',
          cards: winner.holeCards
        }]
      };
    } else if (remainingPending.length === 0) {
      const res = advanceStage(nextState, deckRef.current);
      deckRef.current = res.deck;
      nextState = res.state;
    }

    stateRef.current = nextState;
    setGameState(nextState);
    networkRef.current?.broadcastState(nextState);
  };

  // 5. 发牌开局
  const handleStartHand = () => {
    if (!isHost) return;
    soundManager.playCardDeal();

    let current = stateRef.current;
    // 若练习房仅剩不到 2 人有筹码，自动为出局电脑补买筹码
    const aliveCount = current.players.filter(p => p !== null && p.chips > 0).length;
    if (aliveCount < 2) {
      const refilled = current.players.map(p =>
        p && p.isBot && p.chips <= 0 ? { ...p, chips: 1000 } : p
      );
      current = { ...current, players: refilled };
    }

    const { state: nextState, deck } = startNewHand(current);
    deckRef.current = deck;
    stateRef.current = nextState;
    setGameState(nextState);

    // 更新本地底牌展示
    const humanPlayer = nextState.players.find(p => p && p.id === localPlayerId);
    if (humanPlayer && humanPlayer.holeCards.length === 2) {
      setMyPrivateCards(humanPlayer.holeCards);
    } else {
      setMyPrivateCards([]);
    }

    // 给每个非机器人客户端分发私密底牌
    nextState.players.forEach(p => {
      if (p && !p.isBot && p.holeCards.length === 2 && p.id !== localPlayerId) {
        networkRef.current?.sendPrivateCards(p.id, p.holeCards);
      }
    });

    networkRef.current?.broadcastState(nextState);
  };

  // 6. 房主核心处理动作
  const processActionAsHost = (action: GameAction) => {
    const { state: updatedState, deck } = handlePlayerAction(
      stateRef.current,
      action,
      deckRef.current
    );
    deckRef.current = deck;
    stateRef.current = updatedState;
    setGameState(updatedState);
    networkRef.current?.broadcastState(updatedState);
  };

  // 7. 监听是否轮到电脑玩家 (Bot) 行动
  useEffect(() => {
    if (!isHost) return;
    const currentState = gameState;

    if (
      currentState.stage !== 'WAITING' &&
      currentState.stage !== 'SHOWDOWN' &&
      currentState.activePlayerIndex !== -1
    ) {
      const activePlayer = currentState.players[currentState.activePlayerIndex];
      if (activePlayer && activePlayer.isBot && !activePlayer.folded && !activePlayer.isAllIn) {
        const timer = setTimeout(() => {
          if (stateRef.current.activePlayerIndex === activePlayer.seatIndex) {
            const botAction = getBotAction(stateRef.current, activePlayer);
            processActionAsHost(botAction);
          }
        }, 700 + Math.random() * 500);

        return () => clearTimeout(timer);
      }
    }
  }, [gameState.activePlayerIndex, gameState.stage, isHost]);

  // 8. 发送玩家操作
  const handleLocalAction = (action: GameAction) => {
    if (isHost) {
      processActionAsHost(action);
    } else {
      networkRef.current?.sendAction(action);
    }
  };

  // 9. 房主添加 AI 电脑玩家
  const handleAddBot = (seatIdx?: number) => {
    if (!isHost) return;
    const currentState = stateRef.current;
    const targetIndex = seatIdx !== undefined ? seatIdx : currentState.players.findIndex(p => p === null);
    if (targetIndex === -1) return;

    const botNames = ['高斯', '图灵', '阿尔法', '深蓝', '冯诺依曼', '香农'];
    const usedNames = currentState.players.filter(Boolean).map(p => p!.name);
    const availableName = botNames.find(n => !usedNames.includes('AI·' + n)) || botNames[Math.floor(Math.random() * botNames.length)];

    const botPlayer: Player = {
      id: 'bot-' + Math.random().toString(36).substring(2, 8),
      name: 'AI·' + availableName,
      avatar: '',
      chips: 1000,
      currentBet: 0,
      totalRoundBet: 0,
      holeCards: [],
      folded: false,
      isAllIn: false,
      isBot: true,
      seatIndex: targetIndex
    };

    const newPlayers = [...currentState.players];
    newPlayers[targetIndex] = botPlayer;

    const nextState = { ...currentState, players: newPlayers };
    stateRef.current = nextState;
    setGameState(nextState);
    networkRef.current?.broadcastState(nextState);
  };

  // 10. 等待阶段房主换座
  const handleSitDown = (targetSeatIndex: number) => {
    if (!isHost || stateRef.current.stage !== 'WAITING') return;
    const currentState = stateRef.current;
    if (currentState.players[targetSeatIndex] !== null) return;

    const currentIdx = currentState.players.findIndex(p => p && p.id === localPlayerId);
    if (currentIdx === -1 || currentIdx === targetSeatIndex) return;

    const newPlayers = [...currentState.players];
    const movingPlayer = { ...newPlayers[currentIdx]!, seatIndex: targetSeatIndex };
    newPlayers[currentIdx] = null;
    newPlayers[targetSeatIndex] = movingPlayer;

    const nextState = { ...currentState, players: newPlayers };
    stateRef.current = nextState;
    setGameState(nextState);
    networkRef.current?.broadcastState(nextState);
  };

  // 11. 房主处理任意玩家重买筹码
  const handleRebuyAsHost = (targetPlayerId: string) => {
    const currentState = stateRef.current;
    const updatedPlayers = currentState.players.map(p =>
      p && p.id === targetPlayerId && p.chips <= 0 ? { ...p, chips: 1000 } : p
    );
    const nextState = { ...currentState, players: updatedPlayers };
    stateRef.current = nextState;
    setGameState(nextState);
    networkRef.current?.broadcastState(nextState);
  };

  const handleRebuy = () => {
    if (isHost) {
      handleRebuyAsHost(localPlayerId);
    } else {
      networkRef.current?.sendRebuyRequest(localPlayerId);
    }
  };

  // 12. 一键单人秒开 (完全本地即时初始化，零等待零网络依赖)
  const handleQuickPractice = () => {
    const localId = 'local-player-0';
    setLocalPlayerId(localId);
    setIsHost(true);

    const humanPlayer: Player = {
      id: localId,
      name: '您 (VIP)',
      avatar: '',
      chips: 1000,
      currentBet: 0,
      totalRoundBet: 0,
      holeCards: [],
      folded: false,
      isAllIn: false,
      isBot: false,
      seatIndex: 0
    };

    const botNames = ['图灵', '阿尔法', '高斯', '深蓝', '香农'];
    const filledPlayers: (Player | null)[] = [humanPlayer];

    for (let i = 1; i <= 5; i++) {
      filledPlayers.push({
        id: 'bot-' + i,
        name: 'AI·' + botNames[i - 1],
        avatar: '',
        chips: 1000,
        currentBet: 0,
        totalRoundBet: 0,
        holeCards: [],
        folded: false,
        isAllIn: false,
        isBot: true,
        seatIndex: i
      });
    }

    const readyState: GameState = {
      ...createInitialState('PRACTICE', localId),
      players: filledPlayers
    };

    const { state: startedState, deck } = startNewHand(readyState);
    deckRef.current = deck;
    stateRef.current = startedState;
    setGameState(startedState);

    if (startedState.players[0]) {
      setMyPrivateCards(startedState.players[0].holeCards);
    }

    soundManager.playCardDeal();
    setInLobby(false);
  };

  // 当前视角玩家
  let localPlayer = gameState.players.find(p => p && p.id === localPlayerId) || null;
  if (localPlayer && myPrivateCards.length === 2 && gameState.stage !== 'SHOWDOWN') {
    localPlayer = { ...localPlayer, holeCards: myPrivateCards };
  }

  const activeCount = gameState.players.filter(p => p !== null && p.chips > 0).length;
  const isTableFull = gameState.players.every(p => p !== null);
  const canStartInHeader = isHost && gameState.stage === 'WAITING' && activeCount >= 2;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-between bg-neutral-950 overflow-hidden relative">
      {/* 大厅弹窗 */}
      {inLobby && (
        <LobbyModal
          initialRoomId={initialRoomParam}
          onCreateRoom={async (nickname) => {
            const rid = 'TX-' + Math.floor(1000 + Math.random() * 9000);
            await initHostGame(rid, nickname);
          }}
          onJoinRoom={async (rid, nickname) => {
            await initClientGame(rid, nickname);
          }}
          onQuickPractice={handleQuickPractice}
        />
      )}

      {/* 顶部状态栏 */}
      {!inLobby && (
        <HeaderBar
          roomId={gameState.roomId}
          isHost={isHost}
          canStart={canStartInHeader}
          isTableFull={isTableFull}
          onStartHand={handleStartHand}
          onAddBot={() => handleAddBot()}
          handNumber={gameState.handNumber}
        />
      )}

      {/* 核心扑克桌 */}
      {!inLobby && (
        <main className="flex-1 w-full flex items-center justify-center px-2 pt-10 pb-40 sm:pb-44 relative">
          <Table
            gameState={gameState}
            localPlayer={localPlayer}
            onSitDown={isHost ? handleSitDown : undefined}
            onAddBot={isHost ? seatIdx => handleAddBot(seatIdx) : undefined}
            onNextHand={isHost && activeCount >= 2 ? handleStartHand : undefined}
            onRebuy={handleRebuy}
          />
        </main>
      )}

      {/* 底部操作面板 */}
      {!inLobby && localPlayer && (
        <ActionControls
          gameState={gameState}
          localPlayer={localPlayer}
          onAction={handleLocalAction}
        />
      )}
    </div>
  );
};
export default App;
