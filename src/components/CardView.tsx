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
    sm: 'w-9 h-[52px] text-[10px] rounded',
    md: 'w-11 h-[66px] sm:w-14 sm:h-20 text-xs sm:text-sm rounded-md',
    lg: 'w-14 h-20 sm:w-20 sm:h-28 text-sm sm:text-xl rounded-lg',
  }[size];

  if (hidden || !card || card.rank === 0) {
    return (
      <div
        className={`${sizeClasses} bg-gradient-to-br from-indigo-900 to-slate-950 border-2 border-indigo-400/60 shadow-lg flex items-center justify-center relative overflow-hidden transition-all duration-300 ${className}`}
      >
        <div className="absolute inset-1 border border-indigo-400/25 rounded-sm flex items-center justify-center">
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
      className={`${sizeClasses} bg-gradient-to-b from-white to-gray-100 border border-neutral-300 shadow-md flex flex-col justify-between overflow-hidden select-none font-bold relative transition-all duration-300 ${
        size === 'sm' ? 'p-0.5 px-1' : 'p-1'
      } ${highlight ? 'ring-2 ring-amber-400 shadow-glow scale-105' : ''} ${className}`}
      style={{ color: isRed ? '#dc2626' : '#1e293b' }}
    >
      <div className="flex flex-col items-start leading-none shrink-0">
        <span className={size === 'sm' ? 'text-[10px] font-black leading-none' : 'text-[11px] sm:text-sm font-black leading-none tracking-tighter'}>
          {label}
        </span>
        <span className={size === 'sm' ? 'text-[9px] leading-none' : 'text-[10px] sm:text-xs leading-none'}>
          {symbol}
        </span>
      </div>

      <div className={`self-center leading-none opacity-90 shrink-0 ${size === 'sm' ? 'text-sm' : 'text-lg sm:text-2xl'}`}>
        {symbol}
      </div>

      {size !== 'sm' ? (
        <div className="flex flex-col items-end leading-none rotate-180 shrink-0">
          <span className="text-[11px] sm:text-sm font-black leading-none tracking-tighter">{label}</span>
          <span className="text-[10px] sm:text-xs leading-none">{symbol}</span>
        </div>
      ) : (
        <div className="h-0.5 shrink-0" />
      )}
    </div>
  );
};
