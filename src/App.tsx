import React, { useState, useEffect, useRef } from 'react';
import { GameAction, GameState, Player, Card } from './types/poker';
import { createInitialState, startNewHand, handlePlayerAction } from './engine/state-machine';
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
      onPlayerJoinRequest: (conn, data) => {
        handleNewPlayerJoin(conn.peer, data.name, data.avatar);
      },
      onActionReceived: (action) => {
        processActionAsHost(action);
      }
    });

    try {
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
    } catch (e: any) {
      alert(e.message || '创建房间失败');
    }
  };

  // 2. 初始化加入玩家网络
  const initClientGame = async (roomId: string, playerName: string) => {
    const net = new P2PNetwork({
      onStateUpdate: (state) => {
        stateRef.current = state;
        setGameState(state);
      },
      onDealCards: (cards) => {
        setMyPrivateCards(cards);
      }
    });

    try {
      await net.joinRoom(roomId, playerName, '');
      networkRef.current = net;
      setIsHost(false);
      setLocalPlayerId(net.myId);
      setInLobby(false);
    } catch (e: any) {
      alert(e.message || '加入房间失败');
    }
  };

  // 3. 房主处理新玩家入座
  const handleNewPlayerJoin = (peerId: string, name: string, avatar: string) => {
    const currentState = stateRef.current;
    const emptySeatIndex = currentState.players.findIndex(p => p === null);
    if (emptySeatIndex === -1) return;

    const newPlayer: Player = {
      id: peerId,
      name,
      avatar,
      chips: 1000,
      currentBet: 0,
      totalRoundBet: 0,
      holeCards: [],
      folded: false,
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
    networkRef.current?.broadcastState(updatedState);
  };

  // 4. 发牌开局
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
    }

    // 给每个非机器人客户端分发私密底牌
    nextState.players.forEach(p => {
      if (p && !p.isBot && p.holeCards.length === 2 && p.id !== localPlayerId) {
        networkRef.current?.sendPrivateCards(p.id, p.holeCards);
      }
    });

    networkRef.current?.broadcastState(nextState);
  };

  // 5. 房主核心处理动作
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

  // 6. 监听是否轮到电脑玩家 (Bot) 行动
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

  // 7. 发送玩家操作
  const handleLocalAction = (action: GameAction) => {
    if (isHost) {
      processActionAsHost(action);
    } else {
      networkRef.current?.sendAction(action);
    }
  };

  // 8. 房主添加 AI 电脑玩家
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

  // 9. 等待阶段房主换座
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

  // 10. 本地玩家重买筹码
  const handleRebuy = () => {
    if (!isHost) return;
    const currentState = stateRef.current;
    const updatedPlayers = currentState.players.map(p =>
      p && p.id === localPlayerId && p.chips <= 0 ? { ...p, chips: 1000 } : p
    );
    const nextState = { ...currentState, players: updatedPlayers };
    stateRef.current = nextState;
    setGameState(nextState);
    networkRef.current?.broadcastState(nextState);
  };

  // 11. 一键单人秒开 (完全本地即时初始化，零等待零网络依赖)
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
          onCreateRoom={(nickname) => {
            const rid = 'TX-' + Math.floor(1000 + Math.random() * 9000);
            initHostGame(rid, nickname);
          }}
          onJoinRoom={(rid, nickname) => {
            initClientGame(rid, nickname);
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

      {/* 核心扑克桌 (上下均预留安全区，防止顶部席位触及顶栏、底部席位触及操作栏) */}
      {!inLobby && (
        <main className="flex-1 w-full flex items-center justify-center px-2 pt-10 pb-40 sm:pb-44 relative">
          <Table
            gameState={gameState}
            localPlayer={localPlayer}
            onSitDown={isHost ? handleSitDown : undefined}
            onAddBot={isHost ? seatIdx => handleAddBot(seatIdx) : undefined}
            onNextHand={isHost && activeCount >= 2 ? handleStartHand : undefined}
            onRebuy={isHost ? handleRebuy : undefined}
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
