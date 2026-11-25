import React, { useEffect } from 'react';
import { GameState, Player } from '../types/poker';
import { Seat } from './Seat';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { evaluate7Cards } from '../engine/evaluator';
import { soundManager } from '../audio/sounds';
import confetti from 'canvas-confetti';
import { Trophy, Play, RefreshCw } from 'lucide-react';

interface TableProps {
  gameState: GameState;
  localPlayer: Player | null;
  onSitDown?: (seatIndex: number) => void;
  onAddBot?: (seatIndex: number) => void;
  onNextHand?: () => void;
  onRebuy?: () => void;
}

export const Table: React.FC<TableProps> = ({
  gameState,
  localPlayer,
  onSitDown,
  onAddBot,
  onNextHand,
  onRebuy,
}) => {
  const {
    stage,
    communityCards,
    pots,
    totalPot,
    dealerIndex,
    smallBlindIndex,
    bigBlindIndex,
    activePlayerIndex,
    players,
    winners,
  } = gameState;

  // 仅当本地玩家本人获胜时才触发胜利彩带与庆祝音效
  useEffect(() => {
    if (stage === 'SHOWDOWN' && winners.length > 0 && localPlayer) {
      const didLocalWin = winners.some(w => w.playerId === localPlayer.id);
      if (didLocalWin) {
        soundManager.playWinChime();
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.5 }
        });
      }
    }
  }, [stage, winners, localPlayer?.id]);

  // 本地玩家当前手牌分析提示
  let handTip = '';
  if (localPlayer && localPlayer.holeCards.length === 2 && !localPlayer.folded) {
    const ev = evaluate7Cards(localPlayer.holeCards, communityCards);
    handTip = ev.name;
  }

  // 6人桌环形坐标定义 (上下席位略向外延展，彻底消除顶部筹码/底池与底部牌型提示/手牌的碰边重叠)
  const seatPositions = [
    '-bottom-8 sm:-bottom-9 left-1/2 -translate-x-1/2', // 席位 0 (底部中间 - 主视角)
    'bottom-[15%] left-0 sm:left-4',                    // 席位 1 (左下)
    'top-[15%] left-0 sm:left-4',                       // 席位 2 (左上)
    '-top-10 sm:-top-11 left-1/2 -translate-x-1/2',     // 席位 3 (顶部中间)
    'top-[15%] right-0 sm:right-4',                     // 席位 4 (右上)
    'bottom-[15%] right-0 sm:right-4'                   // 席位 5 (右下)
  ];

  const canModifySeats = stage === 'WAITING';
  const isBusted = localPlayer && localPlayer.chips <= 0 && (stage === 'SHOWDOWN' || stage === 'WAITING');

  return (
    <div className="relative w-full max-w-5xl h-[550px] sm:h-[600px] my-auto flex items-center justify-center px-3 sm:px-8 py-4 select-none">
      {/* 椭圆实木外边框 */}
      <div className="relative w-full h-full rounded-[140px] sm:rounded-[200px] bg-gradient-to-b from-[#2a1b14] via-[#1a0f0a] to-[#2a1b14] p-3 sm:p-4 shadow-2xl border-4 border-[#4a2e1b]">
        {/* 皮质扶手内衬 */}
        <div className="relative w-full h-full rounded-[120px] sm:rounded-[180px] bg-gradient-to-b from-[#143d1a] to-[#0d2811] p-2 sm:p-3 shadow-inner border border-emerald-500/20">
          {/* 经典绒面桌布 Felt */}
          <div className="relative w-full h-full rounded-[110px] sm:rounded-[165px] bg-radial from-emerald-700 via-emerald-800 to-emerald-950 flex flex-col items-center justify-center shadow-table overflow-hidden px-12 sm:px-20">
            {/* 桌布中央水印标志 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
              <div className="text-7xl sm:text-9xl font-black tracking-widest text-white">
                ♠ ♥ ♦ ♣
              </div>
            </div>

            {/* 桌布中央区：底池、公共牌、手牌提示与摊牌结果 */}
            <div className="relative z-10 flex flex-col items-center">
              <PotDisplay totalPot={totalPot} pots={pots} />
              <CommunityCards cards={communityCards} stage={stage} />

              {/* 本地玩家手牌牌型提示 */}
              {handTip && stage !== 'WAITING' && stage !== 'SHOWDOWN' && (
                <div className="mt-1 bg-black/75 backdrop-blur-md px-3 py-0.5 rounded-full border border-emerald-400/40 text-[11px] text-emerald-300 font-semibold shadow-md">
                  您的牌型: <b className="text-amber-300 font-bold">{handTip}</b>
                </div>
              )}

              {/* 摊牌赢家公布横幅与下一手按钮 */}
              {stage === 'SHOWDOWN' && (
                <div className="animate-in zoom-in-95 fade-in duration-300 mt-2 flex flex-col items-center gap-2 z-30">
                  {winners.length > 0 && (
                    <div className="bg-gradient-to-r from-amber-950/95 via-black/95 to-amber-950/95 border border-amber-400 px-3.5 py-1.5 rounded-xl flex items-center gap-2 shadow-2xl backdrop-blur-md max-w-[280px] sm:max-w-md">
                      <Trophy className="w-4 h-4 text-amber-400 animate-bounce shrink-0" />
                      <div className="flex flex-col items-start leading-tight">
                        <span className="text-xs sm:text-sm font-black text-amber-300">
                          赢家: {winners.map(w => `${w.name} (+$${w.amount})`).join(', ')}
                        </span>
                        <span className="text-[10px] text-amber-200/75 font-medium">
                          {winners[0]?.handName}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {isBusted && onRebuy && (
                      <button
                        onClick={onRebuy}
                        className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-xs sm:text-sm rounded-full shadow-lg flex items-center gap-1.5 active:scale-95 transition-all"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> 补充筹码 ($1,000)
                      </button>
                    )}

                    {onNextHand && (
                      <button
                        onClick={onNextHand}
                        className="px-5 py-1.5 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-300 text-black font-black text-xs sm:text-sm rounded-full shadow-lg shadow-amber-500/30 flex items-center gap-1.5 active:scale-95 transition-all animate-pulse"
                      >
                        <Play className="w-3.5 h-3.5 fill-black" /> 下一手牌
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 6个席位排布 */}
        {players.map((player, idx) => (
          <Seat
            key={idx}
            player={player}
            seatIndex={idx}
            isCurrentTurn={activePlayerIndex === idx}
            isDealer={dealerIndex === idx}
            isSmallBlind={smallBlindIndex === idx}
            isBigBlind={bigBlindIndex === idx}
            isLocalPlayer={localPlayer?.id === player?.id}
            onSitDown={canModifySeats ? onSitDown : undefined}
            onAddBot={canModifySeats ? onAddBot : undefined}
            className={`absolute ${seatPositions[idx]} z-20`}
          />
        ))}
      </div>
    </div>
  );
};
