import React, { useState, useEffect } from 'react';
import { GameAction, GameState, Player } from '../types/poker';
import { soundManager } from '../audio/sounds';
import { ArrowUpCircle, Check, X, Flame } from 'lucide-react';

interface ActionControlsProps {
  gameState: GameState;
  localPlayer: Player;
  onAction: (action: GameAction) => void;
}

export const ActionControls: React.FC<ActionControlsProps> = ({
  gameState,
  localPlayer,
  onAction,
}) => {
  const { currentBet, minRaise, totalPot, stage, handNumber, activePlayerIndex } = gameState;
  const isMyTurn = activePlayerIndex === localPlayer.seatIndex;

  const callAmount = Math.max(0, currentBet - localPlayer.currentBet);
  const canCheck = callAmount === 0;
  const minBetOrRaise = currentBet === 0 ? minRaise : currentBet + minRaise;
  const maxBet = localPlayer.chips + localPlayer.currentBet;
  const effectiveMin = Math.min(maxBet, minBetOrRaise);

  const [raiseAmount, setRaiseAmount] = useState<number>(effectiveMin);

  // 每次换街、新一手牌、或轮到自己行动时，重置加注额为最小合法加注额
  useEffect(() => {
    setRaiseAmount(effectiveMin);
  }, [stage, handNumber, activePlayerIndex, effectiveMin]);

  // 等待开局或摊牌结算阶段不显示底部操作提示条
  if (stage === 'WAITING' || stage === 'SHOWDOWN') {
    return null;
  }

  if (!isMyTurn || localPlayer.folded || localPlayer.isAllIn) {
    return (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md px-5 py-2 rounded-full border border-white/10 text-white/60 text-xs sm:text-sm font-medium whitespace-nowrap z-30">
        {localPlayer.folded
          ? '已弃牌，等待本轮对决结束'
          : localPlayer.isAllIn
          ? '已全下 (ALL-IN)，静候决胜'
          : '等待其他玩家行动...'}
      </div>
    );
  }

  const canRaise = localPlayer.chips > callAmount && maxBet > currentBet;
  const rawHalfPot = Math.floor(totalPot * 0.5);
  const rawFullPot = totalPot;
  const canHalfPot = rawHalfPot >= effectiveMin && rawHalfPot <= maxBet;
  const canFullPot = rawFullPot >= effectiveMin && rawFullPot <= maxBet;

  const handleFold = () => {
    soundManager.playCardDeal();
    onAction({ type: 'FOLD', playerId: localPlayer.id });
  };

  const handleCheckOrCall = () => {
    if (canCheck) {
      soundManager.playCheckKnock();
      onAction({ type: 'CHECK', playerId: localPlayer.id });
    } else {
      soundManager.playChipClink();
      if (callAmount >= localPlayer.chips) {
        soundManager.playAllIn();
        onAction({ type: 'ALL_IN', playerId: localPlayer.id });
      } else {
        onAction({ type: 'CALL', playerId: localPlayer.id });
      }
    }
  };

  const handleRaise = () => {
    soundManager.playChipClink();
    if (raiseAmount >= maxBet) {
      soundManager.playAllIn();
      onAction({ type: 'ALL_IN', playerId: localPlayer.id });
    } else {
      onAction({
        type: currentBet === 0 ? 'BET' : 'RAISE',
        amount: raiseAmount,
        playerId: localPlayer.id,
      });
    }
  };

  const handleAllIn = () => {
    soundManager.playAllIn();
    onAction({ type: 'ALL_IN', playerId: localPlayer.id });
  };

  return (
    <div className="fixed bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 w-full max-w-xl px-2.5 sm:px-3 z-40 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-neutral-900/95 backdrop-blur-xl border border-amber-500/35 rounded-2xl p-2 sm:p-3 shadow-2xl flex flex-col gap-2">
        {/* 加注滑动条与快捷倍率 */}
        {canRaise && (
          <div className="flex flex-col gap-1.5 px-1">
            <div className="flex items-center justify-between text-xs text-amber-200/80 font-mono">
              <span>{currentBet === 0 ? '下注至:' : '加注至:'}</span>
              <span className="font-bold text-amber-400 text-sm">
                ${raiseAmount.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="range"
                min={effectiveMin}
                max={maxBet}
                step={1}
                value={raiseAmount}
                onChange={e => setRaiseAmount(Number(e.target.value))}
                className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
              />
            </div>

            <div className="grid grid-cols-4 gap-1.5 text-[11px] font-semibold text-neutral-300">
              <button
                onClick={() => setRaiseAmount(effectiveMin)}
                className="py-1 bg-white/5 hover:bg-white/15 rounded border border-white/10 truncate px-1"
              >
                Min (${effectiveMin})
              </button>
              <button
                onClick={() => canHalfPot && setRaiseAmount(rawHalfPot)}
                disabled={!canHalfPot}
                className="py-1 bg-white/5 hover:bg-white/15 disabled:opacity-35 disabled:cursor-not-allowed rounded border border-white/10 truncate px-1"
              >
                1/2 池 {canHalfPot ? `($${rawHalfPot})` : ''}
              </button>
              <button
                onClick={() => canFullPot && setRaiseAmount(rawFullPot)}
                disabled={!canFullPot}
                className="py-1 bg-white/5 hover:bg-white/15 disabled:opacity-35 disabled:cursor-not-allowed rounded border border-white/10 truncate px-1"
              >
                底池 {canFullPot ? `($${rawFullPot})` : ''}
              </button>
              <button
                onClick={() => setRaiseAmount(maxBet)}
                className="py-1 bg-red-950/40 text-red-300 hover:bg-red-900/50 rounded border border-red-500/20 font-bold truncate px-1"
              >
                全下 (${maxBet})
              </button>
            </div>
          </div>
        )}

        {/* 主操作按钮网格 */}
        <div className={`grid gap-1.5 sm:gap-2 font-bold text-xs sm:text-sm ${canRaise ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {/* 弃牌 */}
          <button
            onClick={handleFold}
            className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-b from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white rounded-xl shadow-lg active:scale-95 transition-all border border-red-400/30"
          >
            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> 弃牌
          </button>

          {/* 看牌 / 跟注 */}
          <button
            onClick={handleCheckOrCall}
            className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-b from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white rounded-xl shadow-lg active:scale-95 transition-all border border-blue-400/30 whitespace-nowrap px-1"
          >
            <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>{canCheck ? '看牌' : `跟注 $${Math.min(callAmount, localPlayer.chips)}`}</span>
          </button>

          {/* 加注 */}
          {canRaise && (
            <button
              onClick={handleRaise}
              className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-b from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black font-extrabold rounded-xl shadow-lg active:scale-95 transition-all border border-yellow-300/40 whitespace-nowrap px-1"
            >
              <ArrowUpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>{currentBet === 0 ? '下注' : '加注'}</span>
            </button>
          )}

          {/* 全下快捷按钮 */}
          <button
            onClick={handleAllIn}
            className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-black rounded-xl shadow-lg active:scale-95 transition-all border border-purple-400/30 whitespace-nowrap px-1"
          >
            <Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300 shrink-0" /> ALL-IN
          </button>
        </div>
      </div>
    </div>
  );
};
