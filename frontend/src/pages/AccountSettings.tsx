import { useEffect, useRef, useState } from 'react';
import StewardPanel from '../components/StewardPanel';
import {
  AtSign,
  BrainCircuit,
  Building2,
  Camera,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Phone,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import {
  changeMyPassword,
  getMyAccount,
  updateMyAccount,
  updateMyAvatar,
  type MyAccount,
} from '../services/mockApi';
import { USE_MOCK } from '../services/http';
import {
  loadModelSettings,
  saveModelSettings,
} from '../services/workspaceApi';
import {
  readIncludeOriginalInput,
  readSaveToSystem,
  writeIncludeOriginalInput,
  writeSaveToSystem,
} from '../services/retrievalPreferences';

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

/** 把用户选的图片裁成 256×256 正方形并压成 JPEG data URL，避免把大图写进数据库。 */
function readAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('图片不能超过 5MB'));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (!image.width || !image.height) {
        URL.revokeObjectURL(url);
        reject(new Error('图片尺寸无效'));
        return;
      }
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('浏览器不支持图片处理'));
        return;
      }
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    image.src = url;
  });
}

export default function AccountSettings() {
  const edited=useRef(new Set<string>());
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

  // 头像（data URL，后端存 users.avatar）
  const [avatar, setAvatar] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // 密码
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 检索与分析偏好（只存本机，改动即时生效）
  const [includeOriginalInput, setIncludeOriginalInput] = useState(readIncludeOriginalInput);
  const [saveToSystem, setSaveToSystem] = useState(readSaveToSystem);

  // 智能研判模型（仅管理端；开关存后端，默认开启）
  const [modelOn, setModelOn] = useState(true);
  const [modelConfigured, setModelConfigured] = useState(true);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelMsg, setModelMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const isAdmin = account?.role === 'admin';

  useEffect(() => {
    if (!isAdmin || USE_MOCK) return;
    let alive = true;
    loadModelSettings()
      .then((state) => {
        if (!alive) return;
        setModelOn(state.enabled);
        setModelConfigured(state.configured);
      })
      .catch(() => {
        if (alive) setModelMsg({ kind: 'err', text: '模型开关读取失败，当前显示默认值' });
      });
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const toggleModel = async (next: boolean) => {
    setModelSaving(true);
    setModelMsg(null);
    try {
      const state = await saveModelSettings(next);
      setModelOn(state.enabled);
      setModelConfigured(state.configured);
      setModelMsg({
        kind: 'ok',
        text: state.enabled ? '模型已开启' : '模型已关闭，个案与群体研判只走规则',
      });
    } catch (e) {
      setModelMsg({ kind: 'err', text: e instanceof Error ? e.message : '保存失败' });
    } finally {
      setModelSaving(false);
    }
  };

  const toggleIncludeOriginalInput = (enabled: boolean) => {
    setIncludeOriginalInput(enabled);
    writeIncludeOriginalInput(enabled);
  };

  const toggleSaveToSystem = (enabled: boolean) => {
    setSaveToSystem(enabled);
    writeSaveToSystem(enabled);
  };

  useEffect(() => {
    let alive = true;
    getMyAccount()
      .then((acc) => {
        if (!alive) return;
        setAccount(acc);
        if (acc) {
          if (!edited.current.has('name')) setName(acc.name);
          if (!edited.current.has('department')) setDepartment(acc.department);
          if (!edited.current.has('phone')) setPhone(acc.phone);
          if (!edited.current.has('email')) setEmail(acc.email);
          setAvatar(acc.avatar || '');
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

  const handleAvatarFile = async (file: File | null) => {
    if (!file) return;
    setAvatarBusy(true);
    setAvatarMsg(null);
    try {
      const dataUrl = await readAvatarDataUrl(file);
      const acc = await updateMyAvatar(dataUrl);
      if (acc) setAccount(acc);
      setAvatar(dataUrl);
      setAvatarMsg({ kind: 'ok', text: '头像已更新' });
      window.dispatchEvent(new CustomEvent('account-avatar-updated', { detail: dataUrl }));
    } catch (e) {
      setAvatarMsg({ kind: 'err', text: e instanceof Error ? e.message : '头像更新失败' });
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarBusy(true);
    setAvatarMsg(null);
    try {
      const acc = await updateMyAvatar('');
      if (acc) setAccount(acc);
      setAvatar('');
      setAvatarMsg({ kind: 'ok', text: '头像已移除' });
      window.dispatchEvent(new CustomEvent('account-avatar-updated', { detail: '' }));
    } catch (e) {
      setAvatarMsg({ kind: 'err', text: e instanceof Error ? e.message : '移除失败' });
    } finally {
      setAvatarBusy(false);
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

      {/* 智能研判模型：仅管理端可见，开关存后端（默认开启） */}
      {isAdmin && (
        <section className="ui-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            <BrainCircuit className="h-4 w-4 text-primary-600" />
            智能研判模型
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-400">
            控制管理端「预警研判与处置」的 AI 辅助分析（个案 + 群体）。启用后会把问卷历史与
            多模态材料摘要发送给 DeepSeek；发送前去除姓名、电话、学号与案例编号。
          </p>

          <div className="mt-4 flex items-start justify-between gap-4 border-t border-slate-100 pt-4">
            <div>
              <span className="block text-[13.5px] font-medium text-slate-700">
                启用管理端 AI 辅助研判
              </span>
              <span className="mt-1 block text-[12px] leading-5 text-slate-400">
                默认开启。关闭后个案与群体研判只用规则生成，页面不再显示 AI 分析。
                {!modelConfigured &&
                  ' 后端未配置 DEEPSEEK_API_KEY，开启也会降级为规则研判。'}
                {USE_MOCK && ' 当前为演示模式，开关需连接后端后生效。'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={modelOn}
              aria-label="启用管理端 AI 辅助研判"
              disabled={modelSaving || USE_MOCK}
              onClick={() => void toggleModel(!modelOn)}
              className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                modelOn ? 'bg-primary-500' : 'bg-slate-300'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  modelOn ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          {modelMsg && (
            <p
              className={`mt-2 text-[12px] ${
                modelMsg.kind === 'ok' ? 'text-success-600' : 'text-danger-600'
              }`}
            >
              {modelMsg.text}
            </p>
          )}
        </section>
      )}

      {/* 个人信息 */}
      <section className="ui-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
          <UserRound className="h-4 w-4 text-primary-600" />
          个人信息
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-400">
          姓名会显示在首页问候与个案档案里。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-xl font-semibold text-primary-600">
            {avatar ? (
              <img src={avatar} alt="当前头像" className="h-full w-full object-cover" />
            ) : (
              (name || account?.username || '我').slice(0, 1).toUpperCase()
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-slate-700">头像</p>
            <p className="mt-0.5 text-[11.5px] leading-5 text-slate-400">
              支持 JPG、PNG、WEBP，自动裁成正方形并压缩，最大 5MB。
            </p>
            {avatarMsg && (
              <p className={`mt-1 text-[12px] ${avatarMsg.kind === 'ok' ? 'text-success-600' : 'text-danger-600'}`}>
                {avatarMsg.text}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleAvatarFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              {avatarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              更换头像
            </button>
            {avatar && (
              <button
                type="button"
                onClick={() => void handleRemoveAvatar()}
                disabled={avatarBusy}
                className="rounded-lg px-2.5 py-2 text-[12.5px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-danger-600 disabled:opacity-60"
              >
                移除
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[12px] text-slate-500">
              <UserRound className="h-3 w-3" /> 姓名
            </span>
            <input
              value={name}
              onChange={(e) => { edited.current.add('name'); setName(e.target.value); }}
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
              onChange={(e) => { edited.current.add('department'); setDepartment(e.target.value); }}
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
              onChange={(e) => { edited.current.add('phone'); setPhone(e.target.value); }}
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
              onChange={(e) => { edited.current.add('email'); setEmail(e.target.value); }}
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
      {/* 检索与分析偏好：原在「心理筛查 · 检索与分析」页，统一收到设置页 */}
      <section className="ui-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
          <SlidersHorizontal className="h-4 w-4 text-primary-600" />
          AI 与分析偏好
        </h2>
        <h3 className="mt-5 text-sm font-medium text-slate-800">检索与分析偏好</h3>
        <p className="mt-1 text-[12.5px] text-slate-400">
          只影响个人端「心理筛查 · 检索与分析」页面的行为，设置保存在当前浏览器。
        </p>

        <div className="mt-4 space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={includeOriginalInput}
              onChange={(e) => toggleIncludeOriginalInput(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-500"
            />
            <span>
              <span className="block text-[13.5px] font-medium text-slate-700">结合本次原始输入分析</span>
              <span className="mt-1 block text-[12px] leading-5 text-slate-400">
                默认开启，报告结合原始文字与检索筛查结果；关闭后只依据检索结果。当前大模型不直接解读原始图片或语音。
                修改后对之后发起的检索分析生效。
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 border-t border-slate-100 pt-4">
            <input
              type="checkbox"
              checked={saveToSystem}
              onChange={(e) => toggleSaveToSystem(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-500"
            />
            <span>
              <span className="block text-[13.5px] font-medium text-slate-700">送入检索数据</span>
              <span className="mt-1 block text-[12px] leading-5 text-slate-400">
                默认开启。本次检索会作为一条记录存入系统，首页「最近一次输入」、我的档案与管理端都能看到；
                不想留痕就取消勾选。
              </span>
            </span>
          </label>
        </div>
        <div className="mt-6 border-t border-slate-100 pt-5">
          <StewardPanel mode="settings" />
        </div>
      </section>

    </div>
  );
}
