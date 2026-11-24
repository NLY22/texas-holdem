import React, { useState } from 'react';
import { Spade, Users, Play, Sparkles } from 'lucide-react';

interface LobbyModalProps {
  initialRoomId?: string;
  onCreateRoom: (nickname: string) => void;
  onJoinRoom: (roomId: string, nickname: string) => void;
  onQuickPractice: () => void;
}

export const LobbyModal: React.FC<LobbyModalProps> = ({
  initialRoomId = '',
  onCreateRoom,
  onJoinRoom,
  onQuickPractice,
}) => {
  const [nickname, setNickname] = useState(
    '玩家' + Math.floor(1000 + Math.random() * 9000)
  );
  const [roomId, setRoomId] = useState(initialRoomId);
  const [mode, setMode] = useState<'CREATE' | 'JOIN'>(initialRoomId ? 'JOIN' : 'CREATE');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in">
      <div className="w-full max-w-md bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-950 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col gap-5 relative overflow-hidden">
        {/* 背景金光 */}
        <div className="absolute -top-20 -right-20 w-44 h-44 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* 标题 */}
        <div className="flex flex-col items-center text-center gap-1.5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20 mb-1">
            <Spade className="w-8 h-8 text-neutral-950 fill-neutral-950" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-500 tracking-tight">
            德州扑克 P2P 实时对决
          </h1>
          <p className="text-xs text-neutral-400">
            纯前端免服务器 · WebRTC 点对点直连 · 多人开黑
          </p>
        </div>

        {/* 模式选择 Tab */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-black/40 rounded-xl border border-white/5">
          <button
            onClick={() => setMode('CREATE')}
            className={`py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'CREATE'
                ? 'bg-amber-400 text-black shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            创建房间 (房主)
          </button>
          <button
            onClick={() => setMode('JOIN')}
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
              onChange={e => setNickname(e.target.value)}
              placeholder="请输入昵称"
              maxLength={12}
              className="w-full px-4 py-2.5 bg-black/50 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 transition-all font-medium"
            />
          </div>

          {mode === 'JOIN' && (
            <div>
              <label className="text-xs text-neutral-400 font-medium mb-1 block">
                房间号 / 邀请码
              </label>
              <input
                type="text"
                value={roomId}
                onChange={e => setRoomId(e.target.value.toUpperCase())}
                placeholder="例如: TX-8821"
                className="w-full px-4 py-2.5 bg-black/50 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 transition-all font-mono uppercase tracking-wider"
              />
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-2 pt-1">
          {mode === 'CREATE' ? (
            <button
              onClick={() => onCreateRoom(nickname)}
              className="w-full py-3 bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-black font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 active:scale-98 transition-all flex items-center justify-center gap-1.5"
            >
              <Users className="w-4 h-4" /> 创建房间并入座
            </button>
          ) : (
            <button
              onClick={() => onJoinRoom(roomId, nickname)}
              disabled={!roomId}
              className="w-full py-3 bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 disabled:opacity-50 text-black font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 active:scale-98 transition-all flex items-center justify-center gap-1.5"
            >
              <Play className="w-4 h-4 fill-black" /> 进入房间对决
            </button>
          )}

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-white/10"></div>
            <span className="flex-shrink mx-3 text-[11px] text-neutral-500">或者</span>
            <div className="flex-grow border-t border-white/10"></div>
          </div>

          {/* 一键人机对练 */}
          <button
            onClick={onQuickPractice}
            className="w-full py-2.5 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-emerald-300 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" /> 单人秒开 (自带5个电脑陪练)
          </button>
        </div>
      </div>
    </div>
  );
};
