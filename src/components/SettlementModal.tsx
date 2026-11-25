import React, { useState } from 'react';
import {
  X,
  Trophy,
  Copy,
  Check,
  LogOut,
  Power,
  RotateCcw,
  Crown,
  Bot,
  AlertTriangle,
} from 'lucide-react';
import { GameStage, LedgerEntry, Player } from '../types/poker';

interface SettlementModalProps {
  mode: 'live' | 'dissolved';
  roomId: string;
  roundNumber: number;
  handNumber: number;
  stage: GameStage;
  isHost: boolean;
  isPractice: boolean;
  localPlayer: Player | null;
  players: (Player | null)[];
  ledger: Record<string, LedgerEntry>;
  onClose: () => void;
  onLeaveRoom: () => void;
  onTransferAndLeave?: (targetPlayerId: string) => void;
  onResetTable?: () => void;
  onDissolveRoom?: () => void;
}

export const SettlementModal: React.FC<SettlementModalProps> = ({
  mode,
  roomId,
  roundNumber,
  handNumber,
  stage,
  isHost,
  isPractice,
  localPlayer,
  players,
  ledger,
  onClose,
  onLeaveRoom,
  onTransferAndLeave,
  onResetTable,
  onDissolveRoom,
}) => {
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'leave' | 'dissolve' | 'reset' | null>(null);
  const [selectedSuccessor, setSelectedSuccessor] = useState<string>('');

  const allEntries = Object.values(ledger);
  const humanEntries = allEntries
    .filter(e => !e.isBot)
    .sort((a, b) => b.currentChips - b.totalBuyIn - (a.currentChips - a.totalBuyIn));
  const botEntries = allEntries.filter(e => e.isBot);
  const botNet = botEntries.reduce((s, e) => s + (e.currentChips - e.totalBuyIn), 0);

  const otherOnlineHumans = players.filter(
    (p): p is Player =>
      p !== null &&
      !p.isBot &&
      p.id !== localPlayer?.id &&
      p.status !== 'DISCONNECTED'
  );
  const effectiveSuccessor = selectedSuccessor || otherOnlineHumans[0]?.id || '';

  const isMidHand = stage !== 'WAITING' && stage !== 'SHOWDOWN';
  const localActiveMidHand =
    isMidHand && localPlayer && !localPlayer.folded && localPlayer.status !== 'SITTING_OUT';

  const copyWeChatSummary = () => {
    const lines = [
      `🃏【德扑战绩单 ${roomId} · 第${roundNumber}轮 (共${handNumber}手)】`,
      ...humanEntries.map((e, i) => {
        const net = e.currentChips - e.totalBuyIn;
        const sign = net > 0 ? '+' : '';
        const tag = e.status === 'LEFT' ? ' [已离桌]' : '';
        return `${i + 1}. ${e.name}${tag}: ${sign}$${net} (买入 $${e.totalBuyIn} → 结余 $${e.currentChips})`;
      }),
    ];
    if (botEntries.length > 0) {
      const bSign = botNet > 0 ? '+' : '';
      lines.push(`🤖 AI 电脑总净值: ${bSign}$${botNet}（与真人账目分开计算）`);
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={mode === 'live' ? onClose : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-neutral-900 border border-amber-500/30 rounded-2xl p-4 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto relative"
      >
        {mode === 'live' && (
          <button
            onClick={onClose}
            aria-label="关闭战绩窗口"
            className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* 标题 */}
        <div className="flex items-center gap-2.5 pr-8">
          <div className="w-9 h-9 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
            <Trophy className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-black text-amber-300">
              {mode === 'dissolved' ? '本场牌局已散场结算' : '实时战绩账本与离桌控制'}
            </h3>
            <p className="text-[11px] text-neutral-400 font-mono">
              房间 {roomId} · 第 {roundNumber} 轮 · 已打 {handNumber} 手
            </p>
          </div>
        </div>

        {/* 真人盈亏账本 */}
        <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-white/5 flex items-center justify-between text-[11px] text-neutral-400 font-semibold">
            <span>真人玩家盈亏榜</span>
            <span>买入 / 结余 / 净盈亏</span>
          </div>

          {humanEntries.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-500">暂无记录</div>
          ) : (
            <div className="divide-y divide-white/5">
              {humanEntries.map((entry, idx) => {
                const net = entry.currentChips - entry.totalBuyIn;
                const isSelf = entry.playerId === localPlayer?.id;
                return (
                  <div
                    key={entry.playerId}
                    className={`px-3 py-2.5 flex items-center justify-between text-xs ${
                      isSelf ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                          idx === 0 && net > 0
                            ? 'bg-amber-400 text-black'
                            : 'bg-white/10 text-neutral-300'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white truncate max-w-[110px]">
                            {entry.name}
                          </span>
                          {isSelf && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                              我
                            </span>
                          )}
                          {entry.status === 'LEFT' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-300">
                              已离桌
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-neutral-500">
                          参与 {entry.handsPlayed} 手 · 赢 {entry.handsWon} 手
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 font-mono shrink-0">
                      <span className="text-[11px] text-neutral-400">
                        ${entry.totalBuyIn} → ${entry.currentChips}
                      </span>
                      <span
                        className={`font-black min-w-[64px] text-right ${
                          net > 0
                            ? 'text-emerald-400'
                            : net < 0
                            ? 'text-rose-400'
                            : 'text-neutral-300'
                        }`}
                      >
                        {net > 0 ? `+$${net}` : net < 0 ? `-$${Math.abs(net)}` : '$0'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {botEntries.length > 0 && (
            <div className="px-3 py-2 bg-emerald-950/20 border-t border-white/10 flex items-center justify-between text-[11px] text-neutral-400">
              <span className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-emerald-400" />
                AI 电脑合计 ({botEntries.length} 位，已与真人账单隔离)
              </span>
              <span className={`font-mono font-bold ${botNet >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {botNet >= 0 ? `+$${botNet}` : `-$${Math.abs(botNet)}`}
              </span>
            </div>
          )}
        </div>

        {/* 一键复制微信战绩 */}
        <button
          onClick={copyWeChatSummary}
          className="w-full py-2.5 bg-white/10 hover:bg-white/15 border border-white/15 rounded-xl text-xs font-bold text-neutral-100 flex items-center justify-center gap-1.5 transition-all"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-amber-300" />}
          {copied ? '已复制战绩单，可直接粘贴发微信群' : '复制微信群对账单'}
        </button>

        {/* 二次确认提示 */}
        {confirmAction && (
          <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/50 flex flex-col gap-2.5 text-xs text-rose-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>
                {confirmAction === 'leave' &&
                  (localActiveMidHand
                    ? '当前一手牌尚未结束，中途退出将自动为您弃牌，已下注筹码保留在底池内。确定退出回大厅吗？'
                    : '确定结清当前筹码并退出房间回到大厅吗？')}
                {confirmAction === 'dissolve' &&
                  (isMidHand
                    ? '当前第 ' + handNumber + ' 手尚未结算，强制散场将把本手各自投入筹码退回至开局前并解散全桌。确定散场吗？'
                    : '解散后房间将关闭，全员会收到最终战绩账单并退出回大厅。确定解散房间吗？')}
                {confirmAction === 'reset' &&
                  '将重置所有在座玩家的筹码为初始值并开始全新一轮计账，确定重置吗？'}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-neutral-200 font-semibold"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const act = confirmAction;
                  setConfirmAction(null);
                  if (act === 'leave') onLeaveRoom();
                  if (act === 'dissolve') onDissolveRoom?.();
                  if (act === 'reset') {
                    onResetTable?.();
                    onClose();
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                确认执行
              </button>
            </div>
          </div>
        )}

        {/* 底部操作按钮 */}
        {mode === 'dissolved' ? (
          <button
            onClick={onLeaveRoom}
            className="w-full py-3 bg-gradient-to-r from-amber-400 to-yellow-500 text-black font-black text-sm rounded-xl shadow-lg"
          >
            确认并返回首页大厅
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            {/* 房主专属：移交房主离开 / 重置再战 / 散场解散 */}
            {isHost && !isPractice && (
              <div className="flex flex-col gap-2 pt-1 border-t border-white/10">
                {otherOnlineHumans.length > 0 && onTransferAndLeave && (
                  <div className="flex items-center gap-2 bg-black/40 p-2 rounded-xl border border-white/10">
                    <Crown className="w-4 h-4 text-amber-400 shrink-0 ml-1" />
                    <select
                      value={effectiveSuccessor}
                      onChange={e => setSelectedSuccessor(e.target.value)}
                      className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                    >
                      {otherOnlineHumans.map(p => (
                        <option key={p.id} value={p.id} className="bg-neutral-900">
                          移交房主给: {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => effectiveSuccessor && onTransferAndLeave(effectiveSuccessor)}
                      className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 text-xs font-bold rounded-lg whitespace-nowrap"
                    >
                      移交并先走
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {onResetTable && (
                    <button
                      onClick={() => setConfirmAction('reset')}
                      className="py-2.5 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/30 text-emerald-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> 重置再战一轮
                    </button>
                  )}
                  {onDissolveRoom && (
                    <button
                      onClick={() => setConfirmAction('dissolve')}
                      className="py-2.5 bg-rose-950/70 hover:bg-rose-900/80 border border-rose-500/40 text-rose-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                    >
                      <Power className="w-3.5 h-3.5" /> 散场解散房间
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 练习模式或普通闲家退出 */}
            {(!isHost || isPractice) && (
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
                {isPractice && onResetTable && (
                  <button
                    onClick={() => setConfirmAction('reset')}
                    className="py-2.5 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/30 text-emerald-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> 重置筹码重开
                  </button>
                )}
                <button
                  onClick={() => setConfirmAction('leave')}
                  className={`${
                    isPractice && onResetTable ? '' : 'col-span-2'
                  } py-2.5 bg-rose-950/70 hover:bg-rose-900/80 border border-rose-500/40 text-rose-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5`}
                >
                  <LogOut className="w-3.5 h-3.5" /> 退出房间回到大厅
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
