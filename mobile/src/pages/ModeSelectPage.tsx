import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, Check, Loader2, Settings2 } from 'lucide-react';
import {
  DEFAULT_LIVE_BASE,
  MOCK_ACCOUNTS,
  getBase,
  getMode,
  isModeChosen,
  isValidBase,
  markModeChosen,
  setBase,
  setMode,
  testConnection,
} from '../platform/mode';
import { Banner, PrimaryButton } from '../components/ui';

type Choice = 'mock' | 'live';

/**
 * 首启「体验模式」选择页 —— 一个 APK 两用的入口。
 * 也可以在「我的 → 设置」里重新进入本页切换。
 */
export default function ModeSelectPage() {
  const navigate = useNavigate();
  const alreadyChosen = isModeChosen();
  const current = getMode();

  const [choice, setChoice] = useState<Choice>(current);
  const [base, setBaseInput] = useState(getBase() || DEFAULT_LIVE_BASE);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [liveVerified, setLiveVerified] = useState(false);

  const enter = (mode: Choice) => {
    setMode(mode);
    if (mode === 'live') setBase(base.trim());
    markModeChosen();
    // 首次启动 → 去登录页；从设置里进来 → 返回上一页
    if (alreadyChosen) {
      navigate(-1);
    } else {
      navigate('/auth', { replace: true });
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testConnection(base);
    setTestResult(res);
    setLiveVerified(res.ok);
    setTesting(false);
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-emerald-600 to-emerald-500 flex flex-col">
      <div className="pt-safe" />
      <div className="px-6 pt-10 pb-6 text-white">
        <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-4 text-2xl">
          🧠
        </div>
        <h1 className="text-2xl font-bold">心理守护</h1>
        <p className="text-sm text-white/80 mt-1">选择体验模式 · 随时可在设置里切换</p>
      </div>

      <div className="flex-1 bg-slate-50 rounded-t-3xl px-4 pt-5 pb-safe overflow-y-auto">
        <div className="space-y-3">
          {/* 离线演示 */}
          <button
            onClick={() => setChoice('mock')}
            className={`w-full text-left rounded-2xl border-2 p-4 bg-white transition-colors ${
              choice === 'mock' ? 'border-emerald-500' : 'border-transparent'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <WifiOff className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">离线演示</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                    推荐 · 断网可用
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-5">
                  内置完整示例数据，不需要网络。适合答辩演示、无网环境。
                </p>
                <p className="text-[11px] text-slate-400 mt-2">
                  演示账号：{MOCK_ACCOUNTS[0].username} / {MOCK_ACCOUNTS[0].password}
                </p>
              </div>
              {choice === 'mock' && <Check className="w-5 h-5 text-emerald-500 shrink-0" />}
            </div>
          </button>

          {/* 连接实机 */}
          <button
            onClick={() => setChoice('live')}
            className={`w-full text-left rounded-2xl border-2 p-4 bg-white transition-colors ${
              choice === 'live' ? 'border-emerald-500' : 'border-transparent'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <Wifi className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">连接实机</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-600">
                    真实后端
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-5">
                  连接线上 Cloudflare Worker。需要手机网络可达（国内直连通常需科学上网）。
                </p>
              </div>
              {choice === 'live' && <Check className="w-5 h-5 text-emerald-500 shrink-0" />}
            </div>
          </button>

          {/* 实机模式的地址配置 */}
          {choice === 'live' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500 flex items-center gap-1.5 mb-1.5">
                  <Settings2 className="w-3.5 h-3.5" />
                  后端地址
                </span>
                <input
                  value={base}
                  onChange={(e) => {
                    setBaseInput(e.target.value);
                    setLiveVerified(false);
                    setTestResult(null);
                  }}
                  placeholder={DEFAULT_LIVE_BASE}
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </label>
              <button
                onClick={() => void handleTest()}
                disabled={testing || !isValidBase(base)}
                className="w-full min-h-[44px] rounded-xl border border-emerald-500 text-emerald-600 text-sm font-medium active:bg-emerald-50 disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                {testing ? '测试中…' : '测试连接'}
              </button>
              {testResult && (
                <Banner kind={testResult.ok ? 'success' : 'error'}>{testResult.message}</Banner>
              )}
            </div>
          )}
        </div>

        <div className="mt-5">
          <PrimaryButton
            onClick={() => enter(choice)}
            disabled={choice === 'live' && !liveVerified}
            className="!bg-emerald-600 !active:bg-emerald-700"
          >
            {choice === 'live' && !liveVerified ? '请先测试连接' : '进入应用'}
          </PrimaryButton>
          {alreadyChosen && (
            <button
              onClick={() => navigate(-1)}
              className="w-full mt-3 min-h-[44px] text-sm text-slate-400"
            >
              取消，返回设置
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-400 text-center mt-4 leading-5">
          移动端当前只提供学生端（个人端）功能；管理端请在电脑浏览器打开 Web 版。
        </p>
      </div>
    </div>
  );
}
