import React from 'react';
import { Pot } from '../types/poker';
import { Coins } from 'lucide-react';

interface PotDisplayProps {
  totalPot: number;
  pots: Pot[];
}

export const PotDisplay: React.FC<PotDisplayProps> = ({ totalPot, pots }) => {
  if (totalPot <= 0) return null;

  return (
    <div className="flex flex-col items-center justify-center my-1">
      <div className="flex items-center gap-2 bg-gradient-to-r from-amber-950/80 via-black/80 to-amber-950/80 px-4 py-1.5 rounded-full border border-amber-500/40 shadow-lg backdrop-blur-md">
        <Coins className="w-4 h-4 text-amber-400 animate-pulse" />
        <span className="text-xs uppercase tracking-wider text-amber-200/80 font-bold">底池:</span>
        <span className="text-base sm:text-lg font-black text-amber-400 tracking-tight font-mono">
          ${totalPot.toLocaleString()}
        </span>
      </div>

      {pots.length > 1 && (
        <div className="flex items-center gap-2 mt-1">
          {pots.map((pot, idx) => (
            <span
              key={idx}
              className="text-[10px] text-amber-200/60 bg-black/40 px-2 py-0.5 rounded border border-amber-500/10 font-mono"
            >
              {idx === 0 ? '主池' : `边池${idx}`}: ${pot.amount}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
