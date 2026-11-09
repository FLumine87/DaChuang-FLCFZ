/**
 * AiCompanionBot.tsx · AI 陪伴对话页的机器人形象（纯 SVG，无外部资源）
 *
 * ── 2026-11-08 第三轮：换成深色金属机甲形象 ────────────────────────────────
 * 用户在设计稿上反复打磨后定稿（横向宽头型 + 面部深屏居中 + 嵌入式侧凸块 +
 * 单环天线 + 一节短颈 + 加粗等长双臂 + 短粗双腿 + 胶囊瞳孔错峰眨眼 +
 * 嘴巴「微笑弧线 ↔ 正圆张口」循环），本轮把这个形象落进项目。
 *
 * 形象细节与设计稿一一对应，坐标沿用设计稿的数值（只是整体换了一个 viewBox），
 * 方便以后拿设计稿核对时能直接对坐标。
 *
 * ── 为什么是「伪 3D」而不是 WebGL ─────────────────────────────────────────
 *   · 它是页面装饰，不是主角。引 three.js 带来 600KB+ 包体和一块 WebGL 画布
 *     （还要处理上下文丢失、移动端降级），收益与成本不匹配；
 *   · 纯 SVG 在任何缩放比下矢量锐利，且 prefers-reduced-motion 能直接关停。
 * 立体感靠四条老办法叠出来（不靠多边形建模）：
 *   1. 球面/柱面光：头壳与身体用竖向渐变 + 左上高光斑，右缘压暗；
 *   2. 纵深：面屏挖成深色玻璃（比头壳暗两档），五官浮在上面 → 凹进去的层次；
 *   3. 轮廓：每个部件都垫一层近黑描边（#080b11）。没有它，深色机体在浅色页面上
 *      会糊成一团 —— 这是深色造型能站在浅底上的前提；
 *   4. 接地：脚下一道椭圆光晕 + 身体底缘压暗 → "站在地上"而不是"飘着"。
 *
 * ── 配色为什么写死而不是走主题变量 ────────────────────────────────────────
 * 机体是一套"材质"（金属灰 + 品牌蓝发光），不是主题色。若改用
 * var(--color-primary-*)，深色模式下这些变量会被换成深蓝，机器人的发光会整个
 * 消失。所以机体色写死；只有背景光晕与轮廓辉光用类名留给 CSS 按主题调
 * （浅色下压暗、深色下提亮），保证两种主题都看得清。
 *
 * ── 姿态 ──────────────────────────────────────────────────────────────────
 *   pose="idle"  —— 站姿（默认）：呼吸起伏，偶尔眨眼、嘴巴缓慢开合、
 *                   偶尔**歪头**（见下）；走动态时摆腿摆臂。
 *   pose="peek"  —— 探看姿：整体朝对话面板前倾、头固定偏 3°、眼睛放大、
 *                   嘴巴收成小圆，靠近面板那一侧的手臂抬起来。
 *                   由 RoamingBot 摆在输入框那一行的面板外侧。
 *   walking      —— 走动态：双腿反向摆 + 双臂反相摆 + 身体一步一沉。
 *                   仅在 pose="idle" 下生效（探看时不会迈腿）。
 *
 * ── 歪头（.bot-tilt） ─────────────────────────────────────────────────────
 * 「歪头」不是让脑袋在原地打转，是**绕脖子转**。所以给整块头套一个
 * `.bot-tilt` 组（transform-box: fill-box + transform-origin: center bottom），
 * 而这组的包围盒下缘恰好落在头壳底边 y=229（天线在上、侧凸块在两侧都不会
 * 改变下缘）—— 那就是脖子的位置。以此为轴转 7°，读出来才是"歪头"。
 * 天线是头的一部分，必须在这一组**内部**，否则头歪了天线还笔直戳着就穿帮。
 *
 * 歪头用的是 CSS 动画（bot-tilt，13s 一轮、绝大部分时间角度为 0），
 * 所以探看时用**内联 transform** 给一个固定的 3°，此时不加动画类名
 * （CSS 动画的 transform 会整体盖掉内联 transform）。
 *
 * ── 一个必须注意的坑：transform-origin 与 viewBox 原点 ────────────────────
 * 本组件 viewBox 的原点不是 0,0。SVG 里 transform-box 默认是 view-box，
 * 此时 transform-origin 的长度是**相对 viewBox 原点**算的 —— 写 `340px`
 * 会落到用户坐标 VB_X+340 上，旋转会整个跑飞。所以这里所有需要旋转的元素
 * 一律用 `transform-box: fill-box` + 百分比原点（见 index.css 的
 * .bot-pivot-* / .bot-tilt），原点跟着元素自己的包围盒走，与 viewBox
 * 原点无关，永远不会错。
 *
 * ── viewBox 为什么要留这么宽的空白（踩过的坑） ────────────────────────────
 * 上一版 viewBox 是紧贴机体的 "210 8 260 432"。只要头一歪，问题就来了：
 * 头绕脖子转时右上角会**横向甩出去**，探看再叠一个 5° 前倾后，右侧凸块
 * 的外缘能到 x≈483 —— 已经越过 viewBox 右边界 470，于是右边被**裁掉一块**。
 * 修法不是把动画调小（那治不了本），而是给画布留出旋转的余量：
 * 现在 x 范围是 178…502（中心仍是 340，左右对称，朝左时 scaleX(-1) 镜像
 * 后才不会左右不对称地"跳"），上下留出呼吸/走路起伏的余量。
 * 代价是机体只占画布宽度的 80% —— 所以调用方的 size 语义是"画布宽"，
 * RoamingBot 里的尺寸常量按 324/260 同步放大过。
 *
 * ── 分层注意（另一个踩过的坑） ────────────────────────────────────────────
 * CSS 动画的 keyframes 会设置 transform，**会整体覆盖同一元素上的内联
 * transform**。所以：定位用的 translate 在外层 div（RoamingBot）；
 * 起伏/摆腿各自独占一层 <g>；前倾 rotate 必须再单独包一层。
 */

import { useId } from 'react';

export type BotPose = 'idle' | 'peek';

interface AiCompanionBotProps {
  /** 渲染宽度（px）。高度 = 宽度 × BOT_ASPECT */
  size?: number;
  /** 是否播放动画（默认 true；列表/密集处可关掉省性能） */
  animated?: boolean;
  /** 姿态：站姿 / 探看 */
  pose?: BotPose;
  /** 走动态：摆腿摆臂 + 身体起伏。仅 pose="idle" 时生效 */
  walking?: boolean;
  /** 朝向：1 向右（默认），-1 向左。按行进方向或"面向面板"翻转 */
  facing?: 1 | -1;
  /** 附加类名 */
  className?: string;
}

/** viewBox 的宽高。外部按宽度算高度的地方都用 BOT_ASPECT。
 *  尺寸刻意比机体大一圈：给"歪头"和多层旋转留出余量，否则头一偏右边就被裁。
 *  余量的算法（都是绕脖子/脚底转，所以离轴越远的角甩得越远）：
 *
 *    · 闲站歪头 7°：头组绕 (340, 229) 转，最远角 (458, 15) 甩到 x=483.2；
 *      反向 -6° 时左下角甩到 x=200.3 → 离中心最远 143.2。
 *    · 探看：头固定偏 3° 叠加整体前倾 5°（两层转轴不同），
 *      同一个角先绕脖子到 (469.0, 21.5)、再绕脚底 (340, 438) 到 x=504.85
 *      → 离中心 164.85。**这才是真正的最坏情况**，比歪头还多 15%。
 *    · 呼吸还在最外层再抬 10 个单位，所以上边要多留。
 *
 *  于是横向按 ±165 配，X 取 340±180；上边要容下歪头后抬起来的 10 个单位，
 *  取 -16。留出的这点富余是"视觉上真的没被切"，不是刚好卡在边界上
 *  —— 边界上的切割在抗锯齿下会露出半像素的毛边，比明显切掉还难看。 */
const VB_W = 360;
const VB_H = 470;
const VB_X = 160;
const VB_Y = -16;
const VIEW_BOX = `${VB_X} ${VB_Y} ${VB_W} ${VB_H}`;

/* 机体的实际绘制范围（不含四周的透明余量）：
     横向 216…464 —— 左右两侧是背景光晕的左/右缘（rx=124）；
     纵向  15…438 —— 天线顶端光斑的上缘 → 接地椭圆的下缘。
   把**背景光晕**也算进来：它虽然淡，但确实是"机器人占的地方"，
   而且定位（贴边、落在空地）本来就是按这个外沿算的，两边口径一致
   才不会出现视觉上的"离边缘还差一截"。横向中心 340 与画布中心重合，
   左右余量各 56 —— **必须对称**，因为朝左时整个 svg 走 scaleX(-1) 镜像，
   余量不对称会让机器人"一转身就横向跳一下"。 */
const BODY_X0 = 216;
const BODY_X1 = 464;
const BODY_Y0 = 15;
const BODY_Y1 = 438;

/** 机体绘制宽/高（px，用户坐标口径） */
export const BOT_BODY_W = BODY_X1 - BODY_X0;
export const BOT_BODY_H = BODY_Y1 - BODY_Y0;
/** 画布宽 ÷ 机体宽。调用方若按"视觉尺寸"排版，就用它把视觉尺寸折成 svg 的 size */
export const BOT_CANVAS_RATIO = VB_W / BOT_BODY_W;
/** 机体外缘到画布边缘的余量，按各自方向的总尺寸归一化成比例 ——
 *  调用方拿渲染后的 px 乘一下就是实际余量。定位时**必须把这截扣掉**，
 *  否则机器人看上去离面板/容器边缘总差这么一截（那截是透明余量）。
 *  横向只有左值：左右对称，右值恒等于它。 */
export const BOT_PAD_LEFT_RATIO = (BODY_X0 - VB_X) / VB_W;
export const BOT_PAD_TOP_RATIO = (BODY_Y0 - VB_Y) / VB_H;
export const BOT_PAD_BOTTOM_RATIO = (VB_Y + VB_H - BODY_Y1) / VB_H;

/** 探看姿时，机体朝**面板那一侧**会多探出这么多（用户坐标口径）。
 *
 *  上面那组 BODY_X0/X1 量的是**静止**轮廓。一进入探看，整体前倾 5° 叠上
 *  头部再偏 3°，最远的那个角就被甩出去了：角 (464,15) 先绕脖子 (340,229)
 *  转 3° → (475.0, 21.8)，再绕脚底 (340,438) 转 5° → x = 510.8，
 *  比静止时的 464 多出 46.8。
 *
 *  为什么必须单独暴露它：调用方（RoamingBot 的 peekSpot）算"站在面板外侧"
 *  时只按静止轮廓留了 6px 间隙，而实际内容会再多探出约 19px（按当前尺寸
 *  折算）—— 于是机体的外沿**越过面板边缘压到输入框上**（实测重叠 4px）。
 *  在 GAP 之外补上这一份，才是真的站在外侧。 */
const LEAN_EXT_X = 47;
export const BOT_LEAN_EXT_RATIO = LEAN_EXT_X / VB_W;

/** viewBox 高宽比：所有外部按宽度算高度的地方都用它 */
export const BOT_ASPECT = VB_H / VB_W;

export default function AiCompanionBot({
  size = 96,
  animated = true,
  pose = 'idle',
  walking = false,
  facing = 1,
  className = '',
}: AiCompanionBotProps) {
  /* 渐变 id 必须全局唯一：同页会有多个实例（走动的那只 + 今日问询弹窗里的），
     固定 id 会互相覆盖 —— 在深浅色下正好同色时看不出问题，一旦某处改了配色
     才会露出"弹窗里的机器人颜色跟着页面上那只变"的怪现象。 */
  const uid = useId().replace(/:/g, '');
  const id = (name: string) => `${name}-${uid}`;
  const ref = (name: string) => `url(#${id(name)})`;

  const peeking = pose === 'peek';
  /* 走动态只在站姿下成立：探看的人不会迈腿 */
  const walkingNow = walking && !peeking && animated;
  const breathing = animated && !walkingNow;

  /* 探看时瞳孔大一圈（原地放大而不是换一套眼睛）：瞳孔放大是"好奇"最直接的
     表达，比换表情便宜也更容易被读懂。 */
  const eye = peeking
    ? { w: 30, h: 42, rx: 15, dy: 133 }
    : { w: 26, h: 36, rx: 13, dy: 136 };

  const width = size;
  const height = Math.round(size * BOT_ASPECT);

  return (
    <svg
      width={width}
      height={height}
      viewBox={VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform: facing === -1 ? 'scaleX(-1)' : undefined }}
      role="img"
      aria-label={peeking ? 'AI 陪伴助手正在看你的输入' : 'AI 陪伴助手'}
    >
      <defs>
        {/* 背景光晕：深色机体在深色主题下靠它托起来，浅色下则压低 */}
        <radialGradient id={id('halo')}>
          <stop offset="0" stopColor="#465fff" stopOpacity="0.26" />
          <stop offset="1" stopColor="#465fff" stopOpacity="0" />
        </radialGradient>
        {/* 脚下光晕：接地用。纯蓝的柔光比"黑色投影"更贴科技感，也和天线/眼睛呼应 */}
        <radialGradient id={id('floor')}>
          <stop offset="0" stopColor="#4a63ff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#4a63ff" stopOpacity="0" />
        </radialGradient>
        {/* 头壳柱面光：上亮下暗 */}
        <linearGradient id={id('head')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a6682" />
          <stop offset="0.4" stopColor="#333d52" />
          <stop offset="1" stopColor="#12181f" />
        </linearGradient>
        {/* 头壳左上高光斑：球面高光，让"方头"读成"有弧度的壳" */}
        <linearGradient id={id('gloss')} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.26" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        {/* 躯干柱面光 */}
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f5b76" />
          <stop offset="0.5" stopColor="#2b3448" />
          <stop offset="1" stopColor="#121721" />
        </linearGradient>
        {/* 四肢柱面光：远侧那一档压暗，形成前后景深 */}
        <linearGradient id={id('limb')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#525d78" />
          <stop offset="1" stopColor="#171d29" />
        </linearGradient>
        <linearGradient id={id('limbFar')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#414c64" />
          <stop offset="1" stopColor="#12171f" />
        </linearGradient>
        <linearGradient id={id('leg')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a5570" />
          <stop offset="1" stopColor="#151b26" />
        </linearGradient>
        <linearGradient id={id('legFar')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3c4761" />
          <stop offset="1" stopColor="#101620" />
        </linearGradient>
        {/* 侧凸块（不是耳机罩，是机体上长出来的两个小凸起） */}
        <linearGradient id={id('tab')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4d5872" />
          <stop offset="1" stopColor="#1b2230" />
        </linearGradient>
        <linearGradient id={id('foot')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#414c64" />
          <stop offset="1" stopColor="#0f141e" />
        </linearGradient>
        {/* 面屏玻璃：上近黑、下微亮，模拟内凹弧面的反光 */}
        <linearGradient id={id('screen')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#01040a" />
          <stop offset="0.6" stopColor="#0b1526" />
          <stop offset="1" stopColor="#122036" />
        </linearGradient>
        {/* 眼睛发光：暗色面屏里的一点亮，让五官"发出来"而不是"贴上去" */}
        <radialGradient id={id('eyeGlow')}>
          <stop offset="0" stopColor="#b6c2ff" stopOpacity="0.98" />
          <stop offset="0.5" stopColor="#5f74ff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#465fff" stopOpacity="0" />
        </radialGradient>
        {/* 天线顶端光点 */}
        <radialGradient id={id('tip')}>
          <stop offset="0" stopColor="#eef2ff" stopOpacity="1" />
          <stop offset="1" stopColor="#7f93ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── 背景光晕与接地光晕 ─────────────────────────────────────────────
          刻意**画在变换层之外**：它们代表"环境"和"地面"，身体起伏/迈腿/歪头时
          都不该跟着动 —— 身体在晃而光晕纹丝不动，才有"站在那里"的实在感。 */}
      <ellipse className="bot-halo" cx="340" cy="250" rx="124" ry="142" fill={ref('halo')} />
      <ellipse cx="340" cy="429" rx="96" ry="9" fill={ref('floor')} />

      {/* 第 1 层：起伏（走路）/ 呼吸（站立）。这层只放 transform 动画。 */}
      <g className={walkingNow ? 'bot-walk' : breathing ? 'bot-float' : ''}>
        {/* 第 2 层：整体前倾（探看时朝面板倾 5°，绕脚底转，像把身子探出去） */}
        <g className="bot-pivot-bottom bot-lean" style={{ transform: peeking ? 'rotate(5deg)' : undefined }}>
          {/* ── 双腿（先画：髋部会被身体/脖子盖住） ───────────────────────
              两条腿绕各自的髋关节反向摆 —— 正交摆才是走路，同相摆是踢腿。
              远腿压暗一档，一眼能分出前后。 */}
          <g
            className={`bot-pivot-top ${walkingNow ? 'bot-leg-far' : ''}`}
            style={{ transform: walkingNow ? undefined : 'rotate(5deg)' }}
          >
            <rect x="295" y="346" width="34" height="76" rx="17" fill="#080b11" />
            <rect x="298" y="349" width="28" height="70" rx="14" fill={ref('legFar')} />
            <circle cx="312" cy="370" r="12" fill="#0a1018" stroke="#6b82ff" strokeWidth="1.4" />
            <ellipse cx="312" cy="422" rx="28" ry="12.5" fill="#080b11" />
            <ellipse cx="312" cy="421" rx="25" ry="10.5" fill={ref('foot')} />
          </g>
          <g
            className={`bot-pivot-top ${walkingNow ? 'bot-leg-near' : ''}`}
            style={{ transform: walkingNow ? undefined : 'rotate(-5deg)' }}
          >
            <rect x="351" y="346" width="34" height="76" rx="17" fill="#080b11" />
            <rect x="354" y="349" width="28" height="70" rx="14" fill={ref('leg')} />
            <circle cx="368" cy="370" r="12" fill="#0a1018" stroke="#6b82ff" strokeWidth="1.4" />
            <ellipse cx="368" cy="422" rx="28" ry="12.5" fill="#080b11" />
            <ellipse cx="368" cy="421" rx="25" ry="10.5" fill={ref('foot')} />
          </g>

          {/* ── 双臂（画在身体之前 = 在身后侧，肩关节因此被身体盖住） ─────
              摆臂幅度比摆腿小一档：手臂短、又在身体侧后方，
              同幅度会显得像在甩手。 */}
          <g
            className={`bot-pivot-top ${walkingNow ? 'bot-arm-far' : ''}`}
            style={{
              transform: walkingNow ? undefined : peeking ? 'rotate(12deg)' : undefined,
            }}
          >
            <path d="M278 274 L248 338" stroke="#080b11" strokeWidth="26" strokeLinecap="round" fill="none" />
            <path d="M278 274 L248 338" stroke={ref('limbFar')} strokeWidth="22" strokeLinecap="round" fill="none" />
            <circle cx="248" cy="338" r="17" fill="#080b11" />
            <circle cx="248" cy="338" r="14" fill={ref('limbFar')} />
          </g>
          <g
            className={`bot-pivot-top ${walkingNow ? 'bot-arm-near' : ''}`}
            style={{
              transform: walkingNow ? undefined : peeking ? 'rotate(-20deg)' : undefined,
            }}
          >
            <path d="M402 274 L432 338" stroke="#080b11" strokeWidth="26" strokeLinecap="round" fill="none" />
            <path d="M402 274 L432 338" stroke={ref('limb')} strokeWidth="22" strokeLinecap="round" fill="none" />
            <circle cx="432" cy="338" r="17" fill="#080b11" />
            <circle cx="432" cy="338" r="14" fill={ref('limb')} />
          </g>

          {/* ── 短颈（一节） ───────────────────────────────────────────── */}
          <rect x="320" y="222" width="40" height="30" rx="10" fill="#080b11" />
          <rect x="322" y="222" width="36" height="30" rx="9" fill={ref('limb')} />

          {/* ── 躯干 ───────────────────────────────────────────────────── */}
          <rect x="274" y="248" width="132" height="96" rx="28" fill="#080b11" />
          <rect x="277" y="251" width="126" height="90" rx="25" fill={ref('body')} />
          {/* 胸口能量核：同心圆，浅色壳体上放文字会显脏，用发光核更干净 */}
          <circle cx="340" cy="288" r="24" fill={ref('eyeGlow')} />
          <circle cx="340" cy="288" r="14" fill="#0a0f19" stroke="#6b82ff" strokeWidth="1.6" />
          <circle cx="340" cy="288" r="5.5" fill="#cfd8ff" />
          <path d="M304 322 H376" stroke="#6b82ff" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />

          {/* ── 头（含天线、侧凸块、面屏、五官） ─────────────────────────
              两层职责，靠"同一时刻只生效一个"来避免打架：
                · 站姿 —— 挂 .bot-tilt，由 CSS 偶尔歪一下头。支点取
                  transform-origin: center bottom，而这个组的包围盒下缘恰好是
                  头壳底边 y=229，也就是脖子的位置，所以转起来是"歪头"不是"打转"。
                  走路时**照样挂着**：摘掉类名会让动画从头开始、并且若正值歪头
                  就会"啪"地弹回竖直。歪头只有 13s 里的 1.5s 才到 7°，
                  偶尔与走动重叠反而更像活物；这个跳变却每次都会露出来。
                · 探看 —— 不挂动画类，改用固定的内联 3°（往面板那边偏）。
                  与上面互斥，所以 inline transform 不会被 keyframes 盖掉。
              天线在这一组**内部**：头歪了天线得跟着歪，否则穿帮。 */}
          <g
            className={`bot-pivot-bottom ${animated && !peeking ? 'bot-tilt' : ''}`}
            style={{ transform: peeking ? 'rotate(3deg)' : undefined }}
          >
            {/* 天线（杆 + 光环 + 顶端光点）。放在头组**内部**：探看时头会多偏 4°，
                天线是头的一部分，必须跟着一起偏 —— 留在外面就会看到
                "头歪了、天线还笔直戳着"的穿帮。 */}
            <path d="M340 100 L340 32" stroke="#080b11" strokeWidth="10" strokeLinecap="round" />
            <path d="M340 100 L340 32" stroke="#3c4760" strokeWidth="5" strokeLinecap="round" />
            <ellipse cx="340" cy="60" rx="30" ry="9" fill="none" stroke="#6b82ff" strokeWidth="1.6" opacity="0.6" />
            <circle cx="340" cy="30" r="15" fill={ref('tip')} />
            <circle cx="340" cy="30" r="6" fill="#eef2ff" />

            {/* 两侧嵌入式凸块：一半压进头壳边缘 —— 是"机体上的小凸起"，不是耳机罩 */}
            <rect x="222" y="139" width="24" height="44" rx="12" fill="#080b11" />
            <rect x="224" y="141" width="20" height="40" rx="10" fill={ref('tab')} />
            <path d="M228 151 L228 173" stroke="#6b82ff" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />
            <rect x="434" y="139" width="24" height="44" rx="12" fill="#080b11" />
            <rect x="436" y="141" width="20" height="40" rx="10" fill={ref('tab')} />
            <path d="M452 151 L452 173" stroke="#6b82ff" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />

            {/* 头壳：横向长方形 + 大圆角。圆角够大才不像"一块砖"，也才不像手机 */}
            <rect x="233" y="93" width="214" height="136" rx="48" fill="#080b11" />
            <rect x="235" y="95" width="210" height="132" rx="46" fill={ref('head')} />
            <rect className="bot-rim" x="235" y="95" width="210" height="132" rx="46" stroke="#8b9ab5" strokeWidth="1.2" fill="none" />
            {/* 左上斜向高光斑 */}
            <ellipse cx="312" cy="122" rx="80" ry="25" fill={ref('gloss')} />

            {/* 面屏：四周留白对等（左右各 17、上下各 18）→ 黑屏严格居中。

                20 与 21 两步的差 2px —— 从「一块砖」到「一个有面孔的机体」。 */}
            <rect x="249" y="110" width="182" height="102" rx="38" fill="#05080f" />
            <rect x="252" y="113" width="176" height="96" rx="34" fill={ref('screen')} />
            <rect className="bot-rim" x="252" y="113" width="176" height="96" rx="34" stroke="#7d8fb0" strokeWidth="1.2" fill="none" />
            <path d="M266 119 H414" stroke="#ffffff" strokeWidth="3" opacity="0.05" strokeLinecap="round" />
            <path d="M270 202 H410" stroke="#8fa2ff" strokeWidth="1.6" opacity="0.16" strokeLinecap="round" />

            {/* 下颚两枚浅腮圆：让脸有"腮"这个结构，不然屏幕里只剩眼睛和嘴 */}
            <circle cx="300" cy="190" r="15" fill="#8fa2c8" opacity="0.2" />
            <circle cx="380" cy="190" r="15" fill="#8fa2c8" opacity="0.2" />

            {/* 眼睛：发光底 + 白色胶囊瞳孔。眨眼靠竖向压扁瞳孔实现；
                左右眼错开 0.12s —— 两只眼同时眨会像机器刷新，错开才有生物感。 */}
            <circle cx="306" cy="154" r="27" fill={ref('eyeGlow')} />
            <circle cx="374" cy="154" r="27" fill={ref('eyeGlow')} />
            <rect
              className={animated ? 'bot-blink' : ''}
              x={306 - eye.w / 2} y={eye.dy} width={eye.w} height={eye.h} rx={eye.rx} fill="#f7f9ff"
            />
            <rect
              className={animated ? 'bot-blink' : ''}
              style={{ animationDelay: '120ms' }}
              x={374 - eye.w / 2} y={eye.dy} width={eye.w} height={eye.h} rx={eye.rx} fill="#f7f9ff"
            />

            {/* 嘴巴：探看时收成小圆嘴（"咦？"）；站姿时在微笑弧线与正圆张口之间循环 */}
            {peeking ? (
              <circle cx="340" cy="191" r="8.5" fill="#eef2ff" />
            ) : (
              <>
                <path
                  className={animated ? 'bot-mouth-smile' : ''}
                  d="M320 187 Q340 203 360 187"
                  stroke="#eef2ff" strokeWidth="5.5" strokeLinecap="round" fill="none"
                />
                <g className={animated ? 'bot-mouth-open' : ''}>
                  <circle cx="340" cy="191" r="14" fill="#0a1526" stroke="#eef2ff" strokeWidth="5" />
                </g>
              </>
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}
