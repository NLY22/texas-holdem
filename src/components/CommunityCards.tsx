import React from 'react';
import { Card } from '../types/poker';
import { CardView } from './CardView';

interface CommunityCardsProps {
  cards: Card[];
  stage: string;
}

export const CommunityCards: React.FC<CommunityCardsProps> = ({ cards, stage }) => {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 my-2">
      <div className="text-[11px] font-semibold tracking-widest uppercase text-emerald-300/70 bg-black/40 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
        {stage === 'WAITING' ? '等待玩家开局' : stage}
      </div>

      <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 p-2 bg-black/30 backdrop-blur-sm rounded-xl border border-white/5 shadow-inner">
        {[0, 1, 2, 3, 4].map(idx => {
          const card = cards[idx];
          if (card) {
            return (
              <div key={idx} className="animate-in fade-in zoom-in-95 duration-300">
                <CardView card={card} size="md" />
              </div>
            );
          }
          return (
            <div
              key={idx}
              className="w-12 h-16 sm:w-14 sm:h-20 rounded-md border border-dashed border-emerald-500/20 bg-emerald-950/20 flex items-center justify-center"
            >
              <span className="text-[10px] text-emerald-500/30 font-mono">
                {idx < 3 ? 'FLOP' : idx === 3 ? 'TURN' : 'RIVER'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
