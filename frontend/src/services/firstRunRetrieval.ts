/**
 * firstRunRetrieval.ts
 * 首次引导 03「分析依据」标签里的真实数据来源。
 *
 * 为什么单独一层而不直接写在页面里：
 *   「后端能不能用、处于哪种模式、要调哪几个接口、失败了怎么降级」是一套
 *   需要集中判断的规则，散在 JSX 里会到处都是 try/catch。页面只消费
 *   这里返回的 FirstRunEvidence，不再自己判断后端状态。
 *
 * 三种模式（由 GET /api/v1/health 判定，见 loadFirstRunEvidence）：
 *   'unreachable' 后端不可达 → 页面如实写"未接入"，不去猜也不去编
 *   'mock'        后端可达但 mock_mode=true → 调接口拿**带 mock 标记**的报告
 *                 （模板文案 + 本地记录 + 仓库内置内容），界面一律标注
 *                 「演示模式 · 模板生成」，绝不让人误以为是真实检索/LLM 输出
 *   'live'        后端可达且 mock_mode=false → 调真实接口，拿不到就是拿不到
 *
 * 关键约束（用户反复强调）：绝不编造数据。
 *   任何一条线索都必须来自接口真实返回；接口没有的字段就不展示，
 *   不做"相似度"之类的本地估算，也不为凑数填占位内容。
 *
 * 关于接口字段与界面文案的对应关系（接口确实没有专门的"参考资料来源"字段）：
 *   · 动态跨模态哈希检索 → 用推理返回的 matched_disorders
 *     （name / matched_symptoms / matched_triggers / score / coverage），
 *     这是后端侧唯一"命中的相似线索"结构化结果，按相似度（score）降序展示。
 *   · RAG 参考资料 → 用 report.factors（可解释风险因素）与
 *     recommendations[].reason（该建议的由来），这两项正是后端从
 *     个人 KG + 领域 KG 里取出来的依据，字段名就写在 schema 里。
 *     没有 sources/references 这种字段，所以不硬凑，也不假装是文献引用。
 *   · 知识关联 → POST /kg/extract 的真实返回三元组（仅在有补充文字时）
 */

import { api } from './api';
import type { CopingRecommendation, MatchedDisorder, RiskReport } from './api';
import type { ScreeningRetrievalSnapshot } from '../data/mockData';

/** 展示用的条数上限：条目多时只给前几条，其余在界面上注明"其余略" */
export const MAX_ROWS = 5;
export const MAX_FACTORS = 4;
export const MAX_TRIPLES = 6;
/** 送去抽取实体/关系的正文字数上限，避免超长 prompt */
export const MAX_EXTRACT_CHARS = 500;

export type BackendMode = 'unreachable' | 'mock' | 'live';

export interface HealthResult {
  mode: BackendMode;
  neo4jConnected: boolean;
}

export interface TriplesResult {
  /** 后端抽出的实体/关系三元组（原始字段） */
  triples: { subject: string; relation: string; object: string; value?: string | number | null }[];
  /** 成功写入图数据库的条数；Neo4j 未连接时为 0 */
  written: number;
  neo4jConnected: boolean;
  /** 后端处于演示模式：抽取走内置关键词引擎，未写入图数据库 */
  mock?: boolean;
}

/** 本次结果页「分析依据」需要展示的全部真实数据 */
export interface FirstRunEvidence {
  mode: BackendMode;
  neo4jConnected: boolean;
  /** 推理是否成功（后端不可达时恒为 false——没调就不算有） */
  inferenceOk: boolean;
  /** 推理失败时后端给出的原因（如"Neo4j 未连接"），用于如实展示 */
  inferenceError?: string;
  report?: RiskReport;
  /** 缓解推荐 Agent 的内容（与推理同一次调用返回） */
  contentFeed?: CopingRecommendation[];
  /** 命中数超过展示上限时，这里是被略过的条数 */
  matchedOmitted: number;
  /** 知识关联抽取结果；没有补充文字或未调用时为 undefined */
  triples?: TriplesResult;
  triplesError?: string;
}

/**
 * 探活 + 判定模式。
 *
 * 刻意不抛异常：后端不可达是"预期内的一种状态"，不是错误。
 * 页面据此走 unreachable 分支如实说明，而不是弹一个报错。
 */
export async function probeBackend(): Promise<HealthResult> {
  try {
    const health = await api.health();
    return {
      mode: health?.mock_mode ? 'mock' : 'live',
      neo4jConnected: Boolean(health?.neo4j_connected),
    };
  } catch {
    return { mode: 'unreachable', neo4jConnected: false };
  }
}

/** 把后端/网络的错误转成一句克制的、能展示的短句 */
function briefError(reason: unknown): string {
  const raw = (reason instanceof Error ? reason.message : String(reason ?? "")).trim();
  if (!raw) return "检索服务暂不可用";
  /* 后端的 503 detail 常常本身就是给用户看的一句话（如"Neo4j 未连接，无法执行推理"），
     原样沿用；只有纯技术性的报错（HTTP 状态码开头、或又长又生的堆栈）才归一成
     通用说法，避免把技术细节糊到用户脸上。 */
  if (/^请求失败\s*\d{3}/.test(raw)) return "检索服务暂不可用";
  if (raw.length > 120) return `${raw.slice(0, 120)}…`;
  return raw;
}

/**
 * 首次引导 03 页的唯一入口：按模式取「分析依据」所需的真实数据。
 *
 * @param userId      个人 KG 的 user_id（当前用账号名，与其它页面一致）
 * @param supplement  用户在 02 步补充的文字（可选）；有值时顺带抽取知识关联
 */
export async function loadFirstRunEvidence(
  userId: string,
  supplement?: string,
): Promise<FirstRunEvidence> {
  const health = await probeBackend();

  const empty: FirstRunEvidence = {
    mode: health.mode,
    neo4jConnected: health.neo4jConnected,
    inferenceOk: false,
    matchedOmitted: 0,
  };

  /* 后端不可达才不调：mock 模式也要调 —— 后端的 Mock 通路会返回一份 report.mock=true
     的报告（模板正文 + 本地 SQLite 记录 + 仓库内置建议），03 的「RAG 参考资料」
     据此展示真实返回的 summary 与建议，同时由界面标注「演示模式 · 模板生成」。
     拿不到数据时（inferenceError）页面按原口径写明原因，不猜也不编。 */
  if (health.mode === 'unreachable') return empty;

  /* 推理与知识抽取互不依赖，并行发起；任一失败都不影响另一条。
     用 allSettled 而不是 all：分析依据里两条应当各自独立可用。 */
  const text = supplement?.trim();
  const [inference, extraction] = await Promise.allSettled([
    api.runInference(userId),
    text ? api.extract(userId, text.slice(0, MAX_EXTRACT_CHARS)) : Promise.resolve(null),
  ]);

  const result: FirstRunEvidence = { ...empty };

  if (inference.status === 'fulfilled') {
    const report = inference.value?.report;
    result.inferenceOk = Boolean(report);
    result.report = report;
    result.contentFeed = inference.value?.content_feed ?? [];
    result.matchedOmitted = Math.max(0, (report?.matched_disorders?.length ?? 0) - MAX_ROWS);
  } else {
    result.inferenceError = briefError(inference.reason);
  }

  if (extraction.status === 'fulfilled' && extraction.value) {
    result.triples = {
      triples: extraction.value.triples ?? [],
      written: extraction.value.written ?? 0,
      neo4jConnected: Boolean(extraction.value.neo4j_connected),
      mock: Boolean(extraction.value.mock),
    };
  } else if (extraction.status === 'rejected') {
    result.triplesError = briefError(extraction.reason);
  }

  return result;
}

/** matched_disorders 是"命中的相似线索"，按后端给的 score 降序（后端已排好，这里再兜一层） */
export function topMatched(report?: RiskReport, limit = MAX_ROWS): MatchedDisorder[] {
  const rows = report?.matched_disorders ?? [];
  return [...rows].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 快照里最多留几条相似线索（档案详情页只回看，不追求全量） */
export const MAX_SNAPSHOT_MATCHES = 5;

/**
 * 把「本次分析依据」收敛成一条可存进筛查记录的快照（L1：存浏览器本地）。
 *
 * 规则只有一条：**拿到什么存什么**。
 *   · 拿到报告 → 存 summary / 建议 / 命中线索；mode 按来源写 live 或 mock
 *     （mock 一律标注，回看时不会被当成真实推理结果）；
 *   · 没拿到 → mode='unavailable' + 原样原因，不补默认文案。
 */
export function toRetrievalSnapshot(evidence: FirstRunEvidence): ScreeningRetrievalSnapshot {
  const report = evidence.report;
  const at = new Date().toISOString();
  if (!evidence.inferenceOk || !report) {
    return {
      at,
      mode: 'unavailable',
      reason:
        evidence.inferenceError ??
        (evidence.mode === 'unreachable' ? '后端未接入，本次未发起检索' : '本次未取得检索结果'),
    };
  }
  return {
    at,
    mode: evidence.mode === 'mock' || report.mock ? 'mock' : 'live',
    matches: (report.matched_disorders ?? []).slice(0, MAX_SNAPSHOT_MATCHES).map((row) => ({
      name: row.name,
      score: row.score,
      coverage: row.coverage,
      matched_symptoms: row.matched_symptoms ?? [],
      matched_triggers: row.matched_triggers ?? [],
    })),
    summary: report.summary,
    advice: (report.recommendations ?? []).map((rec) =>
      rec.reason ? `${rec.name}：${rec.reason}` : rec.name,
    ),
  };
}

/** 关系的展示名：接口给的是本体里的大写关系名，这里只做显示层的翻译，不加语义 */
export const RELATION_LABEL: Record<string, string> = {
  LIKES: '喜欢',
  FOLLOWS: '关注',
  EXPERIENCED_EMOTION: '情绪',
  SHOWS_SYMPTOM: '症状',
  EXPERIENCED_EVENT: '经历',
  HAS_TRIGGER: '诱因',
  RESPONDS_TO: '应对方式',
};

export function relationLabel(relation: string): string {
  return RELATION_LABEL[relation] ?? relation;
}
