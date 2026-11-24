import React, { useEffect } from 'react';
import { GameState, Player } from '../types/poker';
import { Seat } from './Seat';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { evaluate7Cards } from '../engine/evaluator';
import { soundManager } from '../audio/sounds';
import confetti from 'canvas-confetti';
import { Trophy } from 'lucide-react';

interface TableProps {
  gameState: GameState;
  localPlayer: Player | null;
  onSitDown: (seatIndex: number) => void;
  onAddBot?: (seatIndex: number) => void;
}

export const Table: React.FC<TableProps> = ({
  gameState,
  localPlayer,
  onSitDown,
  onAddBot,
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

  // 胜利彩带与音效触发
  useEffect(() => {
    if (stage === 'SHOWDOWN' && winners.length > 0) {
      soundManager.playWinChime();
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }, [stage, winners]);

  // 本地玩家当前手牌分析提示
  let handTip = '';
  if (localPlayer && localPlayer.holeCards.length === 2 && !localPlayer.folded) {
    const ev = evaluate7Cards(localPlayer.holeCards, communityCards);
    handTip = ev.name;
  }

  // 6人桌环形坐标定义 (百分比定位)
  const seatPositions = [
    'bottom-2 left-1/2 -translate-x-1/2',        // 席位 0 (底部中间 - 主视角)
    'bottom-16 sm:bottom-20 left-4 sm:left-12', // 席位 1 (左下)
    'top-16 sm:top-20 left-4 sm:left-12',       // 席位 2 (左上)
    'top-2 left-1/2 -translate-x-1/2',           // 席位 3 (顶部中间)
    'top-16 sm:top-20 right-4 sm:right-12',     // 席位 4 (右上)
    'bottom-16 sm:bottom-20 right-4 sm:right-12' // 席位 5 (右下)
  ];

  return (
    <div className="relative w-full max-w-5xl h-[560px] sm:h-[640px] my-auto flex items-center justify-center p-2 sm:p-6 select-none">
      {/* 椭圆实木外边框 */}
      <div className="relative w-full h-full rounded-[140px] sm:rounded-[200px] bg-gradient-to-b from-[#2a1b14] via-[#1a0f0a] to-[#2a1b14] p-3 sm:p-5 shadow-2xl border-4 border-[#4a2e1b]">
        {/* 皮质扶手内衬 */}
        <div className="relative w-full h-full rounded-[120px] sm:rounded-[180px] bg-gradient-to-b from-[#143d1a] to-[#0d2811] p-2.5 sm:p-4 shadow-inner border border-emerald-500/20">
          {/* 经典绒面桌布 Felt */}
          <div className="relative w-full h-full rounded-[110px] sm:rounded-[165px] bg-radial from-emerald-700 via-emerald-800 to-emerald-950 flex flex-col items-center justify-center shadow-table overflow-hidden">
            {/* 桌布中央水印标志 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
              <div className="text-8xl sm:text-9xl font-black tracking-widest text-white">
                ♠ ♥ ♦ ♣
              </div>
            </div>

            {/* 桌布中央区：底池与公共牌 */}
            <div className="relative z-10 flex flex-col items-center">
              <PotDisplay totalPot={totalPot} pots={pots} />
              <CommunityCards cards={communityCards} stage={stage} />

              {/* 摊牌赢家公布横幅 */}
              {stage === 'SHOWDOWN' && winners.length > 0 && (
                <div className="animate-in zoom-in-90 fade-in duration-300 mt-2 bg-gradient-to-r from-amber-900/90 via-black/90 to-amber-900/90 border border-amber-400 px-4 py-2 rounded-xl flex items-center gap-2 shadow-2xl backdrop-blur-md">
                  <Trophy className="w-5 h-5 text-amber-400 animate-bounce" />
                  <div className="flex flex-col items-start leading-tight">
                    <span className="text-xs sm:text-sm font-black text-amber-300">
                      赢家: {winners.map(w => `${w.name} (+$${w.amount})`).join(', ')}
                    </span>
                    <span className="text-[10px] text-amber-200/70">
                      {winners[0]?.handName}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 本地玩家手牌牌型提示浮动条 */}
            {handTip && stage !== 'SHOWDOWN' && (
              <div className="absolute bottom-20 sm:bottom-24 z-20 bg-black/70 backdrop-blur-md px-3 py-1 rounded-full border border-emerald-400/30 text-[11px] text-emerald-300 font-medium shadow-md">
                当前牌型: <b className="text-amber-300">{handTip}</b>
              </div>
            )}
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
            onSitDown={onSitDown}
            onAddBot={onAddBot}
            className={`absolute ${seatPositions[idx]} z-20`}
          />
        ))}
      </div>
    </div>
  );
};
