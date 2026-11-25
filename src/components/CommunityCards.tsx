import React from 'react';
import { Card } from '../types/poker';
import { CardView } from './CardView';

interface CommunityCardsProps {
  cards: Card[];
  stage: string;
  highlightKeys?: Set<string>;
  rabbitCards?: Card[];
}

export const CommunityCards: React.FC<CommunityCardsProps> = ({
  cards,
  stage,
  highlightKeys,
  rabbitCards,
}) => {
  const hasHighlight = Boolean(highlightKeys && highlightKeys.size > 0);
  const combinedRabbitStart = cards.length;

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 my-1.5">
      <div className="text-[10px] sm:text-[11px] font-semibold tracking-widest uppercase text-emerald-300/80 bg-black/45 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
        {stage === 'WAITING' ? '等待玩家开局' : stage}
      </div>

      <div className="flex items-center justify-center gap-1 sm:gap-2 p-1.5 sm:p-2 bg-black/35 backdrop-blur-sm rounded-xl border border-white/10 shadow-inner">
        {[0, 1, 2, 3, 4].map(idx => {
          const card = cards[idx];
          if (card) {
            const key = `${card.suit}-${card.rank}`;
            const isHighlighted = highlightKeys?.has(key) || false;
            const dim = hasHighlight && !isHighlighted;
            return (
              <div
                key={idx}
                className={`animate-in fade-in zoom-in-95 duration-300 transition-transform ${
                  isHighlighted ? '-translate-y-1' : dim ? 'opacity-55 scale-95' : ''
                }`}
              >
                <CardView card={card} size="md" highlight={isHighlighted} />
              </div>
            );
          }

          const rabbitCard = rabbitCards?.[idx - combinedRabbitStart];
          if (rabbitCard) {
            return (
              <div key={idx} className="relative animate-in fade-in duration-300 opacity-85">
                <CardView card={rabbitCard} size="md" className="ring-1 ring-cyan-400/60" />
                <span className="absolute -top-1.5 -right-1 text-[9px] bg-cyan-900 text-cyan-200 px-1 rounded border border-cyan-400/50">
                  🐇
                </span>
              </div>
            );
          }

          return (
            <div
              key={idx}
              className="w-11 h-[66px] sm:w-14 sm:h-20 rounded-md border border-dashed border-white/15 bg-black/25 flex items-center justify-center"
            >
              <span className="text-[9px] sm:text-[10px] text-white/25 font-mono">
                {idx < 3 ? 'FLOP' : idx === 3 ? 'TURN' : 'RIVER'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
