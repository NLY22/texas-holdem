import React from 'react';
import { Player } from '../types/poker';
import { CardView } from './CardView';
import { Bot, User, Plus } from 'lucide-react';

interface SeatProps {
  player: Player | null;
  seatIndex: number;
  isCurrentTurn: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isLocalPlayer: boolean;
  onSitDown?: (seatIndex: number) => void;
  onAddBot?: (seatIndex: number) => void;
  className?: string;
}

export const Seat: React.FC<SeatProps> = ({
  player,
  seatIndex,
  isCurrentTurn,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isLocalPlayer,
  onSitDown,
  onAddBot,
  className = '',
}) => {
  // 空座位
  if (!player) {
    return (
      <div className={`flex flex-col items-center justify-center ${className}`}>
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-dashed border-white/20 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center gap-0.5 text-white/50 hover:text-white hover:border-amber-400 hover:bg-black/60 transition-all p-1">
          {onSitDown && (
            <button
              onClick={() => onSitDown(seatIndex)}
              className="text-[10px] font-bold text-amber-300 hover:underline flex items-center gap-0.5 whitespace-nowrap"
            >
              <Plus className="w-2.5 h-2.5" /> 换座
            </button>
          )}
          {onAddBot && (
            <button
              onClick={() => onAddBot(seatIndex)}
              className="text-[10px] text-emerald-300 hover:underline flex items-center gap-0.5 whitespace-nowrap"
            >
              <Bot className="w-2.5 h-2.5" /> +电脑
            </button>
          )}
          {!onSitDown && !onAddBot && (
            <span className="text-[9px] text-white/25">空位</span>
          )}
        </div>
      </div>
    );
  }

  const { name, avatar, chips, currentBet, holeCards, folded, isAllIn, isBot, showCards } = player;

  return (
    <div className={`flex flex-col items-center transition-all duration-300 ${className} ${folded ? 'opacity-45 grayscale' : ''}`}>
      <div className="relative flex flex-col items-center">
        {/* 手牌展示（位于头像正上方，不遮挡头像与标识） */}
        {holeCards && holeCards.length > 0 && (
          <div className="flex items-center -space-x-2 mb-1 z-10">
            {holeCards.map((card, idx) => (
              <div
                key={idx}
                className={`transform transition-transform ${idx === 1 ? 'rotate-3' : '-rotate-3'}`}
              >
                <CardView
                  card={card}
                  hidden={!isLocalPlayer && !showCards}
                  size="sm"
                />
              </div>
            ))}
          </div>
        )}

        {/* 头像与行动圈 + 右侧位置币 */}
        <div className="relative">
          {/* 庄家 / 大小盲标识币（固定在头像右上角，不与底牌重合） */}
          {(isDealer || isSmallBlind || isBigBlind) && (
            <div className="absolute -top-1 -right-2 flex flex-col items-center gap-0.5 z-30">
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

          <div
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden p-0.5 transition-all duration-300 shadow-xl ${
              isCurrentTurn
                ? 'ring-4 ring-amber-400 ring-offset-2 ring-offset-black scale-105 animate-pulse'
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
            </div>
          </div>

          {/* 状态徽章 (添加 whitespace-nowrap 防止折行) */}
          {isAllIn && (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gradient-to-r from-red-600 to-rose-700 text-white text-[9px] font-black rounded-full shadow border border-red-400/50 uppercase tracking-tight whitespace-nowrap z-20">
              ALL-IN
            </span>
          )}
          {folded && (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-neutral-700 text-neutral-200 text-[9px] font-bold rounded-full shadow border border-white/10 whitespace-nowrap z-20">
              弃牌
            </span>
          )}
        </div>

        {/* 玩家信息框 */}
        <div className={`mt-1 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg border flex flex-col items-center min-w-[68px] sm:min-w-[82px] shadow-md ${
          isLocalPlayer ? 'border-amber-400/40' : 'border-white/10'
        }`}>
          <span className="text-[10px] sm:text-xs font-semibold text-neutral-200 truncate max-w-[78px]">
            {name}
          </span>
          <span className="text-[10px] sm:text-xs font-mono font-bold text-amber-400">
            ${chips.toLocaleString()}
          </span>
        </div>

        {/* 本轮下注额提示 */}
        {currentBet > 0 && (
          <div className="mt-0.5 flex items-center gap-0.5 bg-amber-500/20 backdrop-blur-md border border-amber-400/40 px-2 py-0.5 rounded-full z-20 whitespace-nowrap">
            <span className="text-[10px] text-amber-300 font-mono font-bold">🪙 ${currentBet}</span>
          </div>
        )}
      </div>
    </div>
  );
};
