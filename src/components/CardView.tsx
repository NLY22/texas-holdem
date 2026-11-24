import React from 'react';
import { Card } from '../types/poker';
import { rankToLabel, suitToSymbol } from '../engine/deck';

interface CardViewProps {
  card?: Card;
  hidden?: boolean;
  highlight?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const CardView: React.FC<CardViewProps> = ({
  card,
  hidden = false,
  highlight = false,
  className = '',
  size = 'md',
}) => {
  const sizeClasses = {
    sm: 'w-8 h-12 text-xs rounded',
    md: 'w-12 h-16 sm:w-14 sm:h-20 text-sm sm:text-base rounded-md',
    lg: 'w-16 h-24 sm:w-20 sm:h-28 text-base sm:text-xl rounded-lg',
  }[size];

  if (hidden || !card) {
    return (
      <div
        className={`${sizeClasses} bg-gradient-to-br from-indigo-900 to-slate-950 border-2 border-indigo-500/60 shadow-lg flex items-center justify-center relative overflow-hidden transition-all duration-300 transform hover:scale-105 ${className}`}
      >
        <div className="absolute inset-1 border border-indigo-400/20 rounded-sm flex items-center justify-center">
          <div className="w-4 h-4 sm:w-6 sm:h-6 rounded-full border border-amber-400/40 flex items-center justify-center">
            <span className="text-[10px] text-amber-400/80 font-bold">♠</span>
          </div>
        </div>
      </div>
    );
  }

  const { symbol, isRed } = suitToSymbol(card.suit);
  const label = rankToLabel(card.rank);

  return (
    <div
      className={`${sizeClasses} bg-gradient-to-b from-white to-gray-100 border border-neutral-300 shadow-md flex flex-col justify-between p-1 select-none font-bold relative transition-all duration-300 transform hover:-translate-y-1 ${
        highlight ? 'ring-2 ring-amber-400 shadow-glow scale-105' : ''
      } ${className}`}
      style={{ color: isRed ? '#dc2626' : '#1e293b' }}
    >
      <div className="flex flex-col items-start leading-none">
        <span className="text-xs sm:text-sm font-black tracking-tighter">{label}</span>
        <span className="text-[10px] sm:text-xs leading-none">{symbol}</span>
      </div>

      <div className="self-center text-sm sm:text-2xl leading-none opacity-90">
        {symbol}
      </div>

      <div className="flex flex-col items-end leading-none rotate-180">
        <span className="text-xs sm:text-sm font-black tracking-tighter">{label}</span>
        <span className="text-[10px] sm:text-xs leading-none">{symbol}</span>
      </div>
    </div>
  );
};
