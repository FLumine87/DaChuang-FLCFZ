/**
 * Aurora.tsx
 * 动态背景层「极光」：三块低不透明度光斑 + 三片半透明玻璃，纯 CSS 动画、只动 transform。
 *
 * 原先定义在 pages/introSections.tsx 里（主页内容屏专用）。工作台（个人端 / 管理端）
 * 现在也要用同一层背景，所以上移到 components 下共享——从 pages 反向 import 到
 * components 是正常方向，反过来（components → pages）才是别扭的。
 * introSections.tsx 仍在原处重新导出，主页的引用不用改。
 *
 * 颜色与透明度写在 index.css 的 .aurora / .glass 里；深色模式自动压暗。
 *
 * 三个变体解决"主页 / 登录 / 首次筛查"之间的连续性：
 *   · rich    —— 内容屏与工作台，保留三团光 + 三片玻璃（原样）；
 *   · calm    —— 登录页、首次选择页：只留一片大曲面 + 两团淡光，去掉青色光团；
 *   · minimal —— 主页首屏：人物插画已经承担了蓝紫弧面，背景只留一层很淡的蓝雾。
 * still 用于正式答题：形状、颜色不变，只是停止漂移，阅读区域保持稳定。
 */
export type AuroraVariant = "rich" | "calm" | "minimal";

export default function Aurora({
  variant = "rich",
  still = false,
}: {
  variant?: AuroraVariant;
  still?: boolean;
}) {
  return (
    <div
      className={`aurora aurora--${variant}${still ? " aurora--still" : ""}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
      {/* 大片半透明"玻璃"形状：自己生成，缓慢漂移（比参考站的静态图更"动"） */}
      <i className="glass glass-1" />
      <i className="glass glass-2" />
      <i className="glass glass-3" />
    </div>
  );
}
