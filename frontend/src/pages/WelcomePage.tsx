import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  HeartPulse,
  Lock,
  Moon,
  Smile,
  type LucideIcon,
} from "lucide-react";
import { navigateWithTransition } from "../utils/viewTransition";
import {
  getFirstRunState,
  markGuideSeen,
  markGuideStarted,
  startDraft,
} from "../services/firstRun";
import FirstRunShell from "./first/FirstRunShell";

/**
 * WelcomePage.tsx · 个人端首次登录的欢迎页（/personal/welcome）
 *
 * 只在**个人账号第一次登录**时出现一次，管理员端没有这个流程。三件事：
 *   1. 说明这次筛查是干什么的、大概要多久（不把问卷直接弹到用户脸上）；
 *   2. 让用户从情绪 / 焦虑 / 睡眠 / 压力里**挑一个**方向，不必四份都做完；
 *   3. 给一条"以后再说"的退路 —— 点了就直接进主页，不再反复出现。
 *
 * 「看过就不再出现」这件事记在账号上（见 services/firstRun.ts），
 * 不是靠"有没有筛查记录"判断：跳过的人没有记录，也不该每次登录都被拦一次。
 * 从主页的空状态点进来时本来就已经看过了，所以这里不做任何"首次"判断，
 * 页面本身是幂等的，随时当"选量表"页用。
 *
 * 外壳（顶栏 / 左栏叙事 / 背景图形 / 分级渐入）与后面三步向导共用
 * pages/first/FirstRunShell.tsx，四屏视觉因此天然一致。
 */

/* 四个方向和仓库里已有的四份量表一一对应（见 data/questionnaireData.ts）。
   一份量表 2~4 分钟，所以页面上写"约 2–4 分钟"。 */
interface ScaleOption {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const SCALES: ScaleOption[] = [
  { id: "PHQ-9", label: "情绪状态", hint: "低落、兴趣与精力", icon: Smile },
  { id: "GAD-7", label: "焦虑感受", hint: "紧张、担心与不安", icon: HeartPulse },
  { id: "ISI", label: "睡眠情况", hint: "入睡、易醒与早醒", icon: Moon },
  { id: "PSS-10", label: "近期压力", hint: "学习与生活压力", icon: BarChart3 },
];

export default function WelcomePage() {
  const navigate = useNavigate();
  /* 中途退出的用户再进来时，默认选中他上次挑的那份量表 */
  const [scaleId, setScaleId] = useState<string>(
    () => getFirstRunState().scaleId ?? SCALES[0].id,
  );

  const selected = SCALES.find((item) => item.id === scaleId) ?? SCALES[0];

  /* 开始首次筛查：记状态 + 落一份草稿，然后进 01 逐题作答。
     草稿放在 sessionStorage 里，02/03 两个步骤据此取量表与分数。 */
  const start = () => {
    markGuideStarted(selected.id);
    startDraft(selected.id);
    navigateWithTransition(
      navigate,
      `/personal/first/questionnaire?scale=${encodeURIComponent(selected.id)}`,
    );
  };

  /* 先进入主页：同样算"处理过引导"。用户没有记录，但下次登录不会再看到欢迎页，
     首页会给一个随时可用的入口。 */
  const skip = () => {
    markGuideSeen();
    navigateWithTransition(navigate, "/personal/dashboard");
  };

  return (
    <FirstRunShell
      eyebrow="第一次来到这里"
      title={
        <>
          先花几分钟，
          <br />
          了解此刻的自己。
        </>
      }
      body={
        <>
          选择一个你最关心的方向，完成一次简短筛查。
          <br />
          结果会保存在你的个人主页，之后也可以随时再做。
        </>
      }
      bullets={[
        "按自己的节奏作答",
        "约 2–4 分钟",
        "结果仅供自我了解，不构成诊断",
      ]}
    >
      <div className="mx-auto w-full max-w-[460px] rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)] sm:p-7">
        <p className="text-[13px] font-medium tracking-[0.16em] text-primary-500">
          FIRST STEP
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">
          从一次简单的筛查开始
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          先选择你想了解的方向，暂时不用一次完成所有量表。
        </p>

        <div
          data-fade-tiles
          className="mt-5 grid grid-cols-2 gap-3"
          role="radiogroup"
          aria-label="选择想了解的方向"
        >
          {SCALES.map((item) => {
            const active = item.id === selected.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setScaleId(item.id)}
                className={`flex min-h-[92px] flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all duration-200 ${
                  active
                    ? "border-primary-500 bg-primary-50/70 text-primary-700 shadow-[0_10px_30px_-18px_rgba(70,95,255,0.55)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-primary-200 hover:bg-primary-50/40"
                }`}
              >
                <item.icon
                  className={`h-6 w-6 ${active ? "text-primary-600" : "text-slate-400"}`}
                  strokeWidth={1.7}
                />
                <span className="text-sm font-medium">{item.label}</span>
                <span
                  className={`text-[12px] leading-5 ${active ? "text-primary-600/80" : "text-slate-400"}`}
                >
                  {item.hint}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={start}
          className="ui-button ui-button-primary mt-5 h-12 w-full rounded-xl"
        >
          开始首次筛查
        </button>
        <button
          type="button"
          onClick={skip}
          className="mt-3 h-12 w-full rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 transition-colors hover:border-primary-200 hover:text-primary-600"
        >
          先进入主页，稍后再做
        </button>

        <p className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-[13px] leading-5 text-slate-500">
          <Lock className="h-4 w-4 shrink-0" />
          你可以随时在个人主页重新开始。
        </p>
      </div>
    </FirstRunShell>
  );
}
