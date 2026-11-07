import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Moon, Sun } from "lucide-react";
import Aurora from "../../components/Aurora";
import BrandLogo from "../../components/BrandLogo";
import { useFirstRunTheme } from "./useFirstRunTheme";
import { stepLabel, type FirstRunStep } from "./firstRunSteps";

/**
 * FirstRunShell.tsx · 首次引导四个页面（欢迎页 + 三步向导）共用的外壳
 *
 * 四张效果图的顶栏、左侧叙事栏、背景图形是同一套，所以抽到这里：
 *   · 顶栏：品牌 ｜ 健康管理平台 ｜ 当前步骤（与登录页/主页同一结构）
 *   · 左栏：眉标 + 大标题 + 正文 + 步骤进度（或要点列表）
 *   · 背景：与登录页/主页首屏同一套蓝白 / 蓝紫（Aurora · calm），不再叠轨道与网格
 *   · 入场：只有欢迎页播整页渐入；02–04 保持外壳稳定，只让题目/卡片轻微变化
 *
 * 右栏内容（卡片）由各步骤自己传进来。
 */

export default function FirstRunShell({
  step,
  eyebrow,
  title,
  body,
  steps,
  bullets,
  afterBody,
  children,
  wide = false,
  alignTop = false,
  stretch = false,
  compact = false,
}: {
  /** 2/3/4 显示「首次筛查 · n/4」；欢迎页不传，显示「首次使用」 */
  step?: 2 | 3 | 4;
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
  /** 左侧步骤进度（三步向导用） */
  steps?: FirstRunStep[];
  /** 左侧要点列表（欢迎页 / 02 用），与 steps 二选一 */
  bullets?: string[];
  /** 正文之后、步骤之前的内容（01c 里第 9 题的支持卡就放这里） */
  afterBody?: ReactNode;
  children: ReactNode;
  /** 右侧内容较宽（03 结果页的报告卡）时用 wide */
  wide?: boolean;
  /** 左栏与右侧顶部对齐（03：避免"左边偏低、右边偏高"） */
  alignTop?: boolean;
  /** 01 正式答题：左侧大标题降一档，让右侧题目成为主要阅读对象 */
  compact?: boolean;
  /** 右侧卡片撑满整行高度（03 结果页）。
      卡片高度原本跟着 tab 内容变：选「结果摘要」「后续建议」时内容短，
      卡片就显矮、看着往上飘；选「分析依据」撑满了才不飘。
      撑满 + 底部按钮吸底之后，切 tab 时卡片外框完全不动。 */
  stretch?: boolean;
}) {
  const { theme, toggleTheme } = useFirstRunTheme();
  const [mounted, setMounted] = useState(false);
  /* 02–04 的标题统一收一档：正式流程里右侧题目/卡片才是主角，
     60px 大标题在「多一条线索，由你决定分享多少。」这种长句上还会折出孤字。
     欢迎页保持大字，作为整条入口的起始画面。 */
  const tight = compact || Boolean(step);

  /* 只有欢迎页播整页渐入：首帧就是终态的话动画不会播，所以用 rAF 推到下一帧。
     02–04 正式流程不再整页重播 —— 换一步就重开一次页面会打断"同一份问卷"的连续感，
     换题只由题目自身的 question-enter 做轻微过渡。 */
  useEffect(() => {
    if (step) return;
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, [step]);

  return (
    <div
      className={`page-enter auth-snap first-run min-h-screen bg-page text-slate-800 ${
        mounted && !step ? "welcome-in" : ""
      }`}
    >
      <header className="nav-blur sticky top-0 z-40 px-6 sm:px-10 lg:px-12 xl:px-16">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo showSubtitle={false} />
            <span className="hidden whitespace-nowrap text-[15px] font-medium text-primary-600 sm:inline">
              健康管理平台
            </span>
            {/* 欢迎页只在品牌区写一次「首次使用」；02–04 的进度在桌面端放右侧，
                这里只在手机（右侧进度被隐藏）补一个「首次筛查」，避免顶栏失去页名。 */}
            {!step ? (
              <>
                <span
                  aria-hidden="true"
                  className="hidden h-5 w-px bg-slate-300/80 sm:block"
                />
                <span className="whitespace-nowrap text-[15px] font-medium text-slate-700">
                  首次使用
                </span>
              </>
            ) : (
              <span className="whitespace-nowrap text-[15px] font-medium text-slate-700 sm:hidden">
                首次筛查
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* 欢迎页的品牌区已经写了「首次使用」，右侧不再重复一次 */}
            {step && (
              <span className="mr-1 hidden whitespace-nowrap text-sm font-medium text-slate-500 sm:inline">
                {stepLabel(step)}
              </span>
            )}
            <Link
              to="/"
              className="hidden px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors duration-200 hover:text-primary-600 sm:inline"
            >
              返回主页
            </Link>
            <button
              type="button"
              className="group grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-all duration-200 hover:bg-white/80 hover:text-primary-700 active:scale-90 active:bg-white"
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              title={theme === "dark" ? "浅色模式" : "深色模式"}
              onClick={toggleTheme}
            >
              <span className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-[120deg] group-active:rotate-180">
                {theme === "dark" ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </span>
            </button>
          </div>
        </div>
      </header>

      <section className="relative flex items-center overflow-hidden px-6 py-10 sm:px-10 lg:min-h-[calc(100svh-4rem)] lg:px-12 xl:px-16">
        {/* 与登录页、主页首屏同一套蓝白 / 蓝紫背景：
            欢迎页沿用缓慢漂移；02–04 正式流程改为静止，阅读区不跟着动。 */}
        <Aurora variant="calm" still={Boolean(step)} />

        <div
          className={`relative z-10 mx-auto grid w-full gap-12 lg:justify-center lg:gap-[64px] ${
            alignTop ? "items-start" : "items-center lg:pb-24"
          } ${stretch ? "lg:items-stretch" : ""} ${
            wide
              ? /* 宽版（01 第 9 题、03 结果）：左栏仍要放得下 60px 的标题，
                   否则"接下来有方向。"会断成"接下来有方 / 向。"——与题干那处
                   是同一类问题。剩余宽度全给右侧的双栏内容。 */
                "max-w-[1440px] lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,600px)_minmax(0,1fr)]"
              : /* 620px 而不是 560px：60px 的标题一行放 9 个汉字约需 542px，
                   560px 时"也由你决定分享多少。"会被拆成"…分享多 / 少。"，
                   留一个孤字在第三行（与题干那处是同一类折行问题）。 */
                "max-w-[1440px] lg:grid-cols-[minmax(0,620px)_minmax(0,520px)] 2xl:grid-cols-[minmax(0,680px)_minmax(0,560px)]"
          }`}
        >
          {/* 左：叙事栏 */}
          <div data-fade>
            <p className="text-base font-semibold tracking-[0.2em] text-primary-500">
              {eyebrow}
            </p>
            <h1
              className={
                tight
                  ? "mt-6 max-w-[560px] text-[36px] font-medium leading-[1.3] tracking-tight text-slate-900"
                  : "auth-section-title mt-6 max-w-[720px] text-slate-900"
              }
            >
              {title}
            </h1>
            {body && (
              <p
                className={
                  tight
                    ? "mt-6 max-w-[520px] text-[17px] leading-8 text-slate-600"
                    : "mt-8 max-w-[600px] text-[18px] leading-9 text-slate-600 sm:text-[20px] sm:leading-[2.1]"
                }
              >
                {body}
              </p>
            )}

            {afterBody}

            {bullets && (
              <ul className="mt-7 grid gap-2.5 border-t border-dashed border-slate-200 pt-6">
                {bullets.map((point) => (
                  <li
                    key={point}
                    className="flex items-center gap-2.5 text-[15px] leading-6 text-slate-600"
                  >
                    <Check className="h-4 w-4 shrink-0 text-success-600" />
                    {point}
                  </li>
                ))}
              </ul>
            )}

            {steps && <StepProgress steps={steps} />}
          </div>

          {/* 右：卡片 —— stretch 时让它撑满整行，且内部变成纵向 flex，
              这样卡片里的底部操作条可以用 mt-auto 吸底。
              lg:mt-14 把卡片整体下压：左栏是「眉标 + 大标题」，卡片默认
              与眉标齐平，看上去比大标题高出一头；压 56px 后卡片顶边
              与大标题字顶齐平（实测 517 vs 518）。 */}
          <div
            className={`relative z-10 w-full ${
              stretch
                ? /* h-full → h-auto：原来卡片被拉到整行高（实测 702px），
                     而"结果摘要"这类面板内容只到 ~640px，中间就空出一大块
                     （用户反馈"右边的表格周围空"）。改成让卡片随内容高、
                     只在超过 720px 时封顶 —— 内容短就没有洞，内容长仍由
                     max-h 兜住并由内部 ScrollArea 滚动，切 tab 不会把整页撑开。
                     mt-auto 吸底仍保留：内容长到触顶时底部操作条照样贴底。 */
                  "flex lg:mt-14 lg:[&>section]:h-auto lg:[&>section]:max-h-[720px] lg:[&>section]:flex-col"
                : ""
            }`}
          >
            {children}
          </div>
        </div>
      </section>
    </div>
  );
}

/** 左栏的步骤进度：✓ 已完成 / 2 进行中 / 3 下一步，竖线把它们串起来 */
function StepProgress({ steps }: { steps: FirstRunStep[] }) {
  return (
    <ol className="mt-9 grid gap-0">
      {steps.map((item, index) => {
        const active = item.state === "active";
        return (
          <li key={item.label} className="relative flex items-center gap-3.5 pb-5 last:pb-0">
            {/* 连接线：最后一项不画 */}
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-slate-200"
              />
            )}
            <span
              className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
                item.state === "done"
                  ? "bg-primary-500 text-white"
                  : active
                    ? "bg-primary-500 text-white ring-4 ring-primary-100"
                    : "border border-slate-200 bg-white text-slate-400"
              }`}
            >
              {item.state === "done" ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={`text-[15px] ${active ? "font-semibold text-slate-900" : "text-slate-600"}`}
            >
              {item.label}
            </span>
            {/* 状态紧挨着名称：拉到最右会读成两列，看不出它修饰的是哪一步 */}
            <span
              className={`text-[13px] ${active ? "text-primary-600" : "text-slate-400"}`}
            >
              {item.hint}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
