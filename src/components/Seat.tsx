import React, { useEffect, useState } from 'react';
import { Player } from '../types/poker';
import { CardView } from './CardView';
import { Bot, User, Plus, X, Crown, WifiOff } from 'lucide-react';

interface SeatProps {
  player: Player | null;
  seatIndex: number;
  isCurrentTurn: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isLocalPlayer: boolean;
  isRoomHost: boolean;
  canSitHere: boolean;
  canHostManage: boolean;
  turnDeadline?: number;
  turnDurationSec: number;
  highlightKeys?: Set<string>;
  quickChatText?: string;
  onSitDown?: (seatIndex: number) => void;
  onAddBot?: (seatIndex: number) => void;
  onRemoveBot?: (seatIndex: number) => void;
  onKickPlayer?: (seatIndex: number) => void;
  className?: string;
}

const PERSONALITY_BADGE: Record<string, string> = {
  LOOSE: '松鱼',
  TAG: '稳健',
  LAG: '疯狗',
};

const TONE_CLASS: Record<string, string> = {
  fold: 'bg-neutral-800 text-neutral-300 border-white/15',
  check: 'bg-sky-950/90 text-sky-200 border-sky-400/40',
  call: 'bg-blue-950/90 text-blue-200 border-blue-400/50',
  raise: 'bg-amber-950/90 text-amber-300 border-amber-400/60',
  allin: 'bg-rose-700 text-white border-rose-300/70',
  sitout: 'bg-neutral-800 text-neutral-300 border-white/15',
  show: 'bg-emerald-700 text-white border-emerald-300/70',
};

export const Seat: React.FC<SeatProps> = ({
  player,
  seatIndex,
  isCurrentTurn,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isLocalPlayer,
  isRoomHost,
  canSitHere,
  canHostManage,
  turnDeadline,
  turnDurationSec,
  highlightKeys,
  quickChatText,
  onSitDown,
  onAddBot,
  onRemoveBot,
  onKickPlayer,
  className = '',
}) => {
  const [remainingSec, setRemainingSec] = useState<number>(0);

  useEffect(() => {
    if (!isCurrentTurn || !turnDeadline || turnDurationSec <= 0) {
      setRemainingSec(0);
      return;
    }
    const update = () => {
      const left = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      setRemainingSec(left);
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [isCurrentTurn, turnDeadline, turnDurationSec]);

  if (!player) {
    return (
      <div className={`flex flex-col items-center justify-center ${className}`}>
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-dashed border-white/20 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center gap-0.5 text-white/50 hover:text-white hover:border-amber-400 hover:bg-black/60 transition-all p-1">
          {canSitHere && onSitDown && (
            <button
              onClick={() => onSitDown(seatIndex)}
              className="text-[10px] font-bold text-amber-300 hover:underline flex items-center gap-0.5 whitespace-nowrap"
            >
              <Plus className="w-2.5 h-2.5" /> 坐这
            </button>
          )}
          {onAddBot && (
            <button
              onClick={() => onAddBot(seatIndex)}
              className="text-[10px] text-emerald-300 hover:underline flex items-center gap-0.5 whitespace-nowrap"
            >
              <Bot className="w-2.5 h-2.5" /> +AI
            </button>
          )}
          {!canSitHere && !onAddBot && (
            <span className="text-[9px] text-white/25">空位</span>
          )}
        </div>
      </div>
    );
  }

  const {
    name,
    avatar,
    chips,
    currentBet,
    holeCards,
    folded,
    isAllIn,
    isBot,
    showCards,
    status,
    botPersonality,
    removeAfterHand,
    sitOutAfterHand,
    lastAction,
  } = player;

  const isSittingOut = status === 'SITTING_OUT' || status === 'BUSTED';
  const isDisconnected = status === 'DISCONNECTED';
  const hasHighlight = Boolean(highlightKeys && highlightKeys.size > 0);

  // SVG 倒计时圆环参数
  const progressRatio =
    isCurrentTurn && turnDurationSec > 0 && turnDeadline
      ? Math.max(0, Math.min(1, remainingSec / turnDurationSec))
      : 0;
  const circumference = 2 * Math.PI * 26;
  const dashOffset = circumference * (1 - progressRatio);

  return (
    <div
      className={`flex flex-col items-center transition-all duration-300 ${className} ${
        folded || isSittingOut ? 'opacity-50 grayscale-[45%]' : ''
      }`}
    >
      <div className="relative flex flex-col items-center">
        {/* 快捷聊天弹幕气泡 */}
        {quickChatText && (
          <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-amber-300 text-black text-[11px] font-black shadow-xl whitespace-nowrap z-40 animate-in zoom-in-95 fade-in">
            {quickChatText}
          </div>
        )}

        {/* 最近动作胶囊 */}
        {lastAction && !quickChatText && (
          <div
            className={`mb-0.5 px-2 py-0.5 rounded-full border text-[9px] sm:text-[10px] font-bold whitespace-nowrap shadow z-20 ${
              TONE_CLASS[lastAction.tone] || TONE_CLASS.check
            }`}
          >
            {lastAction.label}
          </div>
        )}

        {/* 手牌 */}
        {holeCards && holeCards.length > 0 && (
          <div className="flex items-center -space-x-2 mb-1 z-10">
            {holeCards.map((card, idx) => {
              const cardKey = `${card.suit}-${card.rank}`;
              const visible = isLocalPlayer || showCards;
              const isCardHighlighted = Boolean(visible && highlightKeys?.has(cardKey));
              return (
                <div
                  key={idx}
                  className={`transform transition-transform ${
                    idx === 1 ? 'rotate-3' : '-rotate-3'
                  } ${isCardHighlighted ? '-translate-y-1.5 scale-105' : hasHighlight && visible ? 'opacity-65' : ''}`}
                >
                  <CardView
                    card={card}
                    hidden={!visible}
                    highlight={isCardHighlighted}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* 头像圈 */}
        <div className="relative">
          {/* 庄家 / 大小盲标识 */}
          {(isDealer || isSmallBlind || isBigBlind) && (
            <div className="absolute -top-1 -right-2.5 flex flex-col items-center gap-0.5 z-30">
              {isDealer && (
                <span className="w-5 h-5 rounded-full bg-amber-400 text-black font-black text-[10px] flex items-center justify-center shadow-md border border-amber-200">
                  D
                </span>
              )}
              {isSmallBlind && (
                <span className="w-5 h-5 rounded-full bg-blue-500 text-white font-bold text-[9px] flex items-center justify-center shadow-md border border-blue-300">
                  SB
                </span>
              )}
              {isBigBlind && (
                <span className="w-5 h-5 rounded-full bg-purple-600 text-white font-bold text-[9px] flex items-center justify-center shadow-md border border-purple-300">
                  BB
                </span>
              )}
            </div>
          )}

          {/* 房主踢人 / 自由删除 AI 按钮 */}
          {canHostManage && isBot && onRemoveBot && (
            <button
              onClick={() => onRemoveBot(seatIndex)}
              title={removeAfterHand ? '点击取消下局移除' : '移除此 AI 玩家'}
              className={`absolute -top-1.5 -left-2 w-5 h-5 rounded-full flex items-center justify-center shadow z-30 border transition-colors ${
                removeAfterHand
                  ? 'bg-amber-500 text-black border-amber-200'
                  : 'bg-rose-600/90 hover:bg-rose-500 text-white border-rose-300/60'
              }`}
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {canHostManage && !isBot && !isLocalPlayer && onKickPlayer && (
            <button
              onClick={() => onKickPlayer(seatIndex)}
              title="请离该玩家"
              className="absolute -top-1.5 -left-2 w-5 h-5 rounded-full bg-neutral-800/90 hover:bg-rose-600 text-neutral-300 hover:text-white flex items-center justify-center shadow z-30 border border-white/20 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          {/* 倒计时 SVG 环 */}
          {isCurrentTurn && turnDurationSec > 0 && remainingSec > 0 && (
            <svg
              className="absolute -inset-1.5 w-[calc(100%+12px)] h-[calc(100%+12px)] -rotate-90 pointer-events-none z-20"
              viewBox="0 0 60 60"
            >
              <circle
                cx="30"
                cy="30"
                r="26"
                fill="none"
                stroke={remainingSec <= 5 ? '#f43f5e' : '#fbbf24'}
                strokeWidth="3.5"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className="transition-all duration-200"
              />
            </svg>
          )}

          <div
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden p-0.5 transition-all duration-300 shadow-xl ${
              isCurrentTurn
                ? 'ring-4 ring-amber-400 ring-offset-2 ring-offset-black scale-105'
                : isLocalPlayer
                ? 'border-2 border-amber-400/70 bg-neutral-900'
                : 'border-2 border-white/25 bg-neutral-900'
            }`}
          >
            <div className="w-full h-full rounded-full bg-neutral-800 flex items-center justify-center relative overflow-hidden">
              {avatar ? (
                <img src={avatar} alt={name} className="w-full h-full object-cover" />
              ) : isBot ? (
                <Bot className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-400" />
              ) : (
                <User className="w-6 h-6 sm:w-7 sm:h-7 text-amber-200" />
              )}

              {isCurrentTurn && turnDurationSec > 0 && remainingSec > 0 && (
                <div
                  className={`absolute inset-0 bg-black/55 flex items-center justify-center font-mono font-black text-xs ${
                    remainingSec <= 5 ? 'text-rose-400 animate-pulse' : 'text-amber-300'
                  }`}
                >
                  {remainingSec}s
                </div>
              )}
            </div>
          </div>

          {/* 身份/状态底部角标 */}
          {isDisconnected ? (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-amber-700 text-white text-[9px] font-bold rounded-full shadow border border-amber-400/50 whitespace-nowrap z-20 flex items-center gap-0.5">
              <WifiOff className="w-2.5 h-2.5" /> 掉线
            </span>
          ) : removeAfterHand ? (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-amber-600 text-black text-[9px] font-black rounded-full shadow whitespace-nowrap z-20">
              下局移除
            </span>
          ) : sitOutAfterHand ? (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-neutral-700 text-amber-200 text-[9px] font-bold rounded-full shadow whitespace-nowrap z-20">
              下局暂离
            </span>
          ) : status === 'BUSTED' ? (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-rose-900 text-rose-200 text-[9px] font-bold rounded-full shadow border border-rose-400/40 whitespace-nowrap z-20">
              出局
            </span>
          ) : status === 'SITTING_OUT' ? (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-neutral-700 text-neutral-200 text-[9px] font-bold rounded-full shadow whitespace-nowrap z-20">
              暂离
            </span>
          ) : isAllIn ? (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gradient-to-r from-red-600 to-rose-700 text-white text-[9px] font-black rounded-full shadow border border-red-400/50 uppercase tracking-tight whitespace-nowrap z-20">
              ALL-IN
            </span>
          ) : folded ? (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-neutral-700 text-neutral-200 text-[9px] font-bold rounded-full shadow border border-white/10 whitespace-nowrap z-20">
              弃牌
            </span>
          ) : null}
        </div>

        {/* 玩家信息框 */}
        <div
          className={`mt-1 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg border flex flex-col items-center min-w-[70px] sm:min-w-[84px] shadow-md ${
            isLocalPlayer ? 'border-amber-400/45' : 'border-white/10'
          }`}
        >
          <div className="flex items-center gap-1 max-w-[90px]">
            {isRoomHost && <Crown className="w-2.5 h-2.5 text-amber-400 shrink-0" />}
            <span className="text-[10px] sm:text-xs font-semibold text-neutral-200 truncate">
              {name}
            </span>
            {isBot && botPersonality && (
              <span className="text-[8px] px-1 rounded bg-emerald-500/20 text-emerald-300 shrink-0">
                {PERSONALITY_BADGE[botPersonality]}
              </span>
            )}
          </div>
          <span className="text-[10px] sm:text-xs font-mono font-bold text-amber-400">
            ${chips.toLocaleString()}
          </span>
        </div>

        {/* 本轮下注额 */}
        {currentBet > 0 && (
          <div className="mt-0.5 flex items-center gap-0.5 bg-amber-500/20 backdrop-blur-md border border-amber-400/40 px-2 py-0.5 rounded-full z-20 whitespace-nowrap">
            <span className="text-[10px] text-amber-300 font-mono font-bold">🪙 ${currentBet}</span>
          </div>
        )}
      </div>
    </div>
  );
};
