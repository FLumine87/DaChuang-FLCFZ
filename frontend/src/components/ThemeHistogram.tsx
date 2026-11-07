/**
 * ThemeHistogram.tsx — 命中主题分布直方图
 *
 * X 轴：检索结果里出现的主题标签（如「学业压力」「抑郁」）
 * Y 轴：该主题在本次命中结果中出现的次数（频数）
 *
 * 用途：让评委一眼看出"这批相似案例集中在哪些困扰主题上"，
 * 是检索结果的可视化摘要，而不是逐条去看。
 *
 * ⚠️ 两类标签必须分开统计：情绪维度 vs 心理主题
 * ------------------------------------------------
 * 语料里的标签实际来自两个不同的维度：
 *
 *   情绪维度（CSEMOTIONS 数据集自带）：情绪-愤怒 / 情绪-恐惧 / 情绪-高兴 / 情绪-中性 /
 *                                      情绪-悲伤 / 情绪-惊讶 / 情绪-调皮
 *   心理主题（项目权威词表 THEME_KEYWORDS，19 类）：抑郁 / 焦虑 / 睡眠障碍 / 学业压力 /
 *                                      社交回避 / 应激创伤 / 自我认同 / 家庭冲突 …
 *
 * 情绪标签在语料里出现次数远多于主题（1040 次 vs 136 次），若混在一起按频数排序，
 * 前十几名会被情绪占满，「抑郁」「睡眠障碍」这些真正有临床含义的主题就看不见了
 * （用户实测反馈："怎么全部都是情绪标签"）。
 *
 * 所以默认**只统计心理主题**（更贴合"心理筛查"的语义），
 * 情绪标签通过开关按需并入，而不是直接丢弃 —— 它们本身也是对数据的如实描述。
 */
import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

/** 按频数分档配色，高频主题更醒目 */
const BAR_COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];

/** 情绪维度标签的前缀（由构建脚本从 CSEMOTIONS 的 emotion 字段映射而来） */
const EMOTION_PREFIX = '情绪-';

export interface ThemeCount {
  theme: string;
  count: number;
}

/**
 * 只需要 tags 字段即可统计主题。
 *
 * 刻意写成宽松结构而不是直接吃 judge 的 RetrievalHit：
 * 真实端的检索结果（data/mockData 与 admin/data/adminMockData 的 RetrievalResult）
 * 字段命名不同（alertLevel vs alert_level、id 语义不同），但都有 tags。
 * 用结构子类型可以让同一组件服务演示端与真实端两套结果，无需适配层。
 */
export interface ThemeSource {
  tags?: string[] | null;
}

/** 是否为情绪维度标签（与心理主题区分开） */
export function isEmotionTag(tag: string): boolean {
  return tag.startsWith(EMOTION_PREFIX);
}

/**
 * 从命中结果里统计主题频数（纯函数，便于单测）。
 *
 * @param includeEmotion 是否把「情绪-*」标签一并计入（默认 false，只统计心理主题）
 */
export function countThemes(
  hits: ThemeSource[],
  limit = 12,
  includeEmotion = false,
): ThemeCount[] {
  const counter = new Map<string, number>();
  for (const hit of hits) {
    const tags = Array.isArray(hit?.tags) ? hit.tags : [];
    for (const t of tags) {
      const key = String(t).trim();
      if (!key) continue;
      if (!includeEmotion && isEmotionTag(key)) continue;
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => (b.count - a.count) || a.theme.localeCompare(b.theme, 'zh'))
    .slice(0, limit);
}

export default function ThemeHistogram({ hits }: { hits: ThemeSource[] }) {
  /** 是否把情绪维度标签并入统计（默认否，见文件头说明） */
  const [withEmotion, setWithEmotion] = useState(false);

  const data = countThemes(hits, 12, withEmotion);

  // 结果里有没有情绪标签，决定要不要给出这个开关
  const hasEmotionTag = hits.some((h) =>
    (Array.isArray(h?.tags) ? h.tags : []).some((t) => isEmotionTag(String(t))),
  );

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">命中主题分布</h3>
        <p className="mt-3 text-sm text-slate-400">
          {withEmotion ? '本次结果没有主题标签' : '本次结果没有心理主题标签'}
          {!withEmotion && hasEmotionTag && '（只有情绪维度标签，可勾选下方开关查看）'}
        </p>
      </div>
    );
  }

  const maxCount = data[0]?.count ?? 1;
  // 主题多时加高图表，避免 X 轴标签互相压住
  const height = data.length > 8 ? 320 : 260;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-800">
          命中主题分布
          <span className="ml-2 text-xs font-normal text-slate-400">
            {withEmotion ? '（心理主题 + 情绪维度）' : '（心理主题）'}
          </span>
        </h3>
        <span className="text-xs text-slate-400">
          共 {data.length} 类 · 单条结果可含多个标签，故各柱之和 ≥ 命中条数
        </span>
      </div>

      {/* 情绪维度开关：默认关闭，避免情绪标签淹没心理主题 */}
      {hasEmotionTag && (
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={withEmotion}
            onChange={(e) => setWithEmotion(e.target.checked)}
            className="cursor-pointer"
          />
          并入情绪维度标签（情绪-愤怒 / 情绪-悲伤 …）
        </label>
      )}

      <div className="mt-4">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="theme"
              tick={{ fontSize: 11, fill: '#64748b' }}
              stroke="#cbd5e1"
              interval={0}
              angle={data.length > 6 ? -30 : 0}
              textAnchor={data.length > 6 ? 'end' : 'middle'}
              height={data.length > 6 ? 62 : 30}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              stroke="#cbd5e1"
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
              }}
              formatter={(value) => [`${value} 条`, '命中条数']}
              labelFormatter={(label) => `主题：${label}`}
            />
            <Bar dataKey="count" name="命中条数" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {data.map((d, i) => (
                <Cell
                  key={d.theme}
                  // 按频数分档：越接近最大值颜色越深。
                  // 情绪标签用暖色区分，一眼能看出哪些是情绪维度。
                  fill={
                    isEmotionTag(d.theme)
                      ? '#f59e0b'
                      : BAR_COLORS[Math.min(BAR_COLORS.length - 1, Math.round((1 - d.count / maxCount) * (BAR_COLORS.length - 1)))]
                  }
                  opacity={1 - i * 0.02}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
