/**
 * localKg.ts · L1「本机个人记忆」：对话抽取的实体 + 由本地数据组装的报告/推送
 *
 * 为什么要有这一层：
 *   本机演示环境没有 Neo4j（也没要求用户去装），但「AI 陪伴对话 / 我的知识图谱 /
 *   个性化推送」三个页面必须真的能用。用户 2026-10-14 拍板 **L1：数据存浏览器本地**，
 *   所以这一层负责两件事：
 *     1. 把对话里抽取到的三元组写进 localStorage，键 `psych_kg:v1:<username>`，
 *        结构 { triples: [{ head, relation, tail, at }], updatedAt }；
 *     2. 需要展示但没有服务端数据时，用**本机已有的数据**（量表记录、补充记录、
 *        对话三元组）组装图谱 / 报告 / 推送。
 *
 * 绝不编造：
 *   · 本地三元组全部来自用户自己说过的话（后端 mock 抽取器或本文件的关键词规则）；
 *   · 本地组装出来的报告/推送，每一条都带 reason 说明来源（哪条记录、哪个关键词、
 *     还是"仓库内置内容"），界面上另有「本地组装 / 本地记录」标注；
 *   · 没有数据就给空状态，不填充假数据。
 *
 * 文案来源：本文件不新写心理建议。建议/解释文案一律取自仓库已有的
 *   · src/data/questionnaireData.ts 里各量表的 scoring() 分档描述
 *   · src/data/mockData.ts 的 actionPlan / ragReport
 *   · personal-backend/app/services/recommendation_agent.py 的种子条目（由后端接口返回）
 *   · personal-backend/app/services/llm_client.py 的 _MOCK_* 关键词表（关键词，不是建议）
 */

import { questionnaires } from '../data/questionnaireData';
import { actionPlan, type PersonalScreeningRecord } from '../data/mockData';
import type { GraphData } from './api';
import { getScreeningRecords } from './mockApi';

/* ────────────────────────────── 本地三元组存储 ────────────────────────────── */

/** 本机三元组结构：与后端 KG 的三元组同语义，只是存在浏览器里 */
export interface LocalTriple {
  /** 主语：永远是用户本人 */
  head: string;
  /** 关系名：沿用后端本体（LIKES / SHOWS_SYMPTOM / EXPERIENCED_EMOTION / ...） */
  relation: string;
  /** 宾语：兴趣、症状、情绪、事件等 */
  tail: string;
  /** 写入时间（ISO），与后端边的 updated_at 对齐 */
  at: string;
  /** 兴趣类别（LIKES/FOLLOWS 才有），图谱配色用 */
  category?: string | null;
}

export interface LocalKgStore {
  triples: LocalTriple[];
  updatedAt: string;
}

const KEY_PREFIX = 'psych_kg:v1:';
const EMPTY: LocalKgStore = { triples: [], updatedAt: '' };

export function localKgKey(username: string): string {
  return `${KEY_PREFIX}${username || 'demo_user'}`;
}

export function readLocalKg(username: string): LocalKgStore {
  try {
    const raw = localStorage.getItem(localKgKey(username));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as LocalKgStore;
    return {
      triples: Array.isArray(parsed?.triples) ? parsed.triples : [],
      updatedAt: parsed?.updatedAt ?? '',
    };
  } catch {
    /* 隐私模式或数据损坏：当作"本机还没有记录"，不阻断页面 */
    return { ...EMPTY };
  }
}

/** 后端抽取结果里的三元组形状（object 即本地结构里的 tail） */
export interface ExtractedTriple {
  relation: string;
  object: string;
  category?: string | null;
  /** 情绪强度之类的取值（后端 Triple.value），离线抽取时同样带上 */
  value?: string | number | null;
}

/**
 * 追加三元组（按 head+relation+tail 去重，重复出现的只更新 at）。
 * 返回写入后的整份本地记录，方便调用方直接渲染"已记录 N 条"。
 */
export function appendLocalTriples(
  username: string,
  triples: ExtractedTriple[],
  at: string = new Date().toISOString(),
): LocalKgStore {
  const store = readLocalKg(username);
  const merged = [...store.triples];
  for (const item of triples) {
    if (!item?.relation || !item?.object) continue;
    const index = merged.findIndex(
      (t) => t.relation === item.relation && t.tail === item.object,
    );
    const entry: LocalTriple = {
      head: '我',
      relation: item.relation,
      tail: item.object,
      at,
      category: item.category ?? null,
    };
    if (index >= 0) merged[index] = { ...merged[index], ...entry };
    else merged.push(entry);
  }
  const next: LocalKgStore = { triples: merged, updatedAt: at };
  try {
    localStorage.setItem(localKgKey(username), JSON.stringify(next));
  } catch {
    /* 写不进去（隐私模式/配额）也不报错：本次会话仍能显示，刷新后会丢，页面另有说明 */
  }
  return next;
}

/* ────────────────────────── 本地关键词（补充记录用） ────────────────────────── */

/**
 * 关键词表来自后端 mock 抽取器（personal-backend/app/services/llm_client.py 的
 * _MOCK_SYMPTOMS / _MOCK_EMOTIONS / _MOCK_EVENTS），是"词汇"不是"建议文案"。
 * 本机没有服务端可调时，用同一套词从补充记录里认出用户提到的关注点。
 */
const LOCAL_SYMPTOMS = ['失眠', '焦虑', '抑郁', '情绪低落', '注意力下降', '注意力不集中', '食欲下降', '疲惫', '心慌', '压力大'];
const LOCAL_EMOTIONS = ['难过', '伤心', '低落', '沮丧', '焦虑', '紧张', '烦躁', '不安', '开心', '高兴', '平静'];
const LOCAL_EVENTS = ['考试', '挂科', '面试', '分手', '失恋', '搬家', '开学', '毕业', '加班', '答辩'];

/** 从一段自由文字里认出关注点（纯关键词命中，不做任何推测） */
export function keywordsIn(text?: string | null): { symptoms: string[]; emotions: string[]; events: string[] } {
  const source = text ?? '';
  const hit = (words: string[]) => words.filter((w) => source.includes(w));
  return { symptoms: hit(LOCAL_SYMPTOMS), emotions: hit(LOCAL_EMOTIONS), events: hit(LOCAL_EVENTS) };
}

/** 兴趣词 → 名称/类别（后端 _MOCK_INTERESTS 的同款词表，用于离线抽取） */
const LOCAL_INTERESTS: Record<string, { name: string; category: string }> = {
  民谣: { name: '民谣', category: '音乐' },
  流行: { name: '流行音乐', category: '音乐' },
  摇滚: { name: '摇滚乐', category: '音乐' },
  周杰伦: { name: '周杰伦', category: '音乐' },
  林俊杰: { name: '林俊杰', category: '音乐' },
  陈奕迅: { name: '陈奕迅', category: '音乐' },
  演唱会: { name: '看演唱会', category: '音乐' },
  NBA: { name: 'NBA', category: '体育赛事' },
  篮球: { name: '篮球', category: '体育赛事' },
  足球: { name: '足球', category: '体育赛事' },
  世界杯: { name: '世界杯', category: '体育赛事' },
  打游戏: { name: '电子游戏', category: '游戏' },
  看电影: { name: '看电影', category: '影视' },
  追剧: { name: '追剧', category: '影视' },
};

/** 情绪词 → 强度（与后端 _MOCK_EMOTIONS 同一套取值） */
const LOCAL_EMOTION_VALUES: Record<string, string> = {
  开心: '8', 高兴: '8', 兴奋: '9', 平静: '6',
  难过: '3', 伤心: '3', 低落: '3', 沮丧: '3',
  焦虑: '4', 紧张: '4', 烦躁: '4', 不安: '4',
};

/**
 * 离线抽取：服务端 /kg/extract 拿不到时，用同一套关键词规则从用户自己的话里整理三元组。
 * 只做"提到什么就记什么"，不推测、不补全 —— 与后端 mock 抽取器口径一致。
 */
export function triplesFromText(text: string): ExtractedTriple[] {
  const out: ExtractedTriple[] = [];
  for (const [kw, item] of Object.entries(LOCAL_INTERESTS)) {
    if (text.includes(kw)) {
      const followed = ['关注', '追', '看比赛', '赛季'].some((w) => text.includes(w));
      out.push({ relation: followed ? 'FOLLOWS' : 'LIKES', object: item.name, category: item.category });
    }
  }
  for (const kw of LOCAL_SYMPTOMS) if (text.includes(kw)) out.push({ relation: 'SHOWS_SYMPTOM', object: kw });
  for (const [kw, value] of Object.entries(LOCAL_EMOTION_VALUES)) {
    if (text.includes(kw)) out.push({ relation: 'EXPERIENCED_EMOTION', object: kw, value });
  }
  for (const kw of LOCAL_EVENTS) if (text.includes(kw)) out.push({ relation: 'EXPERIENCED_EVENT', object: kw });
  return out;
}

/* ──────────────────────────── 本地数据汇总 ──────────────────────────── */

/** 关系名 → 图谱节点类型（与后端 GraphNode.label 的取值保持一致） */
const RELATION_LABEL: Record<string, string> = {
  LIKES: 'Interest',
  FOLLOWS: 'Interest',
  EXPERIENCED_EMOTION: 'Emotion',
  SHOWS_SYMPTOM: 'Symptom',
  EXPERIENCED_EVENT: 'LifeEvent',
  HAS_TRIGGER: 'Trigger',
  RESPONDS_TO: 'Coping',
};

/** 把本机三元组画成 GraphData 形状（KgPage 的 SVG 直接吃这个结构） */
export function localGraph(username: string): GraphData {
  const { triples } = readLocalKg(username);
  const nodes = new Map<string, GraphData['nodes'][number]>();
  const links: GraphData['links'] = [];
  const userId = username || 'demo_user';
  nodes.set(userId, { id: userId, name: userId, label: 'User' });
  for (const t of triples) {
    const label = RELATION_LABEL[t.relation] ?? 'Unknown';
    const nodeId = `${label}:${t.tail}`;
    nodes.set(nodeId, {
      id: nodeId,
      name: t.tail,
      label,
      category: t.category ?? null,
    });
    links.push({ source: userId, target: nodeId, relation: t.relation, category: null });
  }
  return { user_id: userId, nodes: [...nodes.values()], links, neo4j_connected: false, local: true };
}

/**
 * 合并"服务端图谱"与"本机图谱"。
 * 服务端有数据时以它为准，本机三元组只补充服务端还没有的节点/边（同一 relation+tail 视为同一条），
 * 这样将来接上 Neo4j 也不会出现两份重复的图。
 */
export function mergeGraphs(server: GraphData | null, local: GraphData | null): GraphData | null {
  if (!server) return local;
  if (!local) return server;
  const nodes = new Map(server.nodes.map((n) => [n.id, n]));
  const links = [...server.links];
  for (const node of local.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
  for (const link of local.links) {
    if (!links.some((l) => l.target === link.target && l.relation === link.relation)) links.push(link);
  }
  return { ...server, nodes: [...nodes.values()], links, local: local.nodes.length > 1 };
}

/** 最近一条"已完成"的本机筛查记录（列表里若有仓库样例，按日期取最新的一条） */
export function latestCompletedRecord(records: PersonalScreeningRecord[]): PersonalScreeningRecord | undefined {
  return records
    .filter((r) => r.status === 'completed')
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

/** 本地信号：图谱页/推送页/报告都用这一份，保证三处口径一致 */
export interface LocalSignals {
  records: PersonalScreeningRecord[];
  latest?: PersonalScreeningRecord;
  /** 最近一条记录的分档解释（文案取自 questionnaireData 的 scoring()） */
  latestResult?: { scaleId: string; scaleName: string; label: string; description: string };
  /** 补充记录 / 对话三元组里认出的关注点 */
  keywords: { symptoms: string[]; emotions: string[]; events: string[] };
  triples: LocalTriple[];
}

export async function collectLocalSignals(username: string): Promise<LocalSignals> {
  let records: PersonalScreeningRecord[] = [];
  try {
    records = await getScreeningRecords();
  } catch {
    /* 拿不到记录（后端挂了也不该影响本地页面）：按"没有记录"处理 */
    records = [];
  }
  const latest = latestCompletedRecord(records);
  const definition = latest
    ? questionnaires.find((q) => q.id === latest.questionnaire || q.name === latest.questionnaire)
    : undefined;
  const store = readLocalKg(username);
  const supplements = records
    .map((r) => r.supplement?.text ?? '')
    .concat(store.triples.map((t) => t.tail))
    .join(' ');

  return {
    records,
    latest,
    latestResult:
      latest && definition
        ? {
            scaleId: definition.id,
            scaleName: definition.name,
            label: definition.scoring(latest.score).label,
            description: definition.scoring(latest.score).description,
          }
        : undefined,
    keywords: keywordsIn(supplements),
    triples: store.triples,
  };
}

/**
 * 取一条补充记录在某个模态下的「可检索文本」。
 *
 * 为什么必须只有这一处：首页「最近一次输入」与检索页历史记录展示的是同一条内容，
 * 各写一套必然走样（用户 2026-10-14 明确要求"最后一个输入"要跟历史记录里的
 * 模态文字描述一致）。两处都调这个函数。
 *
 * 优先级（拿到什么写什么，绝不为凑格式编内容）：
 *   1. 文字补充 → 原文；
 *   2. 音频 / 图片补充自带的描述（上传时后端 / 演示引擎返回的分析文案）→
 *      与语料行同一套前缀：「语音片段特征：…」「记录到的非言语线索：…」；
 *   3. 没有描述 → 如实回退成文件名（"我上传的语音：xxx.wav"），
 *      指定了另一个模态但这条补充不是该模态时 → "…：暂无文字描述"。
 *
 * @param supplement 记录（或首次引导草稿）上的补充内容
 * @param modality   想要哪个模态的文本；缺省按 supplement.kind
 */
export function supplementModalityText(
  supplement:
    | { kind: 'text' | 'audio' | 'image'; text?: string; filename?: string; description?: string }
    | null
    | undefined,
  modality?: 'text' | 'audio' | 'image',
): string {
  if (!supplement) return '';
  const kind = modality ?? supplement.kind;
  const isSameModality = supplement.kind === kind;

  if (kind === 'text') {
    return isSameModality ? (supplement.text ?? '').trim() : '';
  }

  const label = kind === 'audio' ? '语音片段特征' : '记录到的非言语线索';
  const description = isSameModality ? (supplement.description ?? '').trim() : '';
  if (description) return `${label}：${description}`;
  if (isSameModality) {
    return `我上传的${kind === 'audio' ? '语音' : '图片'}：${supplement.filename ?? '（未命名）'}`;
  }
  return `${label}：暂无文字描述`;
}

/* ─────────────────── 本地报告 / 本地推送 / 本地问询（兜底） ─────────────────── */

/** 与后端 CopingRecommendation 对齐的一份建议 */
export interface LocalAdvice {
  name: string;
  category?: string | null;
  suggestion: string;
  /** 这条建议从哪来（界面上直接展示，必须能说清） */
  reason: string;
}

const LOCAL_REASON = '本地组装 · 来自本机记录（非服务端推理）';

/**
 * 本机报告：服务端推理拿不到时，用本机数据组装一份同结构的报告。
 * 结构与后端 /inference/run 的 report 保持一致，页面可以复用同一个渲染分支。
 */
export function buildLocalReport(username: string, signals: LocalSignals): {
  report: {
    user_id: string;
    risk_level: 'green' | 'yellow' | 'orange' | 'red';
    risk_label: string;
    overall_score: number;
    crisis: boolean;
    factors: string[];
    matched_disorders: never[];
    recommendations: LocalAdvice[];
    summary: string;
    disclaimer: string;
    alert_created: boolean;
    created_at: string;
    local: true;
  };
  content_feed: LocalAdvice[];
} {
  const factors: string[] = [];
  if (signals.latest && signals.latestResult) {
    factors.push(
      `本机筛查记录「${signals.latestResult.scaleId} ${signals.latest.score}/${signals.latest.maxScore}」` +
        `（${signals.latest.date}）→ ${signals.latestResult.label}`,
    );
  }
  if (signals.triples.length) {
    const tails = signals.triples.map((t) => t.tail).slice(0, 6);
    factors.push(`本机对话/补充记录里的线索：${tails.join('、')}（共 ${signals.triples.length} 条）`);
  }
  const kw = signals.keywords;
  if (kw.symptoms.length || kw.emotions.length) {
    factors.push(
      `补充记录中提到的关注点：${[...kw.symptoms, ...kw.emotions].slice(0, 6).join('、')}`,
    );
  }
  if (!factors.length) {
    factors.push('本机还没有筛查记录与对话记录，暂时没有可用于组装的个人数据');
  }

  /* 结论只敢取"最近一条本机记录的等级"：这是本机真实存在的数据，不是重新评估出来的 */
  const level = (signals.latest?.level ?? 'green') as 'green' | 'yellow' | 'orange' | 'red';
  const labels: Record<string, string> = {
    green: '绿（正常）',
    yellow: '黄（关注）',
    orange: '橙（预警）',
    red: '红（危机）',
  };

  const recommendations: LocalAdvice[] = [];
  if (signals.latestResult) {
    recommendations.push({
      name: `${signals.latestResult.scaleId} 结果提示：${signals.latestResult.label}`,
      category: signals.latestResult.scaleId,
      suggestion: signals.latestResult.description,
      reason: LOCAL_REASON,
    });
  }
  /* 行动计划文案取自仓库内置的 mockData.actionPlan（不是按你的数据排出来的） */
  for (const plan of actionPlan.slice(0, 2)) {
    recommendations.push({
      name: plan.title,
      category: '行动计划',
      suggestion: `建议时长 ${plan.duration}`,
      reason: '本地组装 · 仓库内置行动计划（未按你的数据排序）',
    });
  }

  const summaryParts: string[] = [];
  summaryParts.push(
    signals.latestResult
      ? `本报告由本机记录组装（服务端推理不可用）：最近一条筛查记录为 ${signals.latestResult.scaleId} ` +
        `${signals.latest?.score}/${signals.latest?.maxScore}，分档为${signals.latestResult.label}。`
      : '本报告由本机记录组装（服务端推理不可用）：本机暂时没有可用的量表记录。',
  );
  if (signals.latestResult) summaryParts.push(signals.latestResult.description);
  if (recommendations.length) {
    summaryParts.push(`可以参考：${recommendations.map((r) => r.name).join('；')}。`);
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    report: {
      user_id: username,
      risk_level: level,
      risk_label: labels[level] ?? labels.green,
      overall_score: 0, // 没跑评分：0 表示"未评分"，不表示"很健康"
      crisis: level === 'red',
      factors,
      matched_disorders: [],
      recommendations,
      summary: summaryParts.join('\n'),
      disclaimer:
        '本报告由本机记录组装，仅作参考，不构成医学诊断。如有需要请联系学校心理咨询中心或专业医疗机构。',
      alert_created: false,
      created_at: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      local: true,
    },
    content_feed: recommendations,
  };
}

/**
 * 本机推送：服务端内容也拿不到时，用本机数据生成条目。
 * 文案全部来自仓库已有内容（量表分档描述 / 行动计划），条数不足就给空数组，不凑数。
 */
export function buildLocalFeed(signals: LocalSignals): LocalAdvice[] {
  const items: LocalAdvice[] = [];
  if (signals.latest && signals.latestResult) {
    items.push({
      name: `${signals.latestResult.scaleName}：${signals.latestResult.label}`,
      category: signals.latestResult.scaleId,
      suggestion: signals.latestResult.description,
      reason: `本地生成 · 来自本机筛查记录 ${signals.latest.id}（${signals.latest.date}）`,
    });
  }
  const kw = [...signals.keywords.symptoms, ...signals.keywords.emotions];
  if (kw.length) {
    items.push({
      name: `你最近提到的：${kw.slice(0, 4).join('、')}`,
      category: '本地记录',
      suggestion:
        '这些词来自你本机的补充记录与对话抽取结果，可以在「AI 陪伴对话」里继续补充，图谱会随记录生长。',
      reason: '本地生成 · 本机关键词命中（未做任何推断）',
    });
  }
  for (const plan of actionPlan.slice(0, 2)) {
    items.push({
      name: plan.title,
      category: '行动计划',
      suggestion: `建议时长 ${plan.duration}`,
      reason: '本地生成 · 仓库内置行动计划（未按你的数据排序）',
    });
  }
  return items;
}

/**
 * 本机日常问询（服务端 /checkin/daily 拿不到时的兜底）。
 * 文案逐条取自后端 CHECKIN_TEMPLATES / DEFAULT_CHECKINS
 * （personal-backend/app/services/daily_checkin_agent.py），不新写心理建议。
 */
const CATEGORY_CHECKINS: Record<string, string> = {
  音乐: '今天有没有听到什么好听的歌？或者有没有想听的音乐？🎵',
  体育赛事: '最近有没有关注什么比赛？支持的球队最近表现怎么样？🏀',
  影视: '最近有没有看什么好看的电影或剧集？🎬',
  书籍: '最近在读什么书？有没有哪本让你印象深刻？📚',
  美食: '今天有没有吃到什么好吃的美食？😋',
  运动: '今天有没有做什么运动？感觉怎么样？🏃',
  游戏: '最近有没有玩什么游戏？有什么好玩的推荐吗？🎮',
};

const DEFAULT_CHECKINS = [
  '今天过得怎么样？有什么想聊的吗？😊',
  '今天有没有遇到让你开心的小事？✨',
  '今天心情怎么样？想分享一下吗？🌤️',
];

export function buildLocalCheckin(signals: LocalSignals): string {
  const categories = signals.triples
    .filter((t) => t.relation === 'LIKES' || t.relation === 'FOLLOWS')
    .map((t) => t.category)
    .filter((c): c is string => Boolean(c));
  for (const category of categories) {
    const template = CATEGORY_CHECKINS[category];
    if (template) return template;
  }
  return DEFAULT_CHECKINS[new Date().getDate() % DEFAULT_CHECKINS.length];
}
