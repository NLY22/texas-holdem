import React, { useState, useEffect } from 'react';
import {
  Volume2,
  VolumeX,
  Share2,
  Bot,
  Play,
  QrCode,
  HelpCircle,
  X,
  Check,
  Sliders,
  History,
  Trophy,
} from 'lucide-react';
import { soundManager } from '../audio/sounds';
import { ConnectionStatus } from '../network/p2p';
import QRCode from 'qrcode';

interface HeaderBarProps {
  roomId: string;
  isHost: boolean;
  isPractice: boolean;
  canStart: boolean;
  isTableFull: boolean;
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  connectionStatus: ConnectionStatus;
  onStartHand: () => void;
  onAddBot: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenSettlement: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  roomId,
  isHost,
  isPractice,
  canStart,
  isTableFull,
  handNumber,
  smallBlind,
  bigBlind,
  connectionStatus,
  onStartHand,
  onAddBot,
  onOpenHistory,
  onOpenSettings,
  onOpenSettlement,
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

  const statusConfig = isPractice
    ? { dot: 'bg-emerald-400', label: '本地' }
    : connectionStatus === 'connected'
    ? { dot: 'bg-emerald-400', label: '在线' }
    : connectionStatus === 'reconnecting' || connectionStatus === 'connecting'
    ? { dot: 'bg-amber-400 animate-pulse', label: '重连中' }
    : { dot: 'bg-rose-500', label: '离线' };

  return (
    <>
      <header className="w-full flex items-center justify-between px-2.5 sm:px-5 py-2 bg-black/65 backdrop-blur-md border-b border-white/10 z-30 select-none gap-1.5">
        {/* 左侧：房间号 + 网络状态 + 盲注/手数 */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
          <div className="flex items-center gap-1.5 bg-neutral-900/90 px-2.5 py-1 rounded-full border border-amber-500/30 shadow-inner shrink-0">
            <span className={`w-2 h-2 rounded-full ${statusConfig.dot}`} title={statusConfig.label} />
            <span className="text-[11px] sm:text-xs font-mono font-black text-amber-400 tracking-wider">
              {roomId}
            </span>
          </div>

          <span className="hidden md:inline-block text-[11px] text-neutral-400 font-mono whitespace-nowrap">
            第 {handNumber} 手 · 盲注 {smallBlind}/{bigBlind}
          </span>
        </div>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {!isPractice && (
            <>
              <button
                onClick={copyInviteLink}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-all ${
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

              <button
                onClick={handleOpenQr}
                className="flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/20 text-neutral-200 text-xs rounded-lg transition-all"
                title="手机扫码加入"
              >
                <QrCode className="w-3.5 h-3.5 text-amber-300" />
                <span className="hidden lg:inline">扫码</span>
              </button>
            </>
          )}

          {isHost && !isTableFull && (
            <button
              onClick={onAddBot}
              className="flex items-center gap-1 px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/30 text-emerald-300 text-xs rounded-lg transition-all"
              title="添加一个 AI 电脑"
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">+AI</span>
            </button>
          )}

          {isHost && canStart && (
            <button
              onClick={onStartHand}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-extrabold text-xs rounded-lg shadow-md transition-all active:scale-95 animate-pulse"
            >
              <Play className="w-3.5 h-3.5 fill-black" />
              <span>发牌开局</span>
            </button>
          )}

          <button
            onClick={onOpenHistory}
            className="p-1.5 text-neutral-300 hover:text-amber-300 hover:bg-white/10 rounded-lg transition-colors"
            title="牌局动作记录"
          >
            <History className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenSettings}
            className="p-1.5 text-neutral-300 hover:text-amber-300 hover:bg-white/10 rounded-lg transition-colors"
            title="牌桌设置与皮肤"
          >
            <Sliders className="w-4 h-4" />
          </button>

          <button
            onClick={toggleSound}
            className="hidden sm:inline-flex p-1.5 text-neutral-400 hover:text-white transition-colors"
            title={muted ? '开启声音' : '静音'}
          >
            {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          <button
            onClick={() => setShowRules(true)}
            className="hidden sm:inline-flex p-1.5 text-neutral-400 hover:text-white transition-colors"
            title="德扑牌型规则"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* 战绩账本与退出/解散总入口 */}
          <button
            onClick={onOpenSettlement}
            className="flex items-center gap-1 px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/35 text-rose-200 text-xs font-bold rounded-lg transition-all"
            title="查看实时战绩或退出/解散房间"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-300" />
            <span>战绩/退出</span>
          </button>
        </div>
      </header>

      {/* 手机扫码弹窗 */}
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
              用手机相机或微信扫一扫，无需梯子即可跨网实时联机！
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
