import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock, User } from 'lucide-react';
import { apiLogin, apiRegister } from '@shared/services/mockApi';
import { saveSessionToken } from '@shared/auth/session';
import { Banner, PrimaryButton } from '../components/ui';
import { MOCK_ACCOUNTS, getMode } from '../platform/mode';

type Tab = 'login' | 'register';

export default function AuthPage() {
  const navigate = useNavigate();
  const mockMode = getMode() === 'mock';

  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    setOkMsg('');
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    try {
      if (tab === 'login') {
        const res = await apiLogin(username.trim(), password, remember);
        if (!res.ok || !res.token) {
          setError(res.message || '登录失败');
          return;
        }
        saveSessionToken(res.token, remember);
        navigate('/app/dashboard', { replace: true });
      } else {
        if (password !== confirm) {
          setError('两次输入的密码不一致');
          return;
        }
        const res = await apiRegister(username.trim(), password, name.trim());
        if (!res.ok) {
          setError(res.message || '注册失败');
          return;
        }
        setOkMsg('注册成功，请返回登录');
        setTab('login');
        setConfirm('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-emerald-600 to-emerald-500 flex flex-col">
      <div className="pt-safe" />
      <div className="px-6 pt-12 pb-8 text-white">
        <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-4 text-2xl">
          🧠
        </div>
        <h1 className="text-2xl font-bold">心理守护</h1>
        <p className="text-sm text-white/80 mt-1">
          {mockMode ? '离线演示模式 · 数据全部为内置示例' : '已连接实机后端 · 数据来自服务器'}
        </p>
      </div>

      <div className="flex-1 bg-slate-50 rounded-t-3xl px-4 pt-5 pb-safe overflow-y-auto">
        <div className="flex bg-white rounded-xl p-1 mb-4 border border-slate-200">
          {(['login', 'register'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError('');
                setOkMsg('');
              }}
              className={`flex-1 min-h-[40px] rounded-lg text-sm transition-colors ${
                tab === t ? 'bg-emerald-600 text-white font-medium' : 'text-slate-500'
              }`}
            >
              {t === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-slate-500 mb-1.5 block">用户名</span>
            <div className="flex items-center gap-2 px-3 rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-emerald-500">
              <User className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="flex-1 min-h-[46px] bg-transparent text-[15px] focus:outline-none"
                placeholder="请输入用户名"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500 mb-1.5 block">密码</span>
            <div className="flex items-center gap-2 px-3 rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-emerald-500">
              <Lock className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && tab === 'login' && void submit()}
                className="flex-1 min-h-[46px] bg-transparent text-[15px] focus:outline-none"
                placeholder="请输入密码"
              />
            </div>
          </label>

          {tab === 'register' && (
            <>
              <label className="block">
                <span className="text-xs text-slate-500 mb-1.5 block">确认密码</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full min-h-[46px] px-3 rounded-xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="请再次输入密码"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500 mb-1.5 block">姓名（可选）</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[46px] px-3 rounded-xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="用于报告展示"
                />
              </label>
            </>
          )}

          {tab === 'login' && (
            <label className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 accent-emerald-600"
              />
              <span className="text-[13px] text-slate-500">记住我（保持登录状态）</span>
            </label>
          )}

          {error && <Banner kind="error">{error}</Banner>}
          {okMsg && <Banner kind="success">{okMsg}</Banner>}

          <PrimaryButton
            onClick={() => void submit()}
            disabled={loading}
            className="!bg-emerald-600 !active:bg-emerald-700"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                处理中…
              </span>
            ) : tab === 'login' ? (
              '登录'
            ) : (
              '注册'
            )}
          </PrimaryButton>
        </div>

        {mockMode && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-[13px] font-medium text-emerald-700 mb-2">离线演示账号</p>
            <div className="space-y-1.5">
              {MOCK_ACCOUNTS.map((a) => (
                <button
                  key={a.username}
                  onClick={() => {
                    setTab('login');
                    setUsername(a.username);
                    setPassword(a.password);
                  }}
                  className="w-full flex items-center justify-between text-[12px] text-emerald-700 active:opacity-60"
                >
                  <span>
                    {a.username} / {a.password}
                  </span>
                  <span className="text-emerald-500">点击填入</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => navigate('/mode')}
          className="w-full mt-4 min-h-[44px] text-[13px] text-slate-400"
        >
          切换体验模式（离线演示 / 连接实机）
        </button>
      </div>
    </div>
  );
}
