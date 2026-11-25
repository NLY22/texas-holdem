import React, { useState } from 'react';
import {
  Spade,
  Users,
  Play,
  Sparkles,
  Loader2,
  AlertCircle,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { DEFAULT_ROOM_CONFIG, RoomConfig } from '../types/poker';
import { normalizeRoomId } from '../network/p2p';

interface LobbyModalProps {
  initialRoomId?: string;
  onCreateRoom: (nickname: string, config: RoomConfig) => Promise<void>;
  onJoinRoom: (roomId: string, nickname: string) => Promise<void>;
  onQuickPractice: (nickname: string, config: RoomConfig) => void;
}

const NICK_KEY = 'tx_holdem_nickname';

function loadSavedNickname(): string {
  try {
    const v = localStorage.getItem(NICK_KEY);
    if (v && v.trim()) return v.trim();
  } catch {}
  return '玩家' + Math.floor(1000 + Math.random() * 9000);
}

function extractRoomCode(input: string): string {
  const match = input.match(/[?&]room=([A-Za-z0-9-]+)/i);
  if (match) return normalizeRoomId(match[1]);
  return normalizeRoomId(input);
}

export const LobbyModal: React.FC<LobbyModalProps> = ({
  initialRoomId = '',
  onCreateRoom,
  onJoinRoom,
  onQuickPractice,
}) => {
  const [nickname, setNickname] = useState(loadSavedNickname);
  const [roomId, setRoomId] = useState(initialRoomId ? normalizeRoomId(initialRoomId) : '');
  const [mode, setMode] = useState<'CREATE' | 'JOIN'>(initialRoomId ? 'JOIN' : 'CREATE');
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<RoomConfig>({ ...DEFAULT_ROOM_CONFIG });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const persistNickname = (val: string) => {
    setNickname(val);
    try {
      if (val.trim()) localStorage.setItem(NICK_KEY, val.trim());
    } catch {}
  };

  const handleCreate = async () => {
    if (loading) return;
    setErrorMsg('');
    setLoading(true);
    try {
      await onCreateRoom(nickname.trim() || '房主', config);
    } catch (e: any) {
      setErrorMsg(e?.message || '创建房间失败，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    const code = extractRoomCode(roomId);
    if (loading || !code) return;
    setErrorMsg('');
    setLoading(true);
    try {
      await onJoinRoom(code, nickname.trim() || '玩家');
    } catch (e: any) {
      setErrorMsg(e?.message || '加入房间失败，请确认房间号并重试');
    } finally {
      setLoading(false);
    }
  };

  const blindPresets = [
    { label: '5 / 10', sb: 5, bb: 10 },
    { label: '10 / 20', sb: 10, bb: 20 },
    { label: '25 / 50', sb: 25, bb: 50 },
    { label: '50 / 100', sb: 50, bb: 100 },
  ];

  const chipPresets = [500, 1000, 2000, 5000];
  const timeoutPresets = [
    { label: '不限时', val: 0 },
    { label: '20s', val: 20 },
    { label: '30s', val: 30 },
    { label: '45s', val: 45 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-in fade-in">
      <div className="w-full max-w-md my-auto bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-950 border border-amber-500/30 rounded-3xl p-5 sm:p-7 shadow-2xl flex flex-col gap-4 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-44 h-44 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* 标题 */}
        <div className="flex flex-col items-center text-center gap-1">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20 mb-0.5">
            <Spade className="w-7 h-7 text-neutral-950 fill-neutral-950" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-500 tracking-tight">
            德州扑克实时对决
          </h1>
          <p className="text-[11px] text-neutral-400">
            免安装 · 跨网络直连 · 断线保座 · 战绩算账
          </p>
        </div>

        {/* 模式 Tab */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-black/40 rounded-xl border border-white/5">
          <button
            disabled={loading}
            onClick={() => {
              setMode('CREATE');
              setErrorMsg('');
            }}
            className={`py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'CREATE'
                ? 'bg-amber-400 text-black shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            创建房间 (房主)
          </button>
          <button
            disabled={loading}
            onClick={() => {
              setMode('JOIN');
              setErrorMsg('');
            }}
            className={`py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'JOIN'
                ? 'bg-amber-400 text-black shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            加入房间 (朋友)
          </button>
        </div>

        {/* 表单输入 */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-neutral-400 font-medium mb-1 block">
              您的游戏昵称
            </label>
            <input
              type="text"
              value={nickname}
              disabled={loading}
              onChange={e => persistNickname(e.target.value)}
              placeholder="请输入昵称"
              maxLength={12}
              className="w-full px-3.5 py-2.5 bg-black/50 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 transition-all font-medium disabled:opacity-60"
            />
          </div>

          {mode === 'JOIN' && (
            <div>
              <label className="text-xs text-neutral-400 font-medium mb-1 block">
                房间号 / 邀请链接
              </label>
              <input
                type="text"
                value={roomId}
                disabled={loading}
                onChange={e => {
                  setRoomId(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="输入 8821 或 TX-8821 或粘贴链接"
                className="w-full px-3.5 py-2.5 bg-black/50 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 transition-all font-mono uppercase tracking-wider disabled:opacity-60"
              />
            </div>
          )}

          {/* 开房规则折叠面板 */}
          {mode === 'CREATE' && (
            <div className="bg-black/35 border border-white/10 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowConfig(v => !v)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-neutral-300 hover:bg-white/5 transition-colors"
              >
                <span className="flex items-center gap-1.5 font-semibold text-amber-300">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  牌局规则设置
                </span>
                <span className="flex items-center gap-1 text-[11px] text-neutral-400 font-mono">
                  {config.smallBlind}/{config.bigBlind} · ${config.startingChips} ·{' '}
                  {config.actionTimeoutSec > 0 ? `${config.actionTimeoutSec}s` : '不限时'}
                  {showConfig ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>

              {showConfig && (
                <div className="px-3.5 pb-3 pt-1 flex flex-col gap-2.5 border-t border-white/5 text-[11px]">
                  {/* 盲注 */}
                  <div>
                    <div className="text-neutral-400 mb-1">盲注级别 (SB/BB)</div>
                    <div className="grid grid-cols-4 gap-1">
                      {blindPresets.map(b => (
                        <button
                          key={b.label}
                          type="button"
                          onClick={() =>
                            setConfig(prev => ({
                              ...prev,
                              smallBlind: b.sb,
                              bigBlind: b.bb,
                              ante: prev.ante > 0 ? Math.floor(b.bb / 2) : 0,
                            }))
                          }
                          className={`py-1 rounded font-mono font-bold border transition-all ${
                            config.bigBlind === b.bb
                              ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                              : 'bg-white/5 border-white/5 text-neutral-400 hover:text-white'
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 初始筹码 */}
                  <div>
                    <div className="text-neutral-400 mb-1">初始带入筹码</div>
                    <div className="grid grid-cols-4 gap-1">
                      {chipPresets.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setConfig(prev => ({ ...prev, startingChips: c }))}
                          className={`py-1 rounded font-mono font-bold border transition-all ${
                            config.startingChips === c
                              ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                              : 'bg-white/5 border-white/5 text-neutral-400 hover:text-white'
                          }`}
                        >
                          ${c}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 行动限时 */}
                  <div>
                    <div className="text-neutral-400 mb-1">单步行动限时</div>
                    <div className="grid grid-cols-4 gap-1">
                      {timeoutPresets.map(t => (
                        <button
                          key={t.val}
                          type="button"
                          onClick={() => setConfig(prev => ({ ...prev, actionTimeoutSec: t.val }))}
                          className={`py-1 rounded font-semibold border transition-all ${
                            config.actionTimeoutSec === t.val
                              ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                              : 'bg-white/5 border-white/5 text-neutral-400 hover:text-white'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 前注 & 自动续局 & 升盲 */}
                  <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setConfig(prev => ({
                          ...prev,
                          ante: prev.ante === 0 ? Math.max(1, Math.floor(prev.bigBlind / 2)) : 0,
                        }))
                      }
                      className={`py-1.5 px-1 rounded border font-medium transition-all ${
                        config.ante > 0
                          ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                          : 'bg-white/5 border-white/5 text-neutral-400'
                      }`}
                    >
                      前注: {config.ante > 0 ? `$${config.ante}` : '关闭'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig(prev => ({ ...prev, autoNextHand: !prev.autoNextHand }))
                      }
                      className={`py-1.5 px-1 rounded border font-medium transition-all ${
                        config.autoNextHand
                          ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                          : 'bg-white/5 border-white/5 text-neutral-400'
                      }`}
                    >
                      {config.autoNextHand ? '5s自动续局' : '手动下一手'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig(prev => ({
                          ...prev,
                          blindEscalationHands: prev.blindEscalationHands === 0 ? 10 : 0,
                        }))
                      }
                      className={`py-1.5 px-1 rounded border font-medium transition-all ${
                        config.blindEscalationHands > 0
                          ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                          : 'bg-white/5 border-white/5 text-neutral-400'
                      }`}
                    >
                      {config.blindEscalationHands > 0 ? '10手翻倍盲' : '固定盲注'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 内联错误提示 */}
        {errorMsg && (
          <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-950/70 border border-red-500/50 rounded-xl text-xs text-red-200 leading-relaxed">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 主行动按钮 */}
        <div className="flex flex-col gap-2.5">
          {mode === 'CREATE' ? (
            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-300 disabled:opacity-60 text-black font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-black" />}
              {loading ? '正在创建服务端牌桌...' : '创建房间并入座'}
            </button>
          ) : (
            <button
              onClick={handleJoin}
              disabled={!extractRoomCode(roomId) || loading}
              className="w-full py-3 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-300 disabled:opacity-45 text-black font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              {loading ? '正在加入房间...' : '进入房间对决'}
            </button>
          )}

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-white/10" />
            <span className="flex-shrink mx-3 text-[10px] text-neutral-500 uppercase tracking-widest">
              或者
            </span>
            <div className="flex-grow border-t border-white/10" />
          </div>

          <button
            disabled={loading}
            onClick={() => onQuickPractice(nickname.trim() || '您 (VIP)', config)}
            className="w-full py-2.5 bg-emerald-950/70 hover:bg-emerald-900/80 disabled:opacity-50 border border-emerald-500/30 text-emerald-300 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all active:scale-95"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            单人快速练习 (1 对 5 智能 AI · 离线秒开)
          </button>
        </div>
      </div>
    </div>
  );
};
