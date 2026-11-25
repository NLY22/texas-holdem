import React, { useState, useEffect, useRef } from 'react';
import {
  BotPersonality,
  Card,
  DEFAULT_ROOM_CONFIG,
  GameAction,
  GameState,
  Player,
  RoomConfig,
  TableTheme,
} from './types/poker';
import {
  addBotToSeat,
  addPlayerToSeat,
  applyTimeoutAction,
  clearAllBots,
  createInitialState,
  handlePlayerAction,
  isSeatEligibleForHand,
  leaveSeat,
  rebuyOrTopUpPlayer,
  removeOrToggleBot,
  resetTableForNewRound,
  revealEarlyWinCards,
  revealRabbitHunt,
  sitPlayerAtSeat,
  startNewHand,
  togglePlayerSitOut,
} from './engine/state-machine';
import { getBotAction } from './engine/bot';
import {
  clearSavedSession,
  ConnectionStatus,
  DissolvedInfo,
  getSavedSession,
  normalizeRoomId,
  P2PNetwork,
} from './network/p2p';
import { Table } from './components/Table';
import { ActionControls } from './components/ActionControls';
import { HeaderBar } from './components/HeaderBar';
import { LobbyModal } from './components/LobbyModal';
import { SettlementModal } from './components/SettlementModal';
import { RoomSettingsModal } from './components/RoomSettingsModal';
import { HandHistoryDrawer } from './components/HandHistoryDrawer';
import { soundManager } from './audio/sounds';

const THEME_KEY = 'tx_holdem_theme';

function loadSavedTheme(): TableTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'emerald' || v === 'obsidian' || v === 'navy') return v;
  } catch {}
  return 'emerald';
}

export const App: React.FC = () => {
  const [inLobby, setInLobby] = useState(true);
  const [isPractice, setIsPractice] = useState(false);
  const [gameState, setGameState] = useState<GameState>(() =>
    createInitialState('TX-0000', '')
  );
  const [localPlayerId, setLocalPlayerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('closed');
  const [theme, setTheme] = useState<TableTheme>(loadSavedTheme);
  const [toastMsg, setToastMsg] = useState<string>('');
  const [chatByPlayerId, setChatByPlayerId] = useState<Record<string, string>>({});

  // 弹窗开关
  const [showSettlement, setShowSettlement] = useState(false);
  const [dissolvedInfo, setDissolvedInfo] = useState<DissolvedInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const networkRef = useRef<P2PNetwork | null>(null);
  const deckRef = useRef<Card[]>([]);
  const stateRef = useRef<GameState>(gameState);

  const initialRoomParam =
    typeof window !== 'undefined'
      ? normalizeRoomId(new URLSearchParams(window.location.search).get('room') || '')
      : '';

  const showToast = (text: string) => {
    setToastMsg(text);
    setTimeout(() => {
      setToastMsg(prev => (prev === text ? '' : prev));
    }, 3200);
  };

  const handleChangeTheme = (next: TableTheme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  };

  const applyLocalState = (next: GameState) => {
    stateRef.current = next;
    setGameState(next);
  };

  const attachNetworkHandlers = () =>
    new P2PNetwork({
      onStateUpdate: state => {
        applyLocalState(state);
      },
      onConnectionChange: status => {
        setConnectionStatus(status);
      },
      onToast: text => {
        showToast(text);
      },
      onQuickChat: ev => {
        setChatByPlayerId(prev => ({ ...prev, [ev.playerId]: ev.text }));
        setTimeout(() => {
          setChatByPlayerId(prev => {
            if (prev[ev.playerId] !== ev.text) return prev;
            const copy = { ...prev };
            delete copy[ev.playerId];
            return copy;
          });
        }, 2800);
      },
      onRoomDissolved: info => {
        setDissolvedInfo(info);
        setShowSettings(false);
        setShowHistory(false);
      },
      onKicked: reason => {
        networkRef.current?.destroy();
        networkRef.current = null;
        setInLobby(true);
        setShowSettlement(false);
        setShowSettings(false);
        setShowHistory(false);
        showToast(reason);
      },
    });

  // 自动恢复意外刷新前的房间会话 (URL 携带 ?room=XXXX 且 sessionStorage 有对应凭证)
  useEffect(() => {
    if (!initialRoomParam) return;
    const saved = getSavedSession(initialRoomParam);
    if (!saved) return;

    let cancelled = false;
    const net = attachNetworkHandlers();
    net
      .reattachRoom(saved)
      .then(state => {
        if (cancelled) {
          net.destroy();
          return;
        }
        networkRef.current = net;
        setIsPractice(false);
        setLocalPlayerId(net.myId);
        applyLocalState(state);
        setInLobby(false);
        showToast('已为您恢复到原牌桌席位');
      })
      .catch(() => {
        net.destroy();
        clearSavedSession(initialRoomParam);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 1. 创建好友联机房间
  const initHostGame = async (roomId: string, playerName: string, config: RoomConfig) => {
    const net = attachNetworkHandlers();
    try {
      const state = await net.createRoom(roomId, playerName, config);
      networkRef.current = net;
      setIsPractice(false);
      setLocalPlayerId(net.myId);
      applyLocalState(state);
      setDissolvedInfo(null);
      setInLobby(false);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomId);
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {
      net.destroy();
      throw e;
    }
  };

  // 2. 加入好友联机房间
  const initClientGame = async (roomId: string, playerName: string) => {
    const net = attachNetworkHandlers();
    try {
      const state = await net.joinRoom(roomId, playerName);
      networkRef.current = net;
      setIsPractice(false);
      setLocalPlayerId(net.myId);
      applyLocalState(state);
      setDissolvedInfo(null);
      setInLobby(false);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('room', normalizeRoomId(roomId));
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {
      net.destroy();
      throw e;
    }
  };

  // 3. 本地单人快速练习 (复用同一套本地引擎)
  const handleQuickPractice = (nickname: string, config: RoomConfig) => {
    networkRef.current?.destroy();
    networkRef.current = null;

    const localId = 'local-player-0';
    let s = createInitialState('PRACTICE', localId, config);
    s = addPlayerToSeat(s, { id: localId, name: nickname || '您 (VIP)' }).state;
    for (let i = 1; i <= 5; i++) {
      s = addBotToSeat(s, i);
    }
    const { state: started, deck } = startNewHand(s);
    if (config.actionTimeoutSec > 0 && started.stage !== 'SHOWDOWN') {
      started.turnDeadline = Date.now() + config.actionTimeoutSec * 1000;
    }
    deckRef.current = deck;
    applyLocalState(started);
    setLocalPlayerId(localId);
    setIsPractice(true);
    setConnectionStatus('connected');
    setDissolvedInfo(null);
    setInLobby(false);
    soundManager.playCardDeal();
  };

  // 单机模式：Bot 行动定时器
  useEffect(() => {
    if (!isPractice || inLobby) return;
    if (
      gameState.stage === 'WAITING' ||
      gameState.stage === 'SHOWDOWN' ||
      gameState.activePlayerIndex === -1
    ) {
      return;
    }

    const active = gameState.players[gameState.activePlayerIndex];
    if (active && active.isBot && !active.folded && !active.isAllIn) {
      const timer = setTimeout(() => {
        const cur = stateRef.current;
        if (cur.activePlayerIndex !== active.seatIndex) return;
        const botAction = getBotAction(cur, active);
        const res = handlePlayerAction(cur, botAction, deckRef.current);
        deckRef.current = res.deck;
        const cfg = res.state.config || DEFAULT_ROOM_CONFIG;
        if (
          cfg.actionTimeoutSec > 0 &&
          res.state.stage !== 'SHOWDOWN' &&
          res.state.activePlayerIndex !== -1 &&
          !res.state.players[res.state.activePlayerIndex]?.isBot
        ) {
          res.state.turnDeadline = Date.now() + cfg.actionTimeoutSec * 1000;
        }
        if (cfg.autoNextHand && res.state.stage === 'SHOWDOWN') {
          res.state.nextHandDeadline = Date.now() + 5000;
        }
        applyLocalState(res.state);
      }, 650 + Math.random() * 450);
      return () => clearTimeout(timer);
    }
  }, [isPractice, inLobby, gameState.activePlayerIndex, gameState.stage, gameState.actionSeq]);

  // 单机模式：人类回合超时定时器 & 自动下一手定时器
  useEffect(() => {
    if (!isPractice || inLobby) return;
    const cfg = gameState.config || DEFAULT_ROOM_CONFIG;

    if (
      cfg.actionTimeoutSec > 0 &&
      gameState.turnDeadline &&
      gameState.stage !== 'WAITING' &&
      gameState.stage !== 'SHOWDOWN'
    ) {
      const delay = Math.max(50, gameState.turnDeadline - Date.now());
      const timer = setTimeout(() => {
        const res = applyTimeoutAction(stateRef.current, deckRef.current);
        deckRef.current = res.deck;
        if (
          cfg.actionTimeoutSec > 0 &&
          res.state.stage !== 'SHOWDOWN' &&
          res.state.activePlayerIndex !== -1 &&
          !res.state.players[res.state.activePlayerIndex]?.isBot
        ) {
          res.state.turnDeadline = Date.now() + cfg.actionTimeoutSec * 1000;
        }
        applyLocalState(res.state);
      }, delay);
      return () => clearTimeout(timer);
    }

    if (cfg.autoNextHand && gameState.stage === 'SHOWDOWN' && gameState.nextHandDeadline) {
      const delay = Math.max(50, gameState.nextHandDeadline - Date.now());
      const timer = setTimeout(() => {
        handleStartHand();
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [isPractice, inLobby, gameState.stage, gameState.turnDeadline, gameState.nextHandDeadline]);

  // 统一操作派发（联机发给 Durable Object；单机本地执行）
  const handleStartHand = () => {
    soundManager.playCardDeal();
    if (!isPractice) {
      networkRef.current?.startHand();
      return;
    }
    let cur = stateRef.current;
    // 单机练习自动给输光的 AI 补买，保持流畅
    const aliveHumans = cur.players.filter(p => p && !p.isBot && p.chips > 0).length;
    const aliveBots = cur.players.filter(p => p && p.isBot && p.chips > 0).length;
    if (aliveHumans + aliveBots < 2) {
      cur = {
        ...cur,
        players: cur.players.map(p =>
          p && p.isBot && p.chips <= 0
            ? {
                ...p,
                chips: cur.config?.startingChips ?? 1000,
                totalBuyIn: (p.totalBuyIn ?? 1000) + (cur.config?.startingChips ?? 1000),
                status: 'ACTIVE',
              }
            : p
        ),
      };
    }
    const res = startNewHand(cur);
    deckRef.current = res.deck;
    const cfg = res.state.config || DEFAULT_ROOM_CONFIG;
    if (
      cfg.actionTimeoutSec > 0 &&
      res.state.stage !== 'SHOWDOWN' &&
      res.state.activePlayerIndex !== -1 &&
      !res.state.players[res.state.activePlayerIndex]?.isBot
    ) {
      res.state.turnDeadline = Date.now() + cfg.actionTimeoutSec * 1000;
    }
    applyLocalState(res.state);
  };

  const handleLocalAction = (action: GameAction) => {
    if (!isPractice) {
      networkRef.current?.sendAction(action);
      return;
    }
    const res = handlePlayerAction(stateRef.current, action, deckRef.current);
    deckRef.current = res.deck;
    const cfg = res.state.config || DEFAULT_ROOM_CONFIG;
    if (
      cfg.actionTimeoutSec > 0 &&
      res.state.stage !== 'SHOWDOWN' &&
      res.state.activePlayerIndex !== -1 &&
      !res.state.players[res.state.activePlayerIndex]?.isBot
    ) {
      res.state.turnDeadline = Date.now() + cfg.actionTimeoutSec * 1000;
    }
    if (cfg.autoNextHand && res.state.stage === 'SHOWDOWN') {
      res.state.nextHandDeadline = Date.now() + 5000;
    }
    applyLocalState(res.state);
  };

  const handleAddBot = (seatIdx?: number, personality?: BotPersonality) => {
    if (!isPractice) {
      networkRef.current?.addBot(seatIdx, personality);
      return;
    }
    applyLocalState(addBotToSeat(stateRef.current, seatIdx, personality));
  };

  const handleRemoveBot = (seatIdx: number) => {
    if (!isPractice) {
      networkRef.current?.removeBot(seatIdx);
      return;
    }
    applyLocalState(removeOrToggleBot(stateRef.current, seatIdx));
  };

  const handleClearBots = () => {
    if (!isPractice) {
      networkRef.current?.clearBots();
      return;
    }
    applyLocalState(clearAllBots(stateRef.current));
  };

  const handleSitDown = (seatIdx: number) => {
    if (!isPractice) {
      networkRef.current?.sitAtSeat(seatIdx);
      return;
    }
    applyLocalState(sitPlayerAtSeat(stateRef.current, localPlayerId, seatIdx));
  };

  const handleToggleSitOut = () => {
    if (!isPractice) {
      networkRef.current?.toggleSitOut();
      return;
    }
    applyLocalState(togglePlayerSitOut(stateRef.current, localPlayerId));
  };

  const handleRebuyOrTopUp = (mode: 'rebuy' | 'topup') => {
    if (!isPractice) {
      networkRef.current?.sendRebuyRequest(mode);
      return;
    }
    applyLocalState(rebuyOrTopUpPlayer(stateRef.current, localPlayerId, mode));
  };

  const handleUpdateConfig = (next: Partial<RoomConfig>) => {
    if (!isPractice) {
      networkRef.current?.updateConfig(next);
      return;
    }
    const merged = { ...(stateRef.current.config || DEFAULT_ROOM_CONFIG), ...next };
    applyLocalState({
      ...stateRef.current,
      config: merged,
      ...(stateRef.current.stage === 'WAITING'
        ? {
            smallBlind: merged.smallBlind,
            bigBlind: merged.bigBlind,
            ante: merged.ante,
            minRaise: merged.bigBlind,
          }
        : {}),
    });
    showToast('房间参数已更新');
  };

  const handleKickPlayer = (seatIdx: number) => {
    if (!isPractice) {
      networkRef.current?.kickPlayer(seatIdx);
      return;
    }
    const target = stateRef.current.players[seatIdx];
    if (target) {
      const res = leaveSeat(stateRef.current, target.id, deckRef.current);
      deckRef.current = res.deck;
      applyLocalState(res.state);
    }
  };

  const handleLeaveRoom = () => {
    if (networkRef.current) {
      if (dissolvedInfo) {
        networkRef.current.destroy();
      } else {
        networkRef.current.leaveRoom();
      }
      networkRef.current = null;
    }
    clearSavedSession(gameState.roomId);
    setDissolvedInfo(null);
    setShowSettlement(false);
    setShowSettings(false);
    setShowHistory(false);
    setInLobby(true);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleTransferAndLeave = (targetPlayerId: string) => {
    if (!networkRef.current) return;
    networkRef.current.transferHost(targetPlayerId);
    setTimeout(() => {
      handleLeaveRoom();
    }, 120);
  };

  const handleDissolveRoom = () => {
    if (isPractice) {
      handleLeaveRoom();
      return;
    }
    networkRef.current?.dissolveRoom();
  };

  const handleResetTable = () => {
    if (!isPractice) {
      networkRef.current?.resetTable();
      return;
    }
    deckRef.current = [];
    applyLocalState(resetTableForNewRound(stateRef.current));
    showToast('已重置全员筹码，开启新一轮');
  };

  const localPlayer = gameState.players.find(p => p && p.id === localPlayerId) || null;
  const isHost = Boolean(localPlayerId && gameState.hostId === localPlayerId);
  const eligibleCount = gameState.players.filter(isSeatEligibleForHand).length;
  const botCount = gameState.players.filter(p => p && p.isBot).length;
  const isTableFull = gameState.players.every(p => p !== null);
  const canStartInHeader = isHost && gameState.stage === 'WAITING' && eligibleCount >= 2;
  const cfg = gameState.config || DEFAULT_ROOM_CONFIG;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-between bg-neutral-950 overflow-hidden relative">
      {/* 顶部全局 Toast */}
      {toastMsg && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-amber-400 text-black text-xs font-black shadow-2xl animate-in fade-in slide-in-from-top-2 whitespace-nowrap">
          {toastMsg}
        </div>
      )}

      {/* 大厅弹窗 */}
      {inLobby && (
        <LobbyModal
          initialRoomId={initialRoomParam}
          onCreateRoom={async (nickname, config) => {
            const rid = 'TX-' + Math.floor(1000 + Math.random() * 9000);
            await initHostGame(rid, nickname, config);
          }}
          onJoinRoom={async (rid, nickname) => {
            await initClientGame(rid, nickname);
          }}
          onQuickPractice={handleQuickPractice}
        />
      )}

      {/* 顶部栏 */}
      {!inLobby && (
        <HeaderBar
          roomId={gameState.roomId}
          isHost={isHost}
          isPractice={isPractice}
          canStart={canStartInHeader}
          isTableFull={isTableFull}
          handNumber={gameState.handNumber}
          smallBlind={gameState.smallBlind}
          bigBlind={gameState.bigBlind}
          connectionStatus={connectionStatus}
          onStartHand={handleStartHand}
          onAddBot={() => handleAddBot()}
          onOpenHistory={() => setShowHistory(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenSettlement={() => setShowSettlement(true)}
        />
      )}

      {/* 核心扑克桌 */}
      {!inLobby && (
        <main className="flex-1 w-full flex items-center justify-center px-2 pt-8 pb-40 sm:pb-44 relative">
          <Table
            gameState={gameState}
            localPlayer={localPlayer}
            theme={theme}
            chatByPlayerId={chatByPlayerId}
            onSitDown={handleSitDown}
            onAddBot={isHost ? idx => handleAddBot(idx) : undefined}
            onRemoveBot={isHost ? handleRemoveBot : undefined}
            onKickPlayer={isHost ? handleKickPlayer : undefined}
            onNextHand={isHost && eligibleCount >= 2 ? handleStartHand : undefined}
            onRebuy={() => handleRebuyOrTopUp('rebuy')}
            onTopUp={() => handleRebuyOrTopUp('topup')}
            onShowWinnerCards={() => {
              if (isPractice) applyLocalState(revealEarlyWinCards(stateRef.current, localPlayerId));
              else networkRef.current?.showWinnerCards();
            }}
            onRabbitHunt={() => {
              if (isPractice) applyLocalState(revealRabbitHunt(stateRef.current, deckRef.current));
              else networkRef.current?.rabbitHunt();
            }}
            onSendQuickChat={
              !isPractice
                ? text => networkRef.current?.sendQuickChat(text)
                : text => {
                    if (!localPlayer) return;
                    setChatByPlayerId(prev => ({ ...prev, [localPlayer.id]: text }));
                    setTimeout(() => {
                      setChatByPlayerId(prev => {
                        if (prev[localPlayer.id] !== text) return prev;
                        const copy = { ...prev };
                        delete copy[localPlayer.id];
                        return copy;
                      });
                    }, 2600);
                  }
            }
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

      {/* 战绩账本与离桌/解散弹窗 */}
      {(showSettlement || dissolvedInfo) && (
        <SettlementModal
          mode={dissolvedInfo ? 'dissolved' : 'live'}
          roomId={gameState.roomId}
          roundNumber={dissolvedInfo ? dissolvedInfo.roundNumber : gameState.roundNumber || 1}
          handNumber={dissolvedInfo ? dissolvedInfo.handNumber : gameState.handNumber}
          stage={gameState.stage}
          isHost={isHost}
          isPractice={isPractice}
          localPlayer={localPlayer}
          players={gameState.players}
          ledger={dissolvedInfo ? dissolvedInfo.ledger : gameState.ledger || {}}
          onClose={() => setShowSettlement(false)}
          onLeaveRoom={handleLeaveRoom}
          onTransferAndLeave={!isPractice ? handleTransferAndLeave : undefined}
          onResetTable={handleResetTable}
          onDissolveRoom={handleDissolveRoom}
        />
      )}

      {/* 牌桌管理、皮肤、AI 增删设置 */}
      {showSettings && !inLobby && (
        <RoomSettingsModal
          isHost={isHost}
          stage={gameState.stage}
          config={cfg}
          theme={theme}
          localPlayer={localPlayer}
          botCount={botCount}
          isTableFull={isTableFull}
          onChangeTheme={handleChangeTheme}
          onToggleSitOut={handleToggleSitOut}
          onTopUp={() => handleRebuyOrTopUp('topup')}
          onAddBot={p => handleAddBot(undefined, p)}
          onClearBots={handleClearBots}
          onUpdateConfig={handleUpdateConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* 牌局手数动作流水 */}
      {showHistory && !inLobby && (
        <HandHistoryDrawer
          history={gameState.handHistory || []}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
};

export default App;
