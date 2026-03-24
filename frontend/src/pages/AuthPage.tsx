import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck, UserRound, UserPlus } from 'lucide-react';
import { login, register } from '../auth/mockAuth';

type AuthTab = 'login' | 'register';

export default function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<AuthTab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const getPasswordStrength = (value: string): { label: '弱' | '中' | '强'; color: string; score: number } => {
    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;

    if (score <= 1) return { label: '弱', color: 'text-danger-600', score: 1 };
    if (score <= 3) return { label: '中', color: 'text-warning-600', score: 2 };
    return { label: '强', color: 'text-success-600', score: 3 };
  };

  const strength = getPasswordStrength(password);

  const resetTips = () => {
    setMessage('');
    setError('');
  };

  const handleLogin = () => {
    resetTips();
    const result = login(username, password, rememberMe);
    if (!result.ok) {
      setError(result.message || '登录失败');
      return;
    }

    setMessage('登录成功，正在跳转...');
    navigate(result.role === 'admin' ? '/admin/dashboard' : '/personal/dashboard', { replace: true });
  };

  const handleRegister = () => {
    resetTips();
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    const result = register(username, password);
    if (!result.ok) {
      setError(result.message || '注册失败');
      return;
    }

    setMessage('注册成功，请使用新账号登录（新账号默认进入个人端）');
    setTab('login');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 flex items-center justify-center">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-8 backdrop-blur">
          <p className="inline-flex items-center gap-2 text-xs text-indigo-200 bg-indigo-600/25 px-3 py-1 rounded-full">
            <Lock className="w-3.5 h-3.5" />
            统一登录入口
          </p>
          <h1 className="text-3xl font-bold text-white mt-5">心理筛查预警系统</h1>
          <p className="text-slate-300 mt-3 leading-7">
            支持管理端与个人端双系统。使用管理账号 <code>adminer/admin</code> 登录将进入管理系统，
            其他账号将进入个人系统。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
            <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
              <ShieldCheck className="w-5 h-5 text-cyan-300" />
              <p className="text-sm font-semibold text-white mt-2">管理端</p>
              <p className="text-xs text-slate-300 mt-1">筛查管理、预警处置、案例跟踪、分析报告</p>
            </div>
            <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
              <UserRound className="w-5 h-5 text-emerald-300" />
              <p className="text-sm font-semibold text-white mt-2">个人端</p>
              <p className="text-xs text-slate-300 mt-1">自助筛查、多模态采集、RAG 建议、档案管理</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="inline-flex bg-slate-100 rounded-lg p-1 mb-6">
            <button
              onClick={() => {
                setTab('login');
                resetTips();
              }}
              className={`px-4 py-2 text-sm rounded-md font-medium transition-colors cursor-pointer ${
                tab === 'login' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => {
                setTab('register');
                resetTips();
              }}
              className={`px-4 py-2 text-sm rounded-md font-medium transition-colors cursor-pointer ${
                tab === 'register' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              注册
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-600">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="text-sm text-slate-600">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {tab === 'register' && (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-slate-600">密码强度</label>
                    <span className={`text-sm font-medium ${password ? strength.color : 'text-slate-400'}`}>
                      {password ? strength.label : '-'}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        strength.score === 1
                          ? 'w-1/3 bg-danger-500'
                          : strength.score === 2
                            ? 'w-2/3 bg-warning-500'
                            : 'w-full bg-success-500'
                      }`}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">建议使用 8 位以上，包含大小写字母、数字和特殊符号。</p>
                </div>

                <div>
                  <label className="text-sm text-slate-600">确认密码</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="请再次输入密码"
                    className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}

            {tab === 'login' && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                记住我（下次免登录）
              </label>
            )}

            {error && <p className="text-sm text-danger-600">{error}</p>}
            {message && <p className="text-sm text-success-600">{message}</p>}

            {tab === 'login' ? (
              <button
                onClick={handleLogin}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                登录
              </button>
            ) : (
              <button
                onClick={handleRegister}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-900 text-sm font-medium transition-colors cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                注册账号
              </button>
            )}
          </div>

          <p className="text-xs text-slate-400 mt-5 leading-5">
            规则：仅 <code>adminer/admin</code> 进入管理端；其余账号（包括注册账号）均进入个人端。
          </p>
        </div>
      </div>
    </div>
  );
}
