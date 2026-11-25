import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Share2, Bot, Play, QrCode, HelpCircle, X, Check } from 'lucide-react';
import { soundManager } from '../audio/sounds';
import QRCode from 'qrcode';

interface HeaderBarProps {
  roomId: string;
  isHost: boolean;
  canStart: boolean;
  isTableFull: boolean;
  onStartHand: () => void;
  onAddBot: () => void;
  handNumber: number;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  roomId,
  isHost,
  canStart,
  isTableFull,
  onStartHand,
  onAddBot,
  handNumber,
}) => {
  const [muted, setMuted] = useState(!soundManager.enabled);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowQr(false);
        setShowRules(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleSound = () => {
    soundManager.enabled = !soundManager.enabled;
    setMuted(!soundManager.enabled);
  };

  const copyInviteLink = () => {
    const url = window.location.origin + window.location.pathname + `?room=${roomId}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenQr = async () => {
    const url = window.location.origin + window.location.pathname + `?room=${roomId}`;
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 240, margin: 2 });
      setQrDataUrl(dataUrl);
      setShowQr(true);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <header className="w-full flex items-center justify-between px-3 sm:px-6 py-2.5 bg-black/60 backdrop-blur-md border-b border-white/10 z-30 select-none">
        {/* 房间号与局数 */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 bg-neutral-900/90 px-2.5 sm:px-3 py-1 rounded-full border border-amber-500/30 shadow-inner">
            <span className="text-xs text-neutral-400 font-medium">房间:</span>
            <span className="text-xs sm:text-sm font-mono font-black text-amber-400 tracking-wider">
              {roomId}
            </span>
          </div>

          <span className="hidden sm:inline-block text-xs text-neutral-400 font-mono">
            第 {handNumber} 局
          </span>
        </div>

        {/* 快捷操作区 */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* 复制邀请 */}
          <button
            onClick={copyInviteLink}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg transition-all ${
              copied
                ? 'bg-emerald-600/30 border border-emerald-400/50 text-emerald-300'
                : 'bg-white/10 hover:bg-white/20 text-neutral-200'
            }`}
            title="复制邀请链接"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
            <span className={copied ? 'inline font-bold' : 'hidden sm:inline'}>
              {copied ? '已复制' : '邀请'}
            </span>
          </button>

          {/* 手机扫码入桌 */}
          <button
            onClick={handleOpenQr}
            className="flex items-center gap-1 px-2.5 py-1 bg-white/10 hover:bg-white/20 text-neutral-200 text-xs rounded-lg transition-all"
            title="手机扫码加入"
          >
            <QrCode className="w-3.5 h-3.5 text-amber-300" />
            <span className="hidden sm:inline">扫码</span>
          </button>

          {/* 添加电脑 (未满桌时可用) */}
          {isHost && !isTableFull && (
            <button
              onClick={onAddBot}
              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/30 text-emerald-300 text-xs rounded-lg transition-all"
              title="添加一个 AI 玩家"
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">+电脑</span>
            </button>
          )}

          {/* 房主等待阶段开局按钮 */}
          {isHost && canStart && (
            <button
              onClick={onStartHand}
              className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-extrabold text-xs rounded-lg shadow-md transition-all active:scale-95 animate-pulse"
            >
              <Play className="w-3.5 h-3.5 fill-black" />
              <span>发牌开局</span>
            </button>
          )}

          {/* 音效开关 */}
          <button
            onClick={toggleSound}
            className="p-1.5 text-neutral-400 hover:text-white transition-colors"
            title={muted ? '开启声音' : '静音'}
          >
            {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          {/* 规则说明 */}
          <button
            onClick={() => setShowRules(true)}
            className="p-1.5 text-neutral-400 hover:text-white transition-colors"
            title="德扑牌型规则"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 手机扫码弹窗（移出 header 以避免 backdrop-blur 截断 fixed 定位） */}
      {showQr && (
        <div
          onClick={() => setShowQr(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-neutral-900 border border-white/20 p-5 rounded-2xl flex flex-col items-center gap-3 max-w-xs w-full shadow-2xl relative"
          >
            <button
              onClick={() => setShowQr(false)}
              aria-label="关闭扫码弹窗"
              className="absolute top-3 right-3 p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="font-bold text-amber-400 text-sm">手机扫码一键入座</h3>
            <div className="p-2 bg-white rounded-xl shadow-inner">
              <img src={qrDataUrl} alt="Room QR" className="w-48 h-48" />
            </div>
            <p className="text-[11px] text-neutral-400 text-center">
              用手机相机或微信扫一扫，免下载任何 App，即可实时联机！
            </p>
          </div>
        </div>
      )}

      {/* 规则弹窗 */}
      {showRules && (
        <div
          onClick={() => setShowRules(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-neutral-900 border border-white/20 p-5 rounded-2xl flex flex-col gap-3 max-w-md w-full shadow-2xl relative max-h-[85vh] overflow-y-auto"
          >
            <button
              onClick={() => setShowRules(false)}
              aria-label="关闭规则弹窗"
              className="absolute top-3 right-3 p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="font-bold text-amber-400 text-base pr-6">德州扑克牌型大小顺序</h3>
            <div className="flex flex-col gap-2 text-xs text-neutral-300 divide-y divide-white/5">
              <div className="pt-1.5"><b className="text-amber-300">1. 皇家同花顺</b>：同花色的 A-K-Q-J-10</div>
              <div className="pt-1.5"><b className="text-amber-300">2. 同花顺</b>：同一花色的五张顺子（如 ♠9-8-7-6-5）</div>
              <div className="pt-1.5"><b className="text-amber-300">3. 四条 (金刚)</b>：四张相同点数（如 8-8-8-8-K）</div>
              <div className="pt-1.5"><b className="text-amber-300">4. 葫芦 (满堂红)</b>：三条带一对（如 Q-Q-Q-7-7）</div>
              <div className="pt-1.5"><b className="text-amber-300">5. 同花</b>：五张相同花色但非顺子</div>
              <div className="pt-1.5"><b className="text-amber-300">6. 顺子</b>：五张连续点数但不同花色</div>
              <div className="pt-1.5"><b className="text-amber-300">7. 三条</b>：三张相同点数（如 J-J-J-9-4）</div>
              <div className="pt-1.5"><b className="text-amber-300">8. 两对</b>：两个不同点数的对子（如 A-A-8-8-3）</div>
              <div className="pt-1.5"><b className="text-amber-300">9. 一对</b>：两张相同点数（如 10-10-K-7-2）</div>
              <div className="pt-1.5"><b className="text-amber-300">10. 高牌</b>：无任何组合，按单牌从大到小比较</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
