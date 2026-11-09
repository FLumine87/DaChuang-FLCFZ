/**
 * KgUserAvatar.tsx · 知识图谱中心的用户节点头像（男生 / 女生两套矢量造型）
 *
 * ── 为什么是「徽章式头像」而不是真实照片 ─────────────────────────────────
 *   · 图谱是抽象结构图，中心放一张写实照片会和周围的星点完全不是一种语言；
 *   · 平台里没有用户头像上传，也不该为了这个功能去采集人像（心理类产品的
 *     数据最小化原则：能不存的人像就不存）；
 *   · 纯矢量头像在任何缩放下都锐利，还能跟着"同类发光""深度雾化"一起变。
 *
 * ── 坐标口径 ──────────────────────────────────────────────────────────────
 * 内部一律按**单位半径**作画（徽章外圆半径 = 1，圆心在原点），由调用方用
 * `transform: scale(radius)` 放大。好处是同一份坐标能吃下任意尺寸：
 * 近处用户节点被投影放大、缩小时无需改任何数值。
 *
 * ── 性别从哪来 ────────────────────────────────────────────────────────────
 * 见 services/kgProfile.ts：当前个人信息里没有性别字段，默认按男生渲染，
 * 同时留了一个本机覆盖口。接上后端档案的 gender 字段后只需改那一个函数。
 */

import { useId } from 'react';

export type KgGender = 'male' | 'female';

interface KgUserAvatarProps {
  gender: KgGender;
  /** 徽章外圆半径（用户坐标）。头像整体按此缩放 */
  radius: number;
  /** 外环颜色（跟用户节点的分类色一致） */
  ring: string;
  /** 是否聚焦（选中/同类高亮时描边更亮） */
  focused?: boolean;
}

export default function KgUserAvatar({ gender, radius, ring, focused = false }: KgUserAvatarProps) {
  const uid = useId().replace(/:/g, '');
  const female = gender === 'female';

  /* 材质色写死而非走主题令牌：徽章是「一套材质」（深色底 + 肤色 + 深发），
     在星空的深色画布上，深浅主题翻转过来的令牌色都会让脸整个糊掉。 */
  const skin = '#f0c6a2';
  const skinShade = '#d9a982';
  const hair = female ? '#3a2b3c' : '#242b38';
  const shirt = '#4f6ef7';
  const shirtDark = '#3b53cc';

  return (
    <g transform={`scale(${radius})`}>
      <defs>
        {/* 徽章底：上亮下暗，像一小块被星光照到的舷窗 */}
        <radialGradient id={`${uid}-badge`} cx="50%" cy="26%" r="86%">
          <stop offset="0%" stopColor="#2c4487" />
          <stop offset="62%" stopColor="#152046" />
          <stop offset="100%" stopColor="#0a1130" />
        </radialGradient>
        <linearGradient id={`${uid}-shirt`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={shirt} />
          <stop offset="100%" stopColor={shirtDark} />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <circle cx="0" cy="0" r="0.97" />
        </clipPath>
      </defs>

      {/* 外发光：聚焦时更亮，让"这是我的核心"在有选中状态时更明确 */}
      <circle r="1.16" fill={ring} opacity={focused ? 0.3 : 0.16} />

      <g clipPath={`url(#${uid}-clip)`}>
        <circle r="1" fill={`url(#${uid}-badge)`} />

        {/* 女生长发的后层：先铺发丝，再让头与肩膀压上去 */}
        {female && (
          <path
            d="M -0.62 -0.10 C -0.74 0.28 -0.68 0.74 -0.58 1.00 L 0.58 1.00 C 0.68 0.74 0.74 0.28 0.62 -0.10 Z"
            fill={hair}
          />
        )}

        {/* 肩与衣领：一个从下缘升起的圆弧，裁剪后就是"半身像"的取景 */}
        <path
          d="M -0.80 1.04 C -0.78 0.62 -0.48 0.40 0 0.40 C 0.48 0.40 0.78 0.62 0.80 1.04 Z"
          fill={`url(#${uid}-shirt)`}
        />
        <path d="M -0.17 0.44 L 0 0.64 L 0.17 0.44" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="0.05" strokeLinecap="round" />

        {/* 脖子 → 头 → 耳朵 */}
        <rect x="-0.11" y="0.14" width="0.22" height="0.30" rx="0.06" fill={skinShade} />
        <circle cx="-0.335" cy="-0.04" r="0.072" fill={skinShade} />
        <circle cx="0.335" cy="-0.04" r="0.072" fill={skinShade} />
        <ellipse cx="0" cy="-0.06" rx="0.34" ry="0.36" fill={skin} />

        {/* 头发 */}
        <path
          d="M -0.365 -0.055 C -0.375 -0.34 -0.20 -0.50 0 -0.50 C 0.20 -0.50 0.375 -0.34 0.365 -0.055
             C 0.30 -0.24 0.20 -0.30 0 -0.30 C -0.20 -0.30 -0.30 -0.24 -0.365 -0.055 Z"
          fill={hair}
        />
        {female && (
          <>
            {/* 两侧垂下的长发，落到肩膀就停 —— 再长会盖住衣服的层次 */}
            <path d="M -0.375 -0.05 C -0.50 0.12 -0.51 0.36 -0.45 0.58 L -0.30 0.54 C -0.36 0.32 -0.35 0.12 -0.30 -0.05 Z" fill={hair} />
            <path d="M 0.375 -0.05 C 0.50 0.12 0.51 0.36 0.45 0.58 L 0.30 0.54 C 0.36 0.32 0.35 0.12 0.30 -0.05 Z" fill={hair} />
            {/* 一枚小星形发饰：别在**发带**上（y≈-0.34、靠外侧），而不是脸颊旁。
                放低到 y=-0.30 时会被读成"贴在脸上的贴纸"（实测特写截图确认过），
                上移到发带后才是"别在头发上的发饰"。 */}
            <path d="M 0.30 -0.40 l 0.042 0.094 0.103 0.009 -0.079 0.07 0.026 0.101 -0.092 -0.056 -0.092 0.056 0.026 -0.101 -0.079 -0.07 0.103 -0.009 Z" fill="#ffd76a" />
          </>
        )}

        {/* 五官：眉毛、眼睛（带高光）、鼻子、嘴 */}
        <path d="M -0.195 -0.165 L -0.075 -0.178" stroke={hair} strokeWidth="0.045" strokeLinecap="round" fill="none" />
        <path d="M 0.075 -0.178 L 0.195 -0.165" stroke={hair} strokeWidth="0.045" strokeLinecap="round" fill="none" />
        <ellipse cx="-0.125" cy="-0.052" rx="0.049" ry="0.06" fill="#232a38" />
        <ellipse cx="0.125" cy="-0.052" rx="0.049" ry="0.06" fill="#232a38" />
        <circle cx="-0.14" cy="-0.072" r="0.018" fill="#ffffff" fillOpacity="0.9" />
        <circle cx="0.11" cy="-0.072" r="0.018" fill="#ffffff" fillOpacity="0.9" />
        <path d="M 0 0.015 L 0 0.055" stroke={skinShade} strokeWidth="0.032" strokeLinecap="round" fill="none" />
        <path d="M -0.085 0.112 Q 0 0.185 0.085 0.112" stroke="#b3554f" strokeWidth="0.042" strokeLinecap="round" fill="none" />

        {female && (
          <>
            <ellipse cx="-0.235" cy="0.075" rx="0.075" ry="0.045" fill="#f08a8a" fillOpacity="0.35" />
            <ellipse cx="0.235" cy="0.075" rx="0.075" ry="0.045" fill="#f08a8a" fillOpacity="0.35" />
          </>
        )}
      </g>

      {/* 外环与内圈高光：把头像"框"成一个节点，而不是贴上来的图 */}
      <circle r="1" fill="none" stroke={ring} strokeWidth={focused ? 0.085 : 0.07} opacity={0.95} />
      <circle r="0.965" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="0.03" />
    </g>
  );
}
