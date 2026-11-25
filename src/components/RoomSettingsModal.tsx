import React, { useState } from 'react';
import { X, Bot, Trash2, Palette, PauseCircle, PlayCircle, Coins, Sliders } from 'lucide-react';
import {
  BotPersonality,
  DEFAULT_ROOM_CONFIG,
  GameStage,
  Player,
  RoomConfig,
  TableTheme,
} from '../types/poker';

interface RoomSettingsModalProps {
  isHost: boolean;
  stage: GameStage;
  config: RoomConfig;
  theme: TableTheme;
  localPlayer: Player | null;
  botCount: number;
  isTableFull: boolean;
  onChangeTheme: (theme: TableTheme) => void;
  onToggleSitOut: () => void;
  onTopUp: () => void;
  onAddBot: (personality: BotPersonality) => void;
  onClearBots: () => void;
  onUpdateConfig: (next: Partial<RoomConfig>) => void;
  onClose: () => void;
}

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  isHost,
  stage,
  config,
  theme,
  localPlayer,
  botCount,
  isTableFull,
  onChangeTheme,
  onToggleSitOut,
  onTopUp,
  onAddBot,
  onClearBots,
  onUpdateConfig,
  onClose,
}) => {
  const [draft, setDraft] = useState<RoomConfig>({ ...DEFAULT_ROOM_CONFIG, ...config });

  const themes: { id: TableTheme; name: string; swatch: string }[] = [
    { id: 'emerald', name: '经典祖母绿', swatch: 'from-emerald-600 to-emerald-950' },
    { id: 'obsidian', name: '黑金 VIP', swatch: 'from-neutral-700 to-neutral-950' },
    { id: 'navy', name: '深海午夜蓝', swatch: 'from-sky-800 to-slate-950' },
  ];

  const isSittingOut = (localPlayer?.status || 'ACTIVE') === 'SITTING_OUT' || localPlayer?.sitOutAfterHand;
  const canTopUp =
    localPlayer &&
    (stage === 'WAITING' || stage === 'SHOWDOWN') &&
    localPlayer.chips > 0 &&
    localPlayer.chips < draft.startingChips;

  const blindPresets = [
    { label: '5/10', sb: 5, bb: 10 },
    { label: '10/20', sb: 10, bb: 20 },
    { label: '25/50', sb: 25, bb: 50 },
    { label: '50/100', sb: 50, bb: 100 },
  ];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-in fade-in"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-neutral-900 border border-white/15 rounded-2xl p-5 shadow-2xl flex flex-col gap-4 max-h-[88vh] overflow-y-auto relative"
      >
        <button
          onClick={onClose}
          aria-label="关闭设置"
          className="absolute top-3.5 right-3.5 p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-base font-black text-amber-300 flex items-center gap-2">
          <Sliders className="w-4 h-4" /> 牌桌管理与个人偏好
        </h3>

        {/* 桌面皮肤 */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-neutral-400 font-semibold flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-amber-300" /> 牌桌绒布皮肤
          </span>
          <div className="grid grid-cols-3 gap-2">
            {themes.map(t => (
              <button
                key={t.id}
                onClick={() => onChangeTheme(t.id)}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 text-[11px] font-bold transition-all ${
                  theme === t.id
                    ? 'border-amber-400 bg-amber-400/10 text-amber-300'
                    : 'border-white/10 bg-black/30 text-neutral-400 hover:text-white'
                }`}
              >
                <span className={`w-8 h-5 rounded-full bg-gradient-to-br ${t.swatch} border border-white/20`} />
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {/* 我的状态控制 */}
        {localPlayer && (
          <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
            <span className="text-xs text-neutral-400 font-semibold">我的席位控制</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  onToggleSitOut();
                  onClose();
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 ${
                  isSittingOut
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-neutral-200 hover:bg-white/10'
                }`}
              >
                {isSittingOut ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
                {isSittingOut ? '回到牌局 (下局参战)' : '下局暂离 / 观战'}
              </button>

              {canTopUp && (
                <button
                  onClick={() => {
                    onTopUp();
                    onClose();
                  }}
                  className="py-2 px-3 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  <Coins className="w-4 h-4" /> 补满至 ${draft.startingChips}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 房主专属：AI 性格增添与清理 */}
        {isHost && (
          <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-400 font-semibold flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-emerald-400" /> 自由增删 AI 玩家
              </span>
              {botCount > 0 && (
                <button
                  onClick={onClearBots}
                  className="text-[11px] text-rose-300 hover:text-rose-200 flex items-center gap-1 font-semibold"
                >
                  <Trash2 className="w-3 h-3" /> 清空全部 AI
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                disabled={isTableFull}
                onClick={() => onAddBot('LOOSE')}
                className="py-2 px-2 rounded-xl bg-emerald-950/50 hover:bg-emerald-900/60 disabled:opacity-35 border border-emerald-500/30 text-emerald-200 text-[11px] font-bold"
              >
                🐟 +娱乐松鱼
              </button>
              <button
                disabled={isTableFull}
                onClick={() => onAddBot('TAG')}
                className="py-2 px-2 rounded-xl bg-blue-950/50 hover:bg-blue-900/60 disabled:opacity-35 border border-blue-500/30 text-blue-200 text-[11px] font-bold"
              >
                🛡️ +稳健紧凶
              </button>
              <button
                disabled={isTableFull}
                onClick={() => onAddBot('LAG')}
                className="py-2 px-2 rounded-xl bg-rose-950/50 hover:bg-rose-900/60 disabled:opacity-35 border border-rose-500/30 text-rose-200 text-[11px] font-bold"
              >
                🔥 +激进疯狗
              </button>
            </div>
            <p className="text-[10px] text-neutral-500">
              提示：等待或结算阶段点 AI 座位角落「×」立即移除；手牌进行中点「×」将在本手结束后自动离开。
            </p>
          </div>
        )}

        {/* 房主专属：中途调节牌局规则 */}
        {isHost && (
          <div className="flex flex-col gap-2.5 pt-2 border-t border-white/10 text-xs">
            <span className="text-neutral-400 font-semibold">
              牌局参数（{stage === 'WAITING' ? '保存即生效' : '修改后将在下一手生效'}）
            </span>

            <div className="grid grid-cols-4 gap-1.5">
              {blindPresets.map(b => (
                <button
                  key={b.label}
                  onClick={() =>
                    setDraft(prev => ({
                      ...prev,
                      smallBlind: b.sb,
                      bigBlind: b.bb,
                      ante: prev.ante > 0 ? Math.floor(b.bb / 2) : 0,
                    }))
                  }
                  className={`py-1.5 rounded-lg font-mono text-[11px] font-bold border ${
                    draft.bigBlind === b.bb
                      ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                      : 'bg-white/5 border-white/10 text-neutral-400'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {[0, 20, 30, 45].map(sec => (
                <button
                  key={sec}
                  onClick={() => setDraft(prev => ({ ...prev, actionTimeoutSec: sec }))}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold border ${
                    draft.actionTimeoutSec === sec
                      ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                      : 'bg-white/5 border-white/10 text-neutral-400'
                  }`}
                >
                  {sec === 0 ? '不限时' : `${sec}s限时`}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDraft(prev => ({ ...prev, autoNextHand: !prev.autoNextHand }))}
                className={`py-1.5 rounded-lg border text-[11px] font-semibold ${
                  draft.autoNextHand
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-neutral-400'
                }`}
              >
                {draft.autoNextHand ? '摊牌 5s 自动下一手' : '房主手动下一手'}
              </button>
              <button
                onClick={() =>
                  setDraft(prev => ({
                    ...prev,
                    ante: prev.ante === 0 ? Math.max(1, Math.floor(prev.bigBlind / 2)) : 0,
                  }))
                }
                className={`py-1.5 rounded-lg border text-[11px] font-semibold ${
                  draft.ante > 0
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-neutral-400'
                }`}
              >
                前注 Ante: {draft.ante > 0 ? `$${draft.ante}` : '关闭'}
              </button>
            </div>

            <button
              onClick={() => {
                onUpdateConfig(draft);
                onClose();
              }}
              className="w-full py-2.5 bg-gradient-to-r from-amber-400 to-yellow-500 text-black font-black text-xs rounded-xl shadow"
            >
              保存房间参数
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
