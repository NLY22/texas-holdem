import React from 'react';
import { X, History } from 'lucide-react';
import { HandLogEntry } from '../types/poker';
import { rankToLabel, suitToSymbol } from '../engine/deck';

interface HandHistoryDrawerProps {
  history: HandLogEntry[];
  onClose: () => void;
}

export const HandHistoryDrawer: React.FC<HandHistoryDrawerProps> = ({ history, onClose }) => {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/75 backdrop-blur-sm animate-in fade-in"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm h-full bg-neutral-950 border-l border-white/15 p-4 flex flex-col gap-3 shadow-2xl overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <h3 className="text-sm font-black text-amber-300 flex items-center gap-2">
            <History className="w-4 h-4" /> 最近牌局动作记录
          </h3>
          <button
            onClick={onClose}
            aria-label="关闭牌局历史"
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {history.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-neutral-500">
            完成第一手牌后将在此记录动作流水
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map(item => (
              <div
                key={item.handNumber}
                className="p-3 rounded-xl bg-neutral-900 border border-white/10 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-bold text-amber-400">
                    第 {item.handNumber} 手
                  </span>
                  <span className="text-[11px] font-mono text-neutral-400">
                    奖池 ${item.totalPot}
                  </span>
                </div>

                {item.communityCards.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-neutral-500 mr-1">公共牌:</span>
                    {item.communityCards.map((c, idx) => {
                      const { symbol, isRed } = suitToSymbol(c.suit);
                      return (
                        <span
                          key={idx}
                          className={`px-1.5 py-0.5 rounded bg-white text-[11px] font-bold leading-none ${
                            isRed ? 'text-red-600' : 'text-slate-900'
                          }`}
                        >
                          {rankToLabel(c.rank)}
                          {symbol}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="text-[11px] text-emerald-300 font-semibold">
                  {item.winners.map(w => `${w.name} +$${w.amount} (${w.handName})`).join('；')}
                </div>

                {item.actions.length > 0 && (
                  <div className="text-[10px] text-neutral-400 bg-black/40 p-2 rounded-lg leading-relaxed">
                    {item.actions.join(' → ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
