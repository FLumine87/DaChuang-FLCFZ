import { RefreshCw, ShieldQuestion } from 'lucide-react';

/*
 * 登录验证码输入框
 * ==============
 * 左边是四位数输入，右边是服务端画好的图（点图也能换一张）。
 * 演示账号会自动填好，所以这里会显示一行小字说明"已自动填充"，
 * 免得用户以为在填写自己看不懂的东西。
 */
interface Props {
  /** data URI；null 表示还在加载或加载失败 */
  imageSrc: string | null;
  code: string;
  onCodeChange: (value: string) => void;
  onRefresh: () => void;
  loading?: boolean;
  error?: string;
  /** 演示账号自动填充时给一句提示 */
  autoFilled?: boolean;
  length?: number;
}

export default function CaptchaField({
  imageSrc,
  code,
  onCodeChange,
  onRefresh,
  loading = false,
  error,
  autoFilled = false,
  length = 4,
}: Props) {
  return (
    <div>
      <label htmlFor="captcha" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <ShieldQuestion className="h-3.5 w-3.5 text-slate-400" />
        验证码
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id="captcha"
          autoComplete="off"
          inputMode="text"
          maxLength={length}
          value={code}
          onChange={(event) => onCodeChange(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          placeholder={`${length} 位字母`}
          aria-describedby="captcha-hint"
          className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm uppercase tracking-[0.35em] text-slate-800 placeholder:tracking-normal placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="看不清？换一张"
          aria-label="换一张验证码"
          className="relative grid h-12 w-[120px] shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-300 bg-slate-50 transition-colors hover:border-primary-300 disabled:opacity-60"
        >
          {imageSrc ? (
            <img src={imageSrc} alt="验证码图片" className="h-10 w-[112px] select-none" />
          ) : (
            <RefreshCw className={`h-4 w-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
          )}
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span id="captcha-hint" className="text-[12px] text-slate-400">
          {autoFilled ? (
            <span className="text-primary-600">演示账号已自动填写，可直接登录</span>
          ) : error ? (
            <span className="text-danger-600">{error}</span>
          ) : (
            '不区分大小写，看不清可点右侧换一张'
          )}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-[12px] text-slate-400 transition-colors hover:text-primary-600 disabled:opacity-60"
        >
          换一张
        </button>
      </div>
    </div>
  );
}
