import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { getConsentState, settleConsent, subscribeConsent } from '../services/consent';

/*
 * 同意弹窗宿主：挂在 App 顶层，全局唯一。
 * 提交类操作调用 services/consent 的 requestConsent() 就会弹出来，
 * 用户点「同意并提交」返回 true，「不同意，不提交」返回 false。
 */
export default function ConsentHost() {
  const [, bump] = useState(0);
  const navigate = useNavigate();

  useEffect(() => subscribeConsent(() => bump((n) => n + 1)), []);

  const state = getConsentState();
  if (!state.open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        /* 点遮罩 = 取消（不提交），比误点"同意"安全 */
        if (event.target === event.currentTarget) settleConsent(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="consent-title" className="text-[15px] font-semibold text-slate-900">
              提交前请确认
            </h2>
            <p className="mt-1 text-[12px] text-slate-400">个人信息的收集与使用</p>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5">
          {[
            '本次提交的内容会保存到你自己的档案，用于生成筛查结论与后续回顾。',
            '只有你同意后系统才会保存；不同意则本次内容不会上传。',
            '需要更细的收集范围、可见范围与删除方式，可查看隐私政策。',
          ].map((line, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-6 text-slate-600">
              <span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-5 text-slate-500">
          不想每次都被询问？可以在「账号设置 → 数据与隐私」开启
          <span className="font-medium text-slate-600">「提交时不再询问」</span>
          —— 开启后不再询问，也不会提交。
          <button
            type="button"
            onClick={() => {
              settleConsent(false);
              navigate('/personal/settings');
            }}
            className="ml-1 text-primary-600 underline hover:text-primary-700"
          >
            去设置
          </button>
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => settleConsent(false)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            不同意，不提交
          </button>
          <button
            type="button"
            onClick={() => settleConsent(true)}
            className="rounded-lg bg-primary-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-600"
          >
            同意并提交
          </button>
        </div>
      </section>
    </div>
  );
}
