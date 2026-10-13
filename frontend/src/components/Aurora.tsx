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
 * 登录屏刻意不放这一层（登录页保持干净），只有内容屏使用。
 */
export default function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
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
