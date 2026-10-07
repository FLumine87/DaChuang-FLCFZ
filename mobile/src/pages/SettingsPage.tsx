import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Loader2, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { Banner, Card, ListRow, PrimaryButton, SectionTitle } from '../components/ui';
import {
  DEFAULT_LIVE_BASE,
  getBase,
  getMode,
  isValidBase,
  resetModeChoice,
  setBase,
  testConnection,
} from '../platform/mode';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [mode, setModeState] = useState(getMode());
  const [base, setBaseInput] = useState(getBase() || DEFAULT_LIVE_BASE);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const saveBase = () => {
    setBase(base.trim());
    setSaved(true);
    setResult(null);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    const res = await testConnection(base);
    setResult(res);
    setTesting(false);
  };

  const clearAll = () => {
    const keys = [
      'psych_token_persistent',
      'psych_token_temp',
      'psych_prototype_accounts',
      'psych_runtime_mode',
      'psych_runtime_api_base',
      'psych_mode_chosen',
    ];
    try {
      keys.forEach((k) => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch {
      /* 忽略 */
    }
    resetModeChoice();
    navigate('/mode', { replace: true });
  };

  return (
    <div className="space-y-4">
      <div>
        <SectionTitle title="体验模式" />
        <Card className="divide-y divide-slate-100 overflow-hidden">
          <ListRow
            icon={<Database className="w-5 h-5 text-slate-400" />}
            title="当前模式"
            subtitle={mode === 'mock' ? '离线演示（内置示例数据，断网可用）' : '连接实机（真实后端）'}
            right={
              <button
                onClick={() => navigate('/mode')}
                className="text-[13px] text-primary-600 font-medium px-2 py-2"
              >
                切换
              </button>
            }
          />
        </Card>
      </div>

      <div>
        <SectionTitle title="后端地址（实机模式）" />
        <Card className="p-4 space-y-3">
          <input
            value={base}
            onChange={(e) => {
              setBaseInput(e.target.value);
              setSaved(false);
              setResult(null);
            }}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={DEFAULT_LIVE_BASE}
            className="w-full px-3 py-3 rounded-xl border border-slate-200 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void handleTest()}
              disabled={testing || !isValidBase(base)}
              className="flex-1 min-h-[44px] rounded-xl border border-emerald-500 text-emerald-600 text-sm font-medium active:bg-emerald-50 disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {testing ? '测试中…' : '测试连接'}
            </button>
            <button
              onClick={saveBase}
              disabled={!isValidBase(base)}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-800 text-white text-sm font-medium active:bg-slate-700 disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              保存地址
            </button>
          </div>
          {saved && <Banner kind="success">地址已保存，实机模式下立即生效</Banner>}
          {result && <Banner kind={result.ok ? 'success' : 'error'}>{result.message}</Banner>}
          <p className="text-[11px] text-slate-400 leading-5">
            提示：Cloudflare 的 <span className="font-mono">workers.dev</span> 域名在中国大陆无法直连，
            手机需科学上网；也可改填自建/代理地址。
          </p>
        </Card>
      </div>

      <div>
        <SectionTitle title="本地数据" />
        <Card className="divide-y divide-slate-100 overflow-hidden">
          <ListRow
            icon={<Trash2 className="w-5 h-5 text-danger-500" />}
            title="清除本地数据并重新选择模式"
            subtitle="登录状态、模式与地址配置会被清空"
            right={<span className="text-[13px] text-danger-600 px-2">清除</span>}
            onClick={clearAll}
          />
        </Card>
      </div>

      <div>
        <SectionTitle title="关于" />
        <Card className="p-4 space-y-1.5">
          <p className="text-[13px] text-slate-600">心理守护 · 移动端 v1.0.0</p>
          <p className="text-[12px] text-slate-400 leading-5">
            Project DC（基于动态跨模态哈希检索和 RAG 的心理筛查预警系统）
            的学生端移动应用。以 Web 端为基准构建，复用其数据层。
          </p>
          <p className="text-[12px] text-slate-400 leading-5">
            移动端仅提供学生端功能；管理端请使用 Web 版。
          </p>
        </Card>
      </div>

      <PrimaryButton onClick={() => navigate(-1)} className="!bg-slate-100 !text-slate-700">
        返回
      </PrimaryButton>
    </div>
  );
}
