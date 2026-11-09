/**
 * kgProfile.ts · 知识图谱的两处"外部输入"：用户性别与深空色板
 *
 * 为什么单独一层：
 *   · **性别** —— 需求是"用户节点按性别显示男生/女生头像"，但当前个人信息
 *     里**没有性别字段**（已实测：/api/personal/profile 的返回体里没有 gender，
 *     仓库里唯一的 `gender` 是 data/mockData.ts 里演示人物「林晓」的，不是登录
 *     用户自己的）。所以这里集中一处做降级：读不到就按约定返回男生，并把
 *     "以后接哪个字段"写在函数里，将来后端加上 gender，只改这一个函数。
 *   · **色板** —— 星空是深色底。图谱原本的配色走 --color-* 令牌（会随
 *     浅色/深色主题翻转），一旦画布固定成深空，浅色主题下的令牌色（浅灰、
 *     浅蓝）在深底上几乎看不见。所以这里给出一套**固定**的深空色板：
 *     与主题无关，保证任何主题下星点都清晰。这不是"绕过主题"，而是
 *     "深空画布本身就是一种材质"。
 */

import type { KgGender } from '../components/KgUserAvatar';

/* ─────────────────────────────── 性别 ─────────────────────────────── */

/** 本机性别覆盖的存储键（将来做"个人设置"页时写这里，无需动图谱代码） */
const GENDER_KEY = 'psych_gender';

/**
 * 读取当前用户性别。
 *
 * 数据来源，按优先级：
 *   1. 本机覆盖（localStorage `psych_gender`）—— 用户在个人设置里改过就以它为准；
 *   2. 后端个人档案的 `gender` 字段 —— **当前不存在**，此分支留作接入点；
 *   3. 兜底：男生（用户 2026-11-08 明确"目前个人信息不带性别，直接暂定为男生"）。
 *
 * 注意返回值刻意用 `KgGender` 而不是 `string`：调用方 switch 时能穷尽，
 * 将来加第三种取值（如中性头像）编译器会直接报出所有待改处。
 */
export function resolveGender(raw?: string | null): KgGender {
  const fromStore = readStoredGender();
  const value = (fromStore ?? raw ?? '').trim();
  if (!value) return 'male'; // 个人信息无性别 → 暂定男生
  if (/^(女|female|f|woman|girl)$/i.test(value)) return 'female';
  if (/^(男|male|m|man|boy)$/i.test(value)) return 'male';
  /* 认不出的取值（比如 "其他"/"不愿透露"）：按兜底走男生，不抛错、不空着 */
  return 'male';
}

function readStoredGender(): string | null {
  try {
    return localStorage.getItem(GENDER_KEY);
  } catch {
    /* 隐私模式：当作没有覆盖 */
    return null;
  }
}

/**
 * 写入本机性别覆盖（供将来的"个人设置"页调用）。
 * 传 null 表示清除覆盖、回到自动判定。
 */
export function saveGender(gender: KgGender | null): void {
  try {
    if (gender) localStorage.setItem(GENDER_KEY, gender);
    else localStorage.removeItem(GENDER_KEY);
  } catch {
    /* 写不进去也不阻断界面：本次会话仍按兜底渲染 */
  }
}

/* ────────────────────────────── 深空色板 ────────────────────────────── */

export interface DeepSpacePalette {
  /** 画布中心的深空底色（稍暖，像银河核心那一带） */
  voidInner: string;
  /** 画布外缘的底色（更冷更暗，制造纵深） */
  voidOuter: string;
  /** 星点主色（近处偏白） */
  starNear: string;
  /** 星点远景色（偏冷蓝，靠"更暗更小"读作更远） */
  starFar: string;
  /** 星云团颜色（三团，给背景一点色彩层次） */
  nebula: [string, string, string];
  /** 球体经纬大圆的线色 */
  wire: string;
  /** 节点默认描边 */
  nodeRing: string;
  /** 节点标签文字 */
  nodeLabel: string;
  /** 边标签文字 */
  edgeLabel: string;
  /* 各类型节点的星体色。同类型 = 同色，这是"点击某节点、同类发光"的视觉基础 */
  type: Record<string, string>;
  /** 认不出的类型 */
  fallback: string;
}

/**
 * 深空色板（固定值，不随主题翻转）。
 *
 * 取色思路：整体压暗（画布本身就是"夜"），让**发光**成为唯一的亮度来源。
 * 各类节点的色相与其语义保持仓库既有约定：
 * 用户=品牌蓝、兴趣=青、情绪=琥珀、症状=玫红、生活事件=靛、诱因=橙、应对=翠、障碍=赤。
 */
export const DEEP_SPACE: DeepSpacePalette = {
  voidInner: '#0b1330',
  voidOuter: '#04060f',
  starNear: '#ffffff',
  starFar: '#8fb4ff',
  nebula: ['#3d2a7a', '#12456b', '#5b2450'],
  wire: '#4a6bd6',
  nodeRing: '#0b1330',
  nodeLabel: '#dbe4ff',
  edgeLabel: '#8ea3d8',
  type: {
    User: '#5c7cff',
    Interest: '#22d3ee',
    Emotion: '#fbbf24',
    Symptom: '#fb7185',
    LifeEvent: '#818cf8',
    Trigger: '#fb923c',
    Coping: '#34d399',
    Disorder: '#ef4444',
    Unknown: '#94a3b8',
  },
  fallback: '#94a3b8',
};

/** Interest 再按 category 细分（音乐/运动/…），同 category 同色 → 更细一层的"同类" */
const CATEGORY_COLOR: Record<string, string> = {
  音乐: '#22d3ee',
  体育赛事: '#38bdf8',
  影视: '#f472b6',
  游戏: '#a78bfa',
  运动: '#34d399',
  美食: '#fbbf24',
  旅行: '#4ade80',
  书籍: '#facc15',
};

/**
 * 取一个节点的星体色。
 *
 * 注意 category 只覆盖 Interest：其他类型（情绪/症状…）的 category 字段
 * 语义不统一，混进来会把"同类型同色"这条规则打乱。
 */
export function nodeColorOf(label: string, category?: string | null): string {
  if (label === 'Interest' && category) {
    const c = CATEGORY_COLOR[category];
    if (c) return c;
  }
  return DEEP_SPACE.type[label] ?? DEEP_SPACE.fallback;
}

/** 图例用：八个标签的中文名 */
export const LABEL_NAME: Record<string, string> = {
  User: '用户',
  Interest: '兴趣',
  Emotion: '情绪',
  Symptom: '症状',
  LifeEvent: '生活事件',
  Trigger: '诱因',
  Coping: '应对方式',
  Disorder: '障碍',
};
