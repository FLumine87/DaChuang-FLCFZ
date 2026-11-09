/**
 * KgStarfield.tsx · 知识图谱的星空背景（远/中/近三层星点 + 星云 + 银河带）
 *
 * ── 为什么要"分层视差"而不是一张静态星图 ─────────────────────────────────
 * 星空的立体感来自**视差**：转动视角时近处的星跑得快、远处的几乎不动。
 * 所以三层各自按不同的视差系数平移（远 0.06 / 中 0.16 / 近 0.34），
 * 相机一转，纵深感立刻出来 —— 这是"一张好看的背景图"做不到的。
 *
 * ── 视差为什么用 sin 而不是直接用 yaw ────────────────────────────────────
 * 自动自转会让 yaw 无限增长。若把 yaw 直接乘进偏移量，星点会一直单向漂移，
 * 且偏移量超过星点铺设范围后画布边上会**露出空白**。sin(yaw) 是有界的
 * （-1..1，转一整圈回到原处），读起来就是"星空随视角缓缓往复"，
 * 与"相机转一圈、星空回到原位"的直觉一致。
 *
 * ── 性能：为什么不逐颗星重算坐标 ─────────────────────────────────────────
 * 三层合计约 500 颗星，若每帧都让 React 重算 500 个 <circle> 的 cx/cy，
 * 光协调开销就够呛。所以：
 *   · 星点坐标**只算一次**（useMemo，种子固定）；
 *   · 视差平移施加在**整层 <g> 的 transform** 上，由父组件通过
 *     `sync()` 以命令式方式写 DOM（每帧 3 次 setAttribute，不触发 React 重渲染）。
 * 为此星点铺设在 [-1.35, 1.35] 的归一化空间里（比画布大一档），
 * 这样整层平移 ±0.35 也不会在边缘露出空档 —— 也就不需要 wrap 折返，
 * 省掉了折返点跳变的隐患。
 *
 * ── 确定性伪随机（LCG）而不是 Math.random ────────────────────────────────
 * Math.random 会在每次渲染/热更新时重排星空，看起来像"页面在闪"。
 * 固定种子的 LCG 让同一份星图永远长一样，刷新也不变。
 */

import { useCallback, useId, useImperativeHandle, useMemo, useRef } from 'react';
import type { Ref } from 'react';
import { DEEP_SPACE } from '../services/kgProfile';

export interface StarfieldHandle {
  /** 相机变化时由父组件调用：只改三层 <g> 的 transform，不触发 React 重渲染 */
  sync: (yaw: number, pitch: number) => void;
}

interface KgStarfieldProps {
  w: number;
  h: number;
  ref?: Ref<StarfieldHandle>;
}

/** 线性同余伪随机（固定种子 → 星空每次刷新都一样） */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 星点铺设范围（归一化，原点在画布中心）：比画布大一档，留给视差平移 */
const EXT = 1.35;

/**
 * 深空底纹向外溢出的比例（BG_BLEED × 画布宽/高）。
 *
 * 为什么需要溢出：图谱页现在撑满一屏，星图卡的高度由 flex 决定、
 * 不再等于 900:560 —— 而 viewBox 是固定的，于是 SVG 用 meet 缩放后
 * 会在卡片左右（或上下）留下**空白带**。SVG 的空白带由 CSS 背景色填充，
 * 与画布内部的深空渐变不是同一个颜色：实测接缝处左侧带是 rgb(4,6,15)、
 * 紧邻的画布边缘是 rgb(11,11,30)，横向一条硬边，很难看。
 *
 * 解法：把深空底纹（void / 暗角 / 裁剪区）画到画布之外，并让根 <svg>
 * `overflow: visible` —— 画布坐标系之外的这部分就会填进空白带，
 * 颜色由同一条渐变连续延伸出来，接缝消失。
 * 0.4 是实测定的：最宽的空白带出现在 1280×720（卡片 926×404，约 192 用户单位），
 * 0.4×900 = 360 用户单位足够覆盖，且不会让渐变被拉伸得太厉害。
 * 星点不到处（EXT 只给到 ±0.175）无所谓 —— 那圈正好在暗角最暗的地方，
 * 读起来是"边缘更深的夜空"，不是缺陷。
 */
const BG_BLEED = 0.4;

interface Star {
  nx: number;
  ny: number;
  r: number;
  o: number;
  /** >0 表示这类星点参与闪烁（值同时用作相位错开的种子） */
  twinkle: number;
}

interface LayerSpec {
  count: number;
  seed: number;
  /** 视差强度 */
  parallax: number;
  rMin: number;
  rMax: number;
  oMin: number;
  oMax: number;
  /** 闪烁星点占比 */
  twinkleRatio: number;
  color: string;
}

/* 三层。count 按 EXT² ≈ 1.82 倍面积放大过，保证可见密度与"铺满画布"一致 */
const LAYERS: LayerSpec[] = [
  { count: 470, seed: 20261108, parallax: 0.06, rMin: 0.45, rMax: 1.0, oMin: 0.16, oMax: 0.46, twinkleRatio: 0, color: DEEP_SPACE.starFar },
  { count: 270, seed: 771103, parallax: 0.16, rMin: 0.75, rMax: 1.5, oMin: 0.28, oMax: 0.7, twinkleRatio: 0.1, color: DEEP_SPACE.starFar },
  { count: 130, seed: 9912317, parallax: 0.34, rMin: 1.1, rMax: 2.1, oMin: 0.45, oMax: 0.95, twinkleRatio: 0.25, color: DEEP_SPACE.starNear },
];

function buildLayer(spec: LayerSpec): Star[] {
  const rnd = lcg(spec.seed);
  const out: Star[] = [];
  for (let i = 0; i < spec.count; i++) {
    out.push({
      nx: (rnd() * 2 - 1) * EXT,
      ny: (rnd() * 2 - 1) * EXT,
      r: spec.rMin + rnd() * (spec.rMax - spec.rMin),
      o: spec.oMin + rnd() * (spec.oMax - spec.oMin),
      twinkle: rnd() < spec.twinkleRatio ? 1 + i : 0,
    });
  }
  return out;
}

export default function KgStarfield({ w, h, ref }: KgStarfieldProps) {
  const uid = useId().replace(/:/g, '');
  const layerRefs = useRef<(SVGGElement | null)[]>([]);

  /* 三层星点只在挂载时生成一次（种子固定，内容恒定） */
  const layers = useMemo(() => LAYERS.map(buildLayer), []);

  /* 星云团：三个大色斑，用极低不透明度叠在底色上，给夜空一点"银河"的温度 */
  const nebulae = useMemo(
    () => [
      { cx: w * 0.24, cy: h * 0.3, r: w * 0.34, color: DEEP_SPACE.nebula[0], o: 0.16 },
      { cx: w * 0.78, cy: h * 0.68, r: w * 0.3, color: DEEP_SPACE.nebula[1], o: 0.14 },
      { cx: w * 0.6, cy: h * 0.2, r: w * 0.24, color: DEEP_SPACE.nebula[2], o: 0.1 },
    ],
    [w, h],
  );

  const applyTransform = useCallback(
    (yaw: number, pitch: number) => {
      LAYERS.forEach((spec, i) => {
        const g = layerRefs.current[i];
        if (!g) return;
        const dx = Math.sin(yaw) * spec.parallax * w * 0.5;
        const dy = Math.sin(pitch) * spec.parallax * h * 0.5;
        g.setAttribute('transform', `translate(${dx.toFixed(2)},${dy.toFixed(2)})`);
      });
    },
    [w, h],
  );

  useImperativeHandle(ref, () => ({ sync: applyTransform }), [applyTransform]);

  const bleedX = w * BG_BLEED;
  const bleedY = h * BG_BLEED;
  const bgX = -bleedX;
  const bgY = -bleedY;
  const bgW = w + bleedX * 2;
  const bgH = h + bleedY * 2;

  return (
    <g aria-hidden="true">
      <defs>
        {/* 深空底：中心稍亮（像银河核心那一带），外缘更暗，先把"夜"铺上 */}
        <radialGradient id={`${uid}-void`} cx="50%" cy="44%" r="72%">
          <stop offset="0%" stopColor={DEEP_SPACE.voidInner} />
          <stop offset="100%" stopColor={DEEP_SPACE.voidOuter} />
        </radialGradient>
        {/* 星云/银河的柔化。只用在 5 个静态元素上，不是逐帧成本 */}
        <filter id={`${uid}-blur`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="34" />
        </filter>
        {/* 暗角：把视线压回中心的球体上 */}
        <radialGradient id={`${uid}-vignette`} cx="50%" cy="48%" r="66%">
          <stop offset="55%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
        </radialGradient>
        {/* 裁剪区故意画到画布之外（见 BG_BLEED 的说明）：配合根 <svg> 的
            overflow: visible，底纹会填满 meet 缩放留下的空白带 */}
        <clipPath id={`${uid}-clip`}>
          <rect x={bgX} y={bgY} width={bgW} height={bgH} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}-clip)`}>
        <rect x={bgX} y={bgY} width={bgW} height={bgH} fill={`url(#${uid}-void)`} />

        {/* 星云团 */}
        {nebulae.map((n, i) => (
          <circle key={`neb${i}`} cx={n.cx} cy={n.cy} r={n.r} fill={n.color} opacity={n.o} filter={`url(#${uid}-blur)`} />
        ))}

        {/* 银河带：斜穿画布的一条柔光带。用"纯色 + 大模糊"而不是线性渐变 ——
            渐变的方向（x1/x2）会跟着 rotate 一起转，视觉上不如两层同色带叠加可控 */}
        <g data-kg="galaxy" transform={`rotate(-18 ${w / 2} ${h / 2})`} opacity="0.45">
          <rect x={-w * 0.2} y={h * 0.44} width={w * 1.4} height={h * 0.13} fill="#7f9bff" opacity="0.07" filter={`url(#${uid}-blur)`} />
          <rect x={-w * 0.2} y={h * 0.47} width={w * 1.4} height={h * 0.05} fill="#c9d8ff" opacity="0.05" filter={`url(#${uid}-blur)`} />
        </g>

        {/* 三层星点：坐标固定，整层靠 transform 平移形成视差（见文件顶部说明） */}
        {layers.map((stars, li) => (
          <g
            key={`L${li}`}
            data-kg={`stars-${li}`}
            ref={(el) => {
              layerRefs.current[li] = el;
            }}
          >
            {stars.map((s, i) => (
              <circle
                key={i}
                cx={w / 2 + s.nx * (w / 2)}
                cy={h / 2 + s.ny * (h / 2)}
                r={s.r}
                fill={LAYERS[li].color}
                opacity={s.o}
                /* 闪烁只给少量近景星点：全都在闪就是"满屏噪点"，不是夜空。
                   相位按索引错开（周期一致、相位不同 → 同一片夜空） */
                className={s.twinkle ? 'kg-twinkle' : undefined}
                style={s.twinkle ? { animationDelay: `${(((s.twinkle * 13) % 44) / 10).toFixed(2)}s` } : undefined}
              />
            ))}
          </g>
        ))}

        {/* 暗角同样溢出到画布之外：它要压住的是"视觉上的画面边缘"，
            若只画到 0..w，空白带那一圈反而是最亮的，会把接缝衬得更明显 */}
        <rect x={bgX} y={bgY} width={bgW} height={bgH} fill={`url(#${uid}-vignette)`} />
      </g>
    </g>
  );
}
