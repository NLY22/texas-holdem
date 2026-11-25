import React, { useEffect, useState } from 'react';
import {
  DEFAULT_ROOM_CONFIG,
  GameState,
  Player,
  TableTheme,
} from '../types/poker';
import { Seat } from './Seat';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { Trophy, Play, RefreshCw, Eye, Sparkles, MessageCircle, Coins } from 'lucide-react';
import { evaluate7Cards } from '../engine/evaluator';
import confetti from 'canvas-confetti';

interface TableProps {
  gameState: GameState;
  localPlayer: Player | null;
  theme: TableTheme;
  chatByPlayerId: Record<string, string>;
  onSitDown?: (seatIndex: number) => void;
  onAddBot?: (seatIndex: number) => void;
  onRemoveBot?: (seatIndex: number) => void;
  onKickPlayer?: (seatIndex: number) => void;
  onNextHand?: () => void;
  onRebuy?: () => void;
  onTopUp?: () => void;
  onShowWinnerCards?: () => void;
  onRabbitHunt?: () => void;
  onSendQuickChat?: (text: string) => void;
}

const FELT_STYLES: Record<TableTheme, { wood: string; rail: string; felt: string }> = {
  emerald: {
    wood: 'from-[#2a1b14] via-[#1a0f0a] to-[#2a1b14] border-[#4a2e1b]',
    rail: 'from-[#143d1a] to-[#0d2811] border-emerald-500/20',
    felt: 'bg-radial from-emerald-700 via-emerald-800 to-emerald-950',
  },
  obsidian: {
    wood: 'from-[#1f1c18] via-[#0e0d0b] to-[#1f1c18] border-amber-700/40',
    rail: 'from-[#1c1917] to-[#09090b] border-amber-500/25',
    felt: 'bg-radial from-neutral-800 via-neutral-900 to-black',
  },
  navy: {
    wood: 'from-[#1e293b] via-[#0f172a] to-[#1e293b] border-sky-700/40',
    rail: 'from-[#0f2942] to-[#081526] border-sky-400/20',
    felt: 'bg-radial from-sky-800 via-slate-900 to-slate-950',
  },
};

const QUICK_PHRASES = [
  '👏 漂亮！',
  '🔥 搞快点',
  '🤔 我想想',
  '🙏 来张好牌',
  '😂 偷鸡抓住了',
  '🍻 老板大气',
];

export const Table: React.FC<TableProps> = ({
  gameState,
  localPlayer,
  theme,
  chatByPlayerId,
  onSitDown,
  onAddBot,
  onRemoveBot,
  onKickPlayer,
  onNextHand,
  onRebuy,
  onTopUp,
  onShowWinnerCards,
  onRabbitHunt,
  onSendQuickChat,
}) => {
  const {
    players,
    communityCards,
    pots,
    totalPot,
    stage,
    dealerIndex,
    smallBlindIndex,
    bigBlindIndex,
    activePlayerIndex,
    winners,
    handNumber,
    hostId,
    config,
    turnDeadline,
    nextHandDeadline,
    earlyWinCanShow,
    rabbitCards,
    hasRabbitHunted,
  } = gameState;

  const cfg = config || DEFAULT_ROOM_CONFIG;
  const isHost = Boolean(localPlayer && localPlayer.id === hostId);
  const [nextHandCountdown, setNextHandCountdown] = useState<number>(0);
  const [chatOpen, setChatOpen] = useState(false);

  // 赢家撒花特效
  useEffect(() => {
    if (stage === 'SHOWDOWN' && winners.length > 0 && localPlayer) {
      const amIWinner = winners.some(w => w.playerId === localPlayer.id);
      if (amIWinner) {
        confetti({
          particleCount: 55,
          spread: 65,
          origin: { y: 0.7 },
        });
      }
    }
  }, [stage, handNumber, winners.length, localPlayer?.id]);

  // 自动下一手倒计时展示
  useEffect(() => {
    if (stage !== 'SHOWDOWN' || !nextHandDeadline) {
      setNextHandCountdown(0);
      return;
    }
    const tick = () => {
      setNextHandCountdown(Math.max(0, Math.ceil((nextHandDeadline - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [stage, nextHandDeadline]);

  let handTip = '';
  if (localPlayer && !localPlayer.folded && localPlayer.holeCards.length === 2) {
    const ev = evaluate7Cards(localPlayer.holeCards, communityCards);
    handTip = ev.name;
  }

  // 最佳 5 张牌高亮集合（仅真实摊牌 5 张公共牌时高亮）
  const highlightKeys = new Set<string>();
  if (stage === 'SHOWDOWN' && communityCards.length === 5 && winners.length > 0) {
    for (const w of winners) {
      for (const c of w.cards || []) {
        highlightKeys.add(`${c.suit}-${c.rank}`);
      }
    }
  }

  // 6人桌以本地玩家席位为底部正中旋转
  const anchorSeat = localPlayer ? localPlayer.seatIndex : 0;
  const seatPositions = [
    '-bottom-8 sm:-bottom-9 left-1/2 -translate-x-1/2', // visual 0: 底部中间 (自己)
    'bottom-[15%] left-0 sm:left-4',                    // visual 1: 左下
    'top-[15%] left-0 sm:left-4',                       // visual 2: 左上
    '-top-10 sm:-top-11 left-1/2 -translate-x-1/2',     // visual 3: 顶部中间
    'top-[15%] right-0 sm:right-4',                     // visual 4: 右上
    'bottom-[15%] right-0 sm:right-4',                  // visual 5: 右下
  ];

  const canModifySeats = stage === 'WAITING' || stage === 'SHOWDOWN';
  const isBusted =
    Boolean(localPlayer && localPlayer.chips <= 0 && (stage === 'SHOWDOWN' || stage === 'WAITING'));
  const canTopUp =
    Boolean(
      localPlayer &&
        (stage === 'SHOWDOWN' || stage === 'WAITING') &&
        localPlayer.chips > 0 &&
        localPlayer.chips < cfg.startingChips
    );
  const amIEarlyWinner = Boolean(
    localPlayer && winners.some(w => w.playerId === localPlayer.id)
  );
  const canShowEarly = Boolean(stage === 'SHOWDOWN' && earlyWinCanShow && amIEarlyWinner);
  const canRabbitHunt = Boolean(
    stage === 'SHOWDOWN' && communityCards.length < 5 && !hasRabbitHunted && onRabbitHunt
  );

  const skin = FELT_STYLES[theme] || FELT_STYLES.emerald;

  return (
    <div className="relative w-full max-w-5xl h-[540px] sm:h-[590px] my-auto flex items-center justify-center px-2.5 sm:px-8 py-4 select-none">
      {/* 椭圆实木外边框 */}
      <div
        className={`relative w-full h-full rounded-[135px] sm:rounded-[200px] bg-gradient-to-b p-3 sm:p-4 shadow-2xl border-4 ${skin.wood}`}
      >
        {/* 皮质扶手内衬 */}
        <div
          className={`relative w-full h-full rounded-[115px] sm:rounded-[180px] bg-gradient-to-b p-2 sm:p-3 shadow-inner border ${skin.rail}`}
        >
          {/* 绒面桌布 */}
          <div
            className={`relative w-full h-full rounded-[105px] sm:rounded-[165px] ${skin.felt} flex flex-col items-center justify-center shadow-table overflow-hidden px-10 sm:px-20`}
          >
            {/* 水印 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
              <div className="text-7xl sm:text-9xl font-black tracking-widest text-white">
                ♠ ♥ ♦ ♣
              </div>
            </div>

            {/* 快捷聊天触发按钮 */}
            {onSendQuickChat && localPlayer && (
              <div className="absolute bottom-3 right-5 sm:right-10 z-30">
                {chatOpen && (
                  <div className="absolute bottom-9 right-0 bg-neutral-950/95 border border-white/15 rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1 min-w-[120px] animate-in fade-in zoom-in-95">
                    {QUICK_PHRASES.map(phrase => (
                      <button
                        key={phrase}
                        onClick={() => {
                          onSendQuickChat(phrase);
                          setChatOpen(false);
                        }}
                        className="px-2.5 py-1.5 text-left text-[11px] font-semibold text-neutral-100 hover:bg-amber-400/20 hover:text-amber-300 rounded-lg whitespace-nowrap"
                      >
                        {phrase}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setChatOpen(v => !v)}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/75 border border-white/15 text-amber-300 shadow-lg transition-all"
                  title="发送快捷表情短语"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 桌布中央区 */}
            <div className="relative z-10 flex flex-col items-center">
              <PotDisplay totalPot={totalPot} pots={pots} />
              <CommunityCards
                cards={communityCards}
                stage={stage}
                highlightKeys={highlightKeys}
                rabbitCards={rabbitCards}
              />

              {handTip && stage !== 'WAITING' && stage !== 'SHOWDOWN' && (
                <div className="mt-1 bg-black/75 backdrop-blur-md px-3 py-0.5 rounded-full border border-emerald-400/40 text-[11px] text-emerald-300 font-semibold shadow-md">
                  您的牌型: <b className="text-amber-300 font-bold">{handTip}</b>
                </div>
              )}

              {/* 摊牌公布横幅 */}
              {stage === 'SHOWDOWN' && (
                <div className="animate-in zoom-in-95 fade-in duration-300 mt-1.5 flex flex-col items-center gap-2 z-30">
                  {winners.length > 0 && (
                    <div className="bg-gradient-to-r from-amber-950/95 via-black/95 to-amber-950/95 border border-amber-400 px-3.5 py-1.5 rounded-xl flex items-center gap-2 shadow-2xl backdrop-blur-md max-w-[285px] sm:max-w-lg">
                      <Trophy className="w-4 h-4 text-amber-400 animate-bounce shrink-0" />
                      <div className="flex flex-col items-start leading-tight gap-0.5">
                        {winners.map(w => (
                          <div key={w.playerId} className="text-[11px] sm:text-xs font-bold text-amber-200">
                            <span className="text-amber-300 font-black">
                              {w.name} +${w.amount}
                            </span>
                            {w.potLabel && w.potLabel !== '底池' && (
                              <span className="text-[10px] text-amber-400/80 ml-1">[{w.potLabel}]</span>
                            )}
                            <span className="text-[10px] text-neutral-300 ml-1.5">· {w.handName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {isBusted && onRebuy && (
                      <button
                        onClick={onRebuy}
                        className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-xs rounded-full shadow-lg flex items-center gap-1 active:scale-95 transition-all"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> 补充筹码 (${cfg.startingChips})
                      </button>
                    )}

                    {canTopUp && onTopUp && (
                      <button
                        onClick={onTopUp}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-amber-400/40 text-amber-200 font-bold text-xs rounded-full shadow flex items-center gap-1 active:scale-95 transition-all"
                      >
                        <Coins className="w-3.5 h-3.5" /> 补满 (${cfg.startingChips})
                      </button>
                    )}

                    {canShowEarly && onShowWinnerCards && (
                      <button
                        onClick={onShowWinnerCards}
                        className="px-3 py-1.5 bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-400/50 text-emerald-200 font-bold text-xs rounded-full shadow flex items-center gap-1 active:scale-95 transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" /> 秀一手亮牌
                      </button>
                    )}

                    {canRabbitHunt && (
                      <button
                        onClick={onRabbitHunt}
                        className="px-3 py-1.5 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-400/40 text-cyan-200 font-bold text-xs rounded-full shadow flex items-center gap-1 active:scale-95 transition-all"
                      >
                        <Sparkles className="w-3.5 h-3.5" /> 看看后面发什么
                      </button>
                    )}

                    {onNextHand && (
                      <button
                        onClick={onNextHand}
                        className="px-4 py-1.5 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-300 text-black font-black text-xs sm:text-sm rounded-full shadow-lg shadow-amber-500/30 flex items-center gap-1.5 active:scale-95 transition-all animate-pulse"
                      >
                        <Play className="w-3.5 h-3.5 fill-black" />
                        {nextHandCountdown > 0 ? `下一手 (${nextHandCountdown}s)` : '下一手牌'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 6 个席位按本地视角旋转定位 */}
        {players.map((player, seatIdx) => {
          const visualPos = (seatIdx - anchorSeat + 6) % 6;
          return (
            <Seat
              key={seatIdx}
              player={player}
              seatIndex={seatIdx}
              isCurrentTurn={stage !== 'WAITING' && stage !== 'SHOWDOWN' && activePlayerIndex === seatIdx}
              isDealer={stage !== 'WAITING' && dealerIndex === seatIdx}
              isSmallBlind={stage !== 'WAITING' && smallBlindIndex === seatIdx}
              isBigBlind={stage !== 'WAITING' && bigBlindIndex === seatIdx}
              isLocalPlayer={Boolean(localPlayer && player && player.id === localPlayer.id)}
              isRoomHost={Boolean(player && player.id === hostId)}
              canSitHere={canModifySeats && Boolean(onSitDown)}
              canHostManage={isHost && (canModifySeats || Boolean(player?.isBot))}
              turnDeadline={turnDeadline}
              turnDurationSec={cfg.actionTimeoutSec}
              highlightKeys={highlightKeys}
              quickChatText={player ? chatByPlayerId[player.id] : undefined}
              onSitDown={onSitDown}
              onAddBot={isHost ? onAddBot : undefined}
              onRemoveBot={isHost ? onRemoveBot : undefined}
              onKickPlayer={isHost && canModifySeats ? onKickPlayer : undefined}
              className={`absolute z-20 ${seatPositions[visualPos]}`}
            />
          );
        })}
      </div>
    </div>
  );
};
