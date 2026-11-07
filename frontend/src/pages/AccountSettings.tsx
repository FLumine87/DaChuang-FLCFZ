import { useEffect, useState } from 'react';
import {
  AtSign,
  Building2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Phone,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  changeMyPassword,
  getMyAccount,
  updateMyAccount,
  type MyAccount,
} from '../services/mockApi';

/*
 * 账号设置（独立页面，不是弹窗）
 * ==========================
 * 从顶栏头像菜单进来，地址是 /personal/settings 或 /admin/settings。
 *
 * 做成整页而不是浮窗的原因：
 *   · 改密码要输入三个框，浮窗里局促，一失手点外面就关掉了；
 *   · 这里以后还要放更多东西（登录设备、通知偏好、隐私导出……），
 *     塞进浮窗只会越长越挤；
 *   · 整页有自己的地址，可以直接收藏/分享给"去设置页改一下"的人。
 *
 * 两件事：个人信息（姓名 / 院系 / 手机 / 邮箱）与修改密码（需验证当前密码）。
 * 用户名与角色只读 —— 涉及登录凭据与权限，不开放自改。
 */

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13.5px] text-slate-700 ' +
  'outline-none transition-colors placeholder:text-slate-300 focus:border-primary-400 ' +
  'disabled:bg-slate-50 disabled:text-slate-400';

export default function AccountSettings() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<MyAccount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 个人信息
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 密码
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getMyAccount()
      .then((acc) => {
        if (!alive) return;
        setAccount(acc);
        if (acc) {
          setName(acc.name);
          setDepartment(acc.department);
          setPhone(acc.phone);
          setEmail(acc.email);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : '读取账号信息失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const acc = await updateMyAccount({
        name: name.trim(),
        department: department.trim(),
        phone: phone.trim(),
        email: email.trim(),
      });
      if (acc) setAccount(acc);
      setProfileMsg({ kind: 'ok', text: '个人信息已保存' });
    } catch (e) {
      setProfileMsg({ kind: 'err', text: e instanceof Error ? e.message : '保存失败' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPwd !== confirmPwd) {
      setPwdMsg({ kind: 'err', text: '两次输入的新密码不一致' });
      return;
    }
    setSavingPwd(true);
    setPwdMsg(null);
    try {
      await changeMyPassword({ oldPassword: oldPwd, newPassword: newPwd });
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setPwdMsg({ kind: 'ok', text: '密码已修改，下次登录请使用新密码' });
    } catch (e) {
      setPwdMsg({ kind: 'err', text: e instanceof Error ? e.message : '修改密码失败' });
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 页头 */}
      <div>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold text-slate-900">
          <Settings className="h-5 w-5 text-primary-600" />
          账号设置
        </h1>
        <p className="mt-1.5 text-[13px] text-slate-500">
          改这里的信息只会影响你自己的账号，不会动到筛查记录与预警。
        </p>
      </div>

      {loadError && (
        <div className="ui-card border-danger-200 bg-danger-50 p-5 text-sm text-danger-700">
          读取失败：{loadError}
        </div>
      )}

      {/* 账号概览（只读） */}
      <section className="ui-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
          <ShieldCheck className="h-4 w-4 text-primary-600" />
          账号
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[12px] text-slate-400">用户名</dt>
            <dd className="mt-0.5 text-[13.5px] font-medium text-slate-700">
              {loading ? '—' : account?.username || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-slate-400">账号角色</dt>
            <dd className="mt-0.5 text-[13.5px] font-medium text-slate-700">
              {account?.role === 'admin' ? '管理员' : '个人用户'}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11.5px] leading-5 text-slate-400">
          用户名与角色由系统维护。它们是登录凭据与权限依据，不在这里开放修改。
        </p>
      </section>

      {/* 个人信息 */}
      <section className="ui-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
          <UserRound className="h-4 w-4 text-primary-600" />
          个人信息
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-400">
          姓名会显示在首页问候与个案档案里。
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[12px] text-slate-500">
              <UserRound className="h-3 w-3" /> 姓名
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              disabled={savingProfile || loading}
              placeholder="你的姓名"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[12px] text-slate-500">
              <Building2 className="h-3 w-3" /> 院系 / 部门
            </span>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              maxLength={100}
              disabled={savingProfile || loading}
              placeholder="如：外国语学院 大三"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[12px] text-slate-500">
              <Phone className="h-3 w-3" /> 手机号
            </span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={savingProfile || loading}
              placeholder="选填"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[12px] text-slate-500">
              <AtSign className="h-3 w-3" /> 邮箱
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={savingProfile || loading}
              placeholder="选填"
              className={inputCls}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-[11.5px] text-slate-400">手机与邮箱留空也没关系，填了会校验格式。</p>
          <div className="flex items-center gap-3">
            {profileMsg && (
              <span className={`text-[12.5px] ${profileMsg.kind === 'ok' ? 'text-success-600' : 'text-danger-600'}`}>
                {profileMsg.text}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSaveProfile()}
              disabled={savingProfile || loading || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-60"
            >
              {savingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {savingProfile ? '保存中…' : '保存个人信息'}
            </button>
          </div>
        </div>
      </section>

      {/* 修改密码 */}
      <section className="ui-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
          <KeyRound className="h-4 w-4 text-primary-600" />
          修改密码
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-400">
          需要先验证当前密码，避免别人拿到你的登录状态就能改密码。
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-slate-500">当前密码</span>
            <input
              type={showPwd ? 'text' : 'password'}
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              disabled={savingPwd}
              autoComplete="current-password"
              placeholder="现在使用的密码"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] text-slate-500">新密码</span>
            <input
              type={showPwd ? 'text' : 'password'}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              disabled={savingPwd}
              autoComplete="new-password"
              placeholder="至少 6 位"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] text-slate-500">确认新密码</span>
            <input
              type={showPwd ? 'text' : 'password'}
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              disabled={savingPwd}
              autoComplete="new-password"
              placeholder="再输入一次"
              className={inputCls}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-500">
            <input
              type="checkbox"
              checked={showPwd}
              onChange={(e) => setShowPwd(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            {showPwd ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            显示密码
          </label>

          <div className="flex items-center gap-3">
            {pwdMsg && (
              <span className={`text-[12.5px] ${pwdMsg.kind === 'ok' ? 'text-success-600' : 'text-danger-600'}`}>
                {pwdMsg.text}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleChangePassword()}
              disabled={savingPwd || !oldPwd || newPwd.length < 6 || !confirmPwd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-60"
            >
              {savingPwd ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              {savingPwd ? '提交中…' : '修改密码'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
