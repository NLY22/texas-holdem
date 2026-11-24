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
  const [localPlayerId, setLocalPlayerId] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [myPrivateCards, setMyPrivateCards] = useState<Card[]>([]);

  const deckRef = useRef<Card[]>([]);
  const networkRef = useRef<P2PNetwork | null>(null);
  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  // 检查 URL 中是否有房间参数 ?room=TX-1234
  const urlParams = new URLSearchParams(window.location.search);
  const initialRoomParam = urlParams.get('room') || '';

  // 1. 初始化房主网络
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

      // 创建初始状态并将房主放入 0 号席位
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

    if (emptySeatIndex === -1) {
      return; // 满座
    }

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

    setGameState(updatedState);
    networkRef.current?.broadcastState(updatedState);
  };

  // 4. 房主发牌开局
  const handleStartHand = () => {
    if (!isHost) return;
    soundManager.playCardDeal();

    const { state: nextState, deck } = startNewHand(stateRef.current);
    deckRef.current = deck;
    setGameState(nextState);

    // 给每个非机器人客户端分发私密底牌
    nextState.players.forEach(p => {
      if (p && !p.isBot && p.holeCards.length === 2) {
        if (p.id === localPlayerId) {
          setMyPrivateCards(p.holeCards);
        } else {
          networkRef.current?.sendPrivateCards(p.id, p.holeCards);
        }
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
          const botAction = getBotAction(currentState, activePlayer);
          processActionAsHost(botAction);
        }, 1000 + Math.random() * 800);

        return () => clearTimeout(timer);
      }
    }
  }, [gameState, isHost]);

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
    let targetIndex = seatIdx !== undefined ? seatIdx : currentState.players.findIndex(p => p === null);

    if (targetIndex === -1) return;

    const botNames = ['高斯', '图灵', '阿尔法', '深蓝', '冯诺依曼', '香农'];
    const botName = 'AI·' + botNames[Math.floor(Math.random() * botNames.length)];

    const botPlayer: Player = {
      id: 'bot-' + Math.random().toString(36).substring(2, 8),
      name: botName,
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
    setGameState(nextState);
    networkRef.current?.broadcastState(nextState);
  };

  // 9. 一键单人秒开 (自带5个电脑)
  const handleQuickPractice = async () => {
    const roomId = 'SOLO-' + Math.floor(100 + Math.random() * 900);
    await initHostGame(roomId, '扑克高手');

    setTimeout(() => {
      const botNames = ['图灵', '阿尔法', '高斯', '深蓝', '香农'];
      const current = stateRef.current;
      const filledPlayers = [...current.players];

      for (let i = 1; i <= 5; i++) {
        filledPlayers[i] = {
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
        };
      }

      const readyState = { ...current, players: filledPlayers };
      setGameState(readyState);

      // 自动发牌开始第一局
      const { state: startedState, deck } = startNewHand(readyState);
      deckRef.current = deck;
      setGameState(startedState);
      if (startedState.players[0]) {
        setMyPrivateCards(startedState.players[0].holeCards);
      }
    }, 400);
  };

  // 当前视角玩家
  let localPlayer = gameState.players.find(p => p && p.id === localPlayerId) || null;
  // 如果是客户端，把私密底牌合并进当前展示
  if (localPlayer && !isHost && myPrivateCards.length === 2) {
    localPlayer = { ...localPlayer, holeCards: myPrivateCards };
  }

  const activeCount = gameState.players.filter(p => p !== null && p.chips > 0).length;
  const canStartHand = isHost && (gameState.stage === 'WAITING' || gameState.stage === 'SHOWDOWN') && activeCount >= 2;

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
          canStart={canStartHand}
          onStartHand={handleStartHand}
          onAddBot={() => handleAddBot()}
          handNumber={gameState.handNumber}
        />
      )}

      {/* 核心扑克桌 */}
      {!inLobby && (
        <main className="flex-1 w-full flex items-center justify-center p-2 relative">
          <Table
            gameState={gameState}
            localPlayer={localPlayer}
            onSitDown={seatIdx => {
              // 占位
            }}
            onAddBot={isHost ? seatIdx => handleAddBot(seatIdx) : undefined}
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
