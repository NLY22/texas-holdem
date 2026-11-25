import React, { useState, useEffect, useRef } from 'react';
import { GameAction, GameState, Player } from '../types/poker';
import { soundManager } from '../audio/sounds';
import { ArrowUpCircle, Check, X, Flame, Minus, Plus } from 'lucide-react';

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
  const { currentBet, minRaise, totalPot, stage, handNumber, activePlayerIndex, bigBlind, cannotRaiseIds } =
    gameState;
  const isMyTurn = activePlayerIndex === localPlayer.seatIndex;
  const prevTurnRef = useRef(false);

  const callAmount = Math.max(0, currentBet - localPlayer.currentBet);
  const canCheck = callAmount === 0;
  const minBetOrRaise = currentBet === 0 ? minRaise : currentBet + minRaise;
  const maxBet = localPlayer.chips + localPlayer.currentBet;
  const effectiveMin = Math.min(maxBet, minBetOrRaise);
  const raiseLockedByShortAllIn = (cannotRaiseIds || []).includes(localPlayer.id);
  const canRaise = !raiseLockedByShortAllIn && localPlayer.chips > callAmount && maxBet > currentBet;

  const [raiseAmount, setRaiseAmount] = useState<number>(effectiveMin);
  // 预选行动状态
  const [preAction, setPreAction] = useState<{ type: 'CHECK_FOLD' | 'CALL_ANY'; lockedBet?: number } | null>(null);

  useEffect(() => {
    setRaiseAmount(effectiveMin);
  }, [stage, handNumber, activePlayerIndex, effectiveMin]);

  // 换手或退回等待时清空预选
  useEffect(() => {
    setPreAction(null);
  }, [handNumber, stage]);

  // 若预选了「自动跟注 $X」，但别人加注超过了 X，自动取消以防误跟
  useEffect(() => {
    if (preAction?.type === 'CALL_ANY' && currentBet > (preAction.lockedBet ?? 0)) {
      setPreAction(null);
    }
  }, [currentBet, preAction]);

  // 轮到自己行动时：提示音 + 手机震动 + 自动执行预选
  useEffect(() => {
    const justBecameMyTurn = isMyTurn && !prevTurnRef.current;
    prevTurnRef.current = isMyTurn;

    if (!isMyTurn || stage === 'WAITING' || stage === 'SHOWDOWN') return;
    if (localPlayer.folded || localPlayer.isAllIn) return;

    if (preAction) {
      const chosen = preAction;
      setPreAction(null);
      if (chosen.type === 'CHECK_FOLD') {
        onAction({ type: canCheck ? 'CHECK' : 'FOLD', playerId: localPlayer.id });
        return;
      }
      if (chosen.type === 'CALL_ANY') {
        if (canCheck) {
          onAction({ type: 'CHECK', playerId: localPlayer.id });
        } else if (callAmount >= localPlayer.chips) {
          onAction({ type: 'ALL_IN', playerId: localPlayer.id });
        } else {
          onAction({ type: 'CALL', playerId: localPlayer.id });
        }
        return;
      }
    }

    if (justBecameMyTurn) {
      soundManager.playCheckKnock();
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(35);
        }
      } catch {}
    }
  }, [isMyTurn, stage, localPlayer.folded, localPlayer.isAllIn, canCheck, callAmount]);

  if (stage === 'WAITING' || stage === 'SHOWDOWN') {
    return null;
  }

  const status = localPlayer.status || 'ACTIVE';
  if (status === 'SITTING_OUT' || status === 'BUSTED') {
    return (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 bg-black/75 backdrop-blur-md px-5 py-2 rounded-full border border-white/10 text-amber-200/80 text-xs font-medium whitespace-nowrap z-30">
        {status === 'BUSTED' ? '筹码已用完，本手结束后可补充筹码' : '当前处于暂离观战状态，可在设置中回到牌局'}
      </div>
    );
  }

  if (!isMyTurn || localPlayer.folded || localPlayer.isAllIn) {
    const canPreSelect = !localPlayer.folded && !localPlayer.isAllIn;
    return (
      <div className="fixed bottom-2.5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 z-30">
        {canPreSelect && (
          <div className="flex items-center gap-2 bg-neutral-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/15 shadow-lg text-[11px]">
            <button
              onClick={() =>
                setPreAction(prev => (prev?.type === 'CHECK_FOLD' ? null : { type: 'CHECK_FOLD' }))
              }
              className={`px-2.5 py-0.5 rounded-full border font-semibold transition-all ${
                preAction?.type === 'CHECK_FOLD'
                  ? 'bg-rose-500/25 border-rose-400 text-rose-200'
                  : 'bg-white/5 border-white/10 text-neutral-300'
              }`}
            >
              {canCheck ? '自动看牌' : '自动看/弃'}
            </button>
            <button
              onClick={() =>
                setPreAction(prev =>
                  prev?.type === 'CALL_ANY' ? null : { type: 'CALL_ANY', lockedBet: currentBet }
                )
              }
              className={`px-2.5 py-0.5 rounded-full border font-semibold transition-all ${
                preAction?.type === 'CALL_ANY'
                  ? 'bg-blue-500/25 border-blue-400 text-blue-200'
                  : 'bg-white/5 border-white/10 text-neutral-300'
              }`}
            >
              {canCheck ? '跟/看任何' : `自动跟注 ($${Math.min(callAmount, localPlayer.chips)})`}
            </button>
          </div>
        )}
        <div className="bg-black/70 backdrop-blur-md px-5 py-1.5 rounded-full border border-white/10 text-white/60 text-xs sm:text-sm font-medium whitespace-nowrap">
          {localPlayer.folded
            ? '已弃牌，等待本轮对决结束'
            : localPlayer.isAllIn
            ? '已全下 (ALL-IN)，静候决胜'
            : '等待其他玩家行动...'}
        </div>
      </div>
    );
  }

  const stepBB = Math.max(1, bigBlind || 20);
  const clampRaise = (val: number) => Math.max(effectiveMin, Math.min(maxBet, Math.floor(val)));

  const quickButtons =
    stage === 'PREFLOP'
      ? [
          { label: `2x ($${clampRaise(stepBB * 2)})`, val: clampRaise(stepBB * 2), ok: stepBB * 2 >= effectiveMin && stepBB * 2 <= maxBet },
          { label: `3x ($${clampRaise(stepBB * 3)})`, val: clampRaise(stepBB * 3), ok: stepBB * 3 >= effectiveMin && stepBB * 3 <= maxBet },
          { label: '底池', val: clampRaise(totalPot), ok: totalPot >= effectiveMin && totalPot <= maxBet },
          { label: `全下 ($${maxBet})`, val: maxBet, ok: true, isAllIn: true },
        ]
      : [
          { label: `Min ($${effectiveMin})`, val: effectiveMin, ok: true },
          { label: '1/2 池', val: clampRaise(totalPot * 0.5), ok: Math.floor(totalPot * 0.5) >= effectiveMin && Math.floor(totalPot * 0.5) <= maxBet },
          { label: '2/3 池', val: clampRaise((totalPot * 2) / 3), ok: Math.floor((totalPot * 2) / 3) >= effectiveMin && Math.floor((totalPot * 2) / 3) <= maxBet },
          { label: '底池', val: clampRaise(totalPot), ok: totalPot >= effectiveMin && totalPot <= maxBet },
          { label: '全下', val: maxBet, ok: true, isAllIn: true },
        ];

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
        {raiseLockedByShortAllIn && (
          <div className="text-[11px] text-amber-300/90 text-center bg-amber-950/40 rounded-lg py-1 border border-amber-500/20">
            面对短筹码全下不足一个最小加注，本轮仅可跟注或弃牌
          </div>
        )}

        {canRaise && (
          <div className="flex flex-col gap-1.5 px-1">
            <div className="flex items-center justify-between text-xs text-amber-200/80 font-mono">
              <span>{currentBet === 0 ? '下注至:' : '加注至:'}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setRaiseAmount(v => clampRaise(v - stepBB))}
                  className="p-1 rounded bg-white/10 hover:bg-white/20 text-neutral-200"
                  title={`-${stepBB}`}
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="font-bold text-amber-400 text-sm min-w-[60px] text-center">
                  ${raiseAmount.toLocaleString()}
                </span>
                <button
                  onClick={() => setRaiseAmount(v => clampRaise(v + stepBB))}
                  className="p-1 rounded bg-white/10 hover:bg-white/20 text-neutral-200"
                  title={`+${stepBB}`}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            <input
              type="range"
              min={effectiveMin}
              max={maxBet}
              step={1}
              value={raiseAmount}
              onChange={e => setRaiseAmount(Number(e.target.value))}
              className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />

            <div className={`grid gap-1 text-[10px] sm:text-[11px] font-semibold text-neutral-300 ${quickButtons.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
              {quickButtons.map(b => (
                <button
                  key={b.label}
                  onClick={() => b.ok && setRaiseAmount(b.val)}
                  disabled={!b.ok}
                  className={`py-1 rounded border truncate px-1 disabled:opacity-35 disabled:cursor-not-allowed ${
                    b.isAllIn
                      ? 'bg-red-950/40 text-red-300 hover:bg-red-900/50 border-red-500/20 font-bold'
                      : 'bg-white/5 hover:bg-white/15 border-white/10'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`grid gap-1.5 sm:gap-2 font-bold text-xs sm:text-sm ${canRaise ? 'grid-cols-4' : raiseLockedByShortAllIn ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <button
            onClick={handleFold}
            className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-b from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white rounded-xl shadow-lg active:scale-95 transition-all border border-red-400/30"
          >
            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> 弃牌
          </button>

          <button
            onClick={handleCheckOrCall}
            className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-b from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white rounded-xl shadow-lg active:scale-95 transition-all border border-blue-400/30 whitespace-nowrap px-1"
          >
            <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>{canCheck ? '看牌' : `跟注 $${Math.min(callAmount, localPlayer.chips)}`}</span>
          </button>

          {canRaise && (
            <button
              onClick={handleRaise}
              className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-b from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black font-extrabold rounded-xl shadow-lg active:scale-95 transition-all border border-yellow-300/40 whitespace-nowrap px-1"
            >
              <ArrowUpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>{currentBet === 0 ? '下注' : '加注'}</span>
            </button>
          )}

          {!raiseLockedByShortAllIn && (
            <button
              onClick={handleAllIn}
              className="flex items-center justify-center gap-1 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-black rounded-xl shadow-lg active:scale-95 transition-all border border-purple-400/30 whitespace-nowrap px-1"
            >
              <Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300 shrink-0" /> ALL-IN
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
