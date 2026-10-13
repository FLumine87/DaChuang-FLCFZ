import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlarmClock,
  Anchor,
  BatteryLow,
  Brain,
  Gauge,
  LifeBuoy,
  MessageSquareText,
  Moon,
  Scale,
  Smile,
  Sunrise,
  Target,
  Waves,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { getScaleGuide, type ScaleFocusIcon } from "../../data/scaleGuide";

/**
 * ScaleIntroDialog.tsx · 「了解 XX」量表介绍弹窗
 *
 * 按图六的方案重写：这个弹窗只回答「这是什么」，不是操作教程。
 *   · 顶部小字「量表介绍」+ 主标题（中文名 + 量表定位），不再用英文大写眉标
 *   · 一句话说明它是什么
 *   · 「这份量表关注什么」：每项一枚同尺寸浅蓝线性图标 + 标题 + 灰蓝说明
 *   · 它如何帮助你 / 结果的边界（图七的结构）
 *   · 关闭方式只有一个：右上角 ×（另有 Esc 与点背景两处兜底）。
     原先底部还有一颗「返回当前题」，和 × 是同一个动作，两个出口反而让人犹豫。
 *
 * 刻意删掉了原来的「怎么作答」「结果如何使用」两块和那张占面积的「需要提前知道」卡：
 * 前者属于答题页顶部那条说明栏，后者是结果页的事。
 */

const FOCUS_ICONS: Record<ScaleFocusIcon, LucideIcon> = {
  mood: Smile,
  sleep: Moon,
  focusGray: Brain,
  risk: LifeBuoy,
  worry: Waves,
  body: Activity,
  expect: Target,
  night: AlarmClock,
  satisfaction: Gauge,
  daytime: Sunrise,
  events: Zap,
  control: Anchor,
  burden: BatteryLow,
  coping: Scale,
};

export default function ScaleIntroDialog({
  scaleId,
  open,
  onClose,
}: {
  scaleId: string;
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const guide = getScaleGuide(scaleId);
  /* 关闭时先播退场动画再真正卸载：open 由父组件控制，
     直接调 onClose 会让弹窗"啪"地消失，和进场动画不对称。 */
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, 170);
  };

  /* Esc 关闭 + 打开期间锁住背景滚动（与项目里其他弹窗一致） */
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handleKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
    // requestClose 每次渲染都是新函数，这里只依赖 open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !guide) return null;

  return (
    <div
      /* 不用 backdrop-blur：整页被虚化后，背后的文字全变成色块，盯着很难受。
         改成纯压暗——弹窗本身有边框和投影，层次已经够清楚。 */
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 ${
        closing ? "dialog-backdrop-out" : "dialog-backdrop-in"
      }`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="scale-intro-title"
        className={`app-scrollbar max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_30px_90px_-40px_rgba(16,24,40,0.55)] sm:p-7 ${
          closing ? "scale-intro-dialog-out" : "scale-intro-dialog"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium tracking-[0.16em] text-primary-500">
              量表介绍
            </p>
            <h2
              id="scale-intro-title"
              className="mt-3 text-2xl font-semibold text-slate-900"
            >
              {guide.modalTitle}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={requestClose}
            aria-label="关闭量表介绍，返回当前题"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-7 text-slate-600">{guide.summary}</p>

        <div className="mt-6">
          <h3 className="text-base font-semibold text-slate-800">
            这份量表关注什么
          </h3>
          <ul className="mt-4 grid gap-3.5">
            {guide.focus.map((item) => {
              const Icon = FOCUS_ICONS[item.icon];
              return (
                <li key={item.title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-500">
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-slate-800">
                      {item.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-6 text-slate-500">
                      {item.desc}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-6 grid gap-4 border-t border-slate-100 pt-5">
          <IntroRow title="它如何帮助你">{guide.helps}</IntroRow>
          <IntroRow title="结果的边界">{guide.boundary}</IntroRow>
        </div>

      </section>
    </div>
  );
}

function IntroRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <MessageSquareText
          className="h-4 w-4 text-slate-400"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-6 text-slate-500">{children}</p>
    </div>
  );
}
