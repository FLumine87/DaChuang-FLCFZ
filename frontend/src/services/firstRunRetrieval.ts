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
 * 哈希参考只来自主后端 /api/personal/search 或已保存补充的真实检索结果。
 * matched_disorders 来自个人图谱匹配，单独标注为图谱参考，不是哈希结果。
 * 量表同步、补充抽取完成后才运行图谱推理，避免读到上一次记录。
 */

import { api } from './api';
import type { CopingRecommendation, MatchedDisorder, RiskReport } from './api';
import type { ScreeningRetrievalSnapshot } from '../data/mockData';
import { search, type CollectionAnalysis } from './mockApi';
import { USE_MOCK } from './http';

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
  hashRequested?: boolean;
  hashMode?: BackendMode;
  hashResults?: HashReference[];
  hashError?: string;
  hashOmitted?: number;
  scaleSyncError?: string;
}

export interface HashReference {
  id: string;
  summary: string;
  similarity: number;
  modality?: string;
  tags: string[];
}

interface EvidenceOptions {
  recordId?: string;
  scaleId?: string;
  score?: number;
  savedAnalysis?: CollectionAnalysis;
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
async function fetchFirstRunEvidence(
  userId: string,
  supplement?: string,
  options: EvidenceOptions = {},
): Promise<FirstRunEvidence> {
  const health = await probeBackend();

  const empty: FirstRunEvidence = {
    mode: health.mode,
    neo4jConnected: health.neo4jConnected,
    inferenceOk: false,
    matchedOmitted: 0,
  };

  const text = supplement?.trim();
  const result: FirstRunEvidence = { ...empty };
  // Main hash backend and personal KG are independent services; a KG outage
  // must not hide a successful hash retrieval (or be mislabeled as one).
  const hashTask = async () => {
    const saved = options.savedAnalysis;
    result.hashRequested = Boolean(saved || text);
    if (!result.hashRequested) return;
    try {
      const response = saved ? null : await search(text!, { modality: 'text' });
      const rows = saved?.hits ?? response?.results ?? [];
      const rawIndex = saved?.index ?? response?.index;
      const index = rawIndex && typeof rawIndex === 'object' ? rawIndex as Record<string, unknown> : {};
      if (index.source === 'unavailable') throw new Error('参考检索暂不可用');
      result.hashResults = rows.slice(0, MAX_ROWS).map(row => ({
        id: row.id, summary: row.summary ?? '', similarity: row.similarity,
        modality: row.modality, tags: row.tags ?? [],
      }));
      result.hashOmitted = Math.max(0, rows.length - MAX_ROWS);
      result.hashMode = USE_MOCK || index.mode === 'mock' || index.source === 'mock' || index.data_source === 'demo' ? 'mock' : 'live';
    } catch (error) {
      result.hashMode = 'unreachable';
      result.hashError = briefError(error);
    }
  };
  const graphTask = async () => {
    if (health.mode === 'unreachable') return;
    let prerequisitesReady = true;
    if (options.scaleId && typeof options.score === 'number') {
      try {
        const sync = await api.submitScaleScore(userId, options.scaleId, options.score, false);
        if (!sync.written && health.neo4jConnected) {
          result.scaleSyncError = '本次量表尚未写入图谱，未运行可能使用旧数据的图谱分析';
          prerequisitesReady = false;
        }
      } catch (error) {
        result.scaleSyncError = briefError(error);
        prerequisitesReady = false;
      }
    }
    if (text) {
      try {
        const extraction = await api.extract(userId, text.slice(0, MAX_EXTRACT_CHARS));
        result.triples = {
          triples: extraction.triples ?? [], written: extraction.written ?? 0,
          neo4jConnected: Boolean(extraction.neo4j_connected), mock: Boolean(extraction.mock),
        };
        if (health.neo4jConnected && extraction.triples.length > 0 && !extraction.written) {
          result.triplesError = '本次补充尚未写入图谱，未运行可能使用旧数据的图谱分析';
          prerequisitesReady = false;
        }
      } catch (error) {
        result.triplesError = briefError(error);
        prerequisitesReady = false;
      }
    }
    if (!prerequisitesReady) {
      result.inferenceError = result.scaleSyncError ?? result.triplesError;
      return;
    }
    try {
      const inference = await api.runInference(userId);
      result.inferenceOk = Boolean(inference.report);
      result.report = inference.report;
      result.contentFeed = inference.content_feed ?? [];
      result.matchedOmitted = Math.max(0, (inference.report?.matched_disorders?.length ?? 0) - MAX_ROWS);
    } catch (error) {
      result.inferenceError = briefError(error);
    }
  };
  await Promise.allSettled([hashTask(), graphTask()]);
  return result;
}

/** Share a running request across React StrictMode mounts; do not cache stale results. */
const pendingEvidence = new Map<string, Promise<FirstRunEvidence>>();
export function loadFirstRunEvidence(userId: string, supplement?: string, options: EvidenceOptions = {}): Promise<FirstRunEvidence> {
  const key = JSON.stringify([userId, supplement, options.recordId, options.scaleId, options.score]);
  const pending = pendingEvidence.get(key);
  if (pending) return pending;
  const request = fetchFirstRunEvidence(userId, supplement, options);
  pendingEvidence.set(key, request);
  const clear = () => { if (pendingEvidence.get(key) === request) pendingEvidence.delete(key); };
  void request.then(clear, clear);
  return request;
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
  const hashRows = evidence.hashResults ?? [];
  if ((!evidence.inferenceOk || !report) && hashRows.length === 0) {
    return {
      at,
      mode: 'unavailable',
      reason:
        evidence.hashError ?? evidence.inferenceError ??
        (evidence.hashRequested ? '本次未取得参考结果' : '未补充检索材料，本次仅有量表结果'),
    };
  }
  return {
    at,
    mode: hashRows.length ? (evidence.hashMode === 'mock' ? 'mock' : 'live') : evidence.mode === 'mock' || report?.mock ? 'mock' : 'live',
    matches: hashRows.slice(0, MAX_SNAPSHOT_MATCHES).map((row) => ({
      name: `哈希参考 ${row.id}`,
      score: row.similarity,
    })),
    summary: [hashRows.length ? `哈希召回 ${hashRows.length} 条候选参考，相似度不作为本人风险分数。` : '本次未取得哈希候选。', report?.summary ? `图谱参考：${report.summary}` : ''].filter(Boolean).join('\n'),
    advice: (report?.recommendations ?? []).map((rec) =>
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
