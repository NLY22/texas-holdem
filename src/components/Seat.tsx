import React from 'react';
import { Player } from '../types/poker';
import { CardView } from './CardView';
import { Bot, Crown, User, Plus } from 'lucide-react';

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
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-dashed border-white/20 bg-black/30 backdrop-blur-sm flex flex-col items-center justify-center gap-1 text-white/50 hover:text-white hover:border-amber-400 hover:bg-black/50 transition-all p-1">
          {onSitDown && (
            <button
              onClick={() => onSitDown(seatIndex)}
              className="text-[10px] sm:text-xs font-bold text-amber-300 hover:underline flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> 入座
            </button>
          )}
          {onAddBot && (
            <button
              onClick={() => onAddBot(seatIndex)}
              className="text-[9px] text-emerald-300 hover:underline flex items-center gap-0.5"
            >
              <Bot className="w-2.5 h-2.5" /> 电脑
            </button>
          )}
        </div>
      </div>
    );
  }

  const { name, avatar, chips, currentBet, holeCards, folded, isAllIn, isBot, showCards } = player;

  return (
    <div className={`flex flex-col items-center relative transition-all duration-300 ${className} ${folded ? 'opacity-40 grayscale' : ''}`}>
      {/* 盲注 / 庄家 标识币 */}
      <div className="absolute -top-3 flex items-center gap-1 z-20">
        {isDealer && (
          <span className="w-5 h-5 rounded-full bg-amber-400 text-black font-black text-[10px] flex items-center justify-center shadow-md border border-amber-300">
            D
          </span>
        )}
        {isSmallBlind && (
          <span className="w-5 h-5 rounded-full bg-blue-500 text-white font-bold text-[9px] flex items-center justify-center shadow-md border border-blue-400">
            SB
          </span>
        )}
        {isBigBlind && (
          <span className="w-5 h-5 rounded-full bg-purple-600 text-white font-bold text-[9px] flex items-center justify-center shadow-md border border-purple-400">
            BB
          </span>
        )}
      </div>

      {/* 手牌展示 */}
      {holeCards && holeCards.length > 0 && (
        <div className="flex items-center -space-x-4 mb-1 z-10">
          {holeCards.map((card, idx) => (
            <div
              key={idx}
              className={`transform transition-transform ${idx === 1 ? 'rotate-6 translate-x-1' : '-rotate-6'}`}
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

      {/* 头像与行动圈 */}
      <div className="relative">
        <div
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden p-0.5 transition-all duration-300 shadow-xl ${
            isCurrentTurn
              ? 'ring-4 ring-amber-400 ring-offset-2 ring-offset-black scale-105 animate-pulse'
              : 'border-2 border-white/20 bg-neutral-900'
          }`}
        >
          <div className="w-full h-full rounded-full bg-neutral-800 flex items-center justify-center relative overflow-hidden">
            {avatar ? (
              <img src={avatar} alt={name} className="w-full h-full object-cover" />
            ) : isBot ? (
              <Bot className="w-8 h-8 text-emerald-400" />
            ) : (
              <User className="w-8 h-8 text-neutral-300" />
            )}
          </div>
        </div>

        {/* 状态徽章 */}
        {isAllIn && (
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.2 bg-gradient-to-r from-red-600 to-rose-700 text-white text-[9px] font-black rounded-full shadow border border-red-400/50 uppercase tracking-tight z-20">
            ALL-IN
          </span>
        )}
        {folded && (
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.2 bg-neutral-700 text-neutral-300 text-[9px] font-bold rounded-full shadow uppercase z-20">
            弃牌
          </span>
        )}
      </div>

      {/* 玩家信息框 */}
      <div className="mt-1 bg-black/75 backdrop-blur-md px-2.5 py-0.5 rounded-lg border border-white/10 flex flex-col items-center min-w-[72px] sm:min-w-[84px] shadow-md">
        <span className="text-[11px] sm:text-xs font-semibold text-neutral-200 truncate max-w-[80px]">
          {name}
        </span>
        <span className="text-[11px] sm:text-xs font-mono font-bold text-amber-400">
          ${chips.toLocaleString()}
        </span>
      </div>

      {/* 本轮下注额提示 */}
      {currentBet > 0 && (
        <div className="absolute -bottom-6 flex items-center gap-1 bg-amber-500/20 backdrop-blur-md border border-amber-400/30 px-2 py-0.5 rounded-full z-20">
          <span className="text-[10px] text-amber-300 font-mono font-bold">🪙 ${currentBet}</span>
        </div>
      )}
    </div>
  );
};
