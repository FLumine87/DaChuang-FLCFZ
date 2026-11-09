// 个人端 KG + Agent 服务 API 封装（阶段 3）
// 所有请求指向后端 FastAPI 服务。
//
// 基地址解析顺序（改这里是为了能用上仓库既有的开发代理，而不是绕开它）：
//   1. VITE_API_BASE —— 团队原先的显式覆盖项，保留
//   2. VITE_API_BASE_URL —— 与 http.ts / .env.local 同一套约定
//   3. '' —— 走同源相对路径 /api/v1/...，由 vite.config.ts 的
//      VITE_DEV_PROXY_TARGET（本机 127.0.0.1:8000）代理到 personal-backend。
//      这样 personal-backend 跑在默认 8000 端口时无需改任何代码或 env；
//      若它跑在别的端口（团队 README 写的是 8001），只改 VITE_DEV_PROXY_TARGET 即可。
// 原先硬编码 http://localhost:8001 会让 .env.local 里的代理配置完全失效，
// 且浏览器会跨源直连（localhost vs 127.0.0.1 也不同源）。

import { getToken } from './http';

/* /api/v1/* 由 personal-backend（FastAPI + Neo4j）提供 —— 它和主后端不是同一个服务：
 *   · 开发：vite.config.ts 把 /api/v1 代理到 VITE_PERSONAL_PROXY_TARGET（默认 8001），
 *           所以这里留空、走同源相对路径即可；
 *   · 生产：**打包后没有 Vite 代理**，/api/v1/* 会打到主后端（Cloudflare Worker），
 *           而 Worker 没有这些路由 —— 必须显式给 VITE_PERSONAL_API_BASE，
 *           指向另外部署的 personal-backend，否则这一组功能不可用。
 * 没配时下面 request() 会给出可读提示，而不是让它 404 裸报错。 */
const PERSONAL_BASE = (import.meta.env.VITE_PERSONAL_API_BASE as string | undefined) ?? '';
export const PERSONAL_API_READY = import.meta.env.DEV || Boolean(PERSONAL_BASE);

const BASE = PERSONAL_BASE
  ? PERSONAL_BASE
  : import.meta.env.DEV
    ? ((import.meta.env.VITE_API_BASE as string | undefined) ??
       (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
       '')
    : '';

/* 个人端后端（8001）已加鉴权：所有业务接口都要求带上主服务端登录时签发的
   Bearer JWT，并校验「令牌身份 == 请求里的 user_id」。
   这里复用 http.ts 里那份 token（localStorage / sessionStorage 各存一份，
   登录时写入、登出时清除），保证与主后端请求用的是同一枚凭证。
   为什么不用 http.ts 的 axios 实例：这一组接口走的是 VITE_PERSONAL_API_BASE /
   开发代理的另一台服务，且要支持 SSE 流式，fetch 更直接。 */
function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 把个人端的鉴权失败翻译成用户能看懂的一句话。
 *
 * 为什么单独处理：改造前接口无鉴权，改造后若用户处于「演示登录」（mock token，
 * 签名后端不认）或凭证已过期，页面会拿到一个 401，若不拦就会
 * 把裸 JSON 渲染上屏。这里给一句能直接显示的说明，其余状态码照旧。
 */
function authErrorMessage(status: number, raw: string): string {
  if (status === 401) return '登录已过期或当前为演示登录，请重新登录后使用个性化功能';
  if (status === 403) return '无权访问他人的个人数据（当前登录账号与目标用户不一致）';
  return `请求失败 ${status}: ${raw.slice(0, 200)}`;
}

export interface Triple {
  subject: string;
  relation: string;
  object: string;
  category?: string | null;
  value?: string | number | null;
}

export interface GraphNode {
  id: string;
  name: string;
  label: string;
  category?: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
  category?: string | null;
}

export interface GraphData {
  user_id: string;
  nodes: GraphNode[];
  links: GraphLink[];
  neo4j_connected: boolean;
  /** 后端处于 Mock（演示）模式：界面据此标注来源，不把演示结果说成图谱数据 */
  mock?: boolean;
  /** 前端本地拼出来的补充图谱（L1：localStorage 里的三元组） */
  local?: boolean;
}

export interface ExtractResult {
  user_id: string;
  triples: Triple[];
  written: number;
  neo4j_connected: boolean;
  /** 后端处于 Mock（演示）模式：抽取走内置关键词引擎，也未写入图数据库 */
  mock?: boolean;
  /**
   * 本次文本中直检到的安全线索关键词（后端在**原文**上扫描，不经语义归一）。
   * 非空表示这是一次真实的危机表达，界面应立即给出求助指引 ——
   * 不能等推理报告生成（报告要跑几十秒的 LLM，且危机信号可能被归一掉）。
   */
  crisis_hits?: string[];
}

export interface MatchedDisorder {
  name: string;
  matched_symptoms: string[];
  matched_triggers: string[];
  /** 加权匹配分：Σ 症状特异性权重 + Σ 诱因权重 */
  score: number;
  /**
   * 该障碍的症状被命中比例，仅描述"线索覆盖面"。
   * 注意：**不是患病概率，也不是与本人的相似度** —— 界面上不要只写"覆盖 X%"。
   */
  coverage: number;
  /** 命中症状的平均特异性（IDF）：越高说明命中的越是指向性症状 */
  specificity?: number;
  /** 未按特异性加权的原始匹配分 */
  raw_score?: number;
}

export interface CopingRecommendation {
  name: string;
  category?: string | null;
  suggestion?: string | null;
  reason: string;
}

export interface RiskReport {
  user_id: string;
  risk_level: 'green' | 'yellow' | 'orange' | 'red' | 'unknown';
  reference_only?: boolean;
  source?: 'knowledge_graph' | string;
  risk_label: string;
  overall_score: number;
  crisis: boolean;
  factors: string[];
  matched_disorders: MatchedDisorder[];
  recommendations: CopingRecommendation[];
  summary: string;
  disclaimer: string;
  alert_created: boolean;
  created_at: string;
  /** 后端 Mock 通路（模板 / 本地记录组装）生成的报告，不是图谱推理结果 */
  mock?: boolean;
  /** 前端本机组装（服务端推理不可用时的兜底） */
  local?: boolean;
  /**
   * 安全线索是否来自本人近期直接表达。true 才应给出即时求助指引；
   * false 表示只是图谱里的历史线索，需核实，不渲染成当前已确认危机。
   */
  crisis_verified?: boolean;
  /** 安全线索出处：'text'=本次文本直检、'graph'=历史图谱节点 */
  crisis_sources?: string[];
  /** 未能归一、因而没参与匹配的个人记录名（词典未覆盖，界面应如实提示） */
  unmapped_terms?: string[];
}

export interface InferenceRunResult {
  report: RiskReport;
  content_feed: CopingRecommendation[];
}

export interface AlertItem {
  id: number;
  user_id: string;
  level: 'orange' | 'red';
  title: string;
  reason?: string | null;
  status: 'pending' | 'confirmed' | 'processing' | 'closed';
  created_at: string;
  updated_at: string;
}

// 日常问询（阶段 3.5）
export interface CheckinMessage {
  user_id: string;
  message: string;
  neo4j_connected: boolean;
}

// 每日问询记录（当天首次进入 AI 陪伴对话页时落库，前端可拉取；2026-11-07 打通"生成即送达"的闭环）
export interface DailyCheckinItem {
  id: number;
  user_id: string;
  message: string;
  /** declined = 用户明确「不想回复」：今天不再打扰，也不再出现在待回复列表 */
  status: 'pending' | 'replied' | 'declined' | 'expired';
  reply: string;
  source: string;
  checkin_date: string;
  created_at: string;
  replied_at: string;
}

export interface CheckinPendingResult {
  user_id: string;
  pending: DailyCheckinItem[];
  count: number;
  neo4j_connected: boolean;
}

export interface CheckinReplyResult {
  checkin: DailyCheckinItem;
  extracted: number;
  neo4j_connected: boolean;
  mock: boolean;
}

/** 登录触发「今日问询」的返回：created=false 表示今天已有，直接复用 */
export interface DailyCheckinEnsureResult {
  user_id: string;
  created: boolean;
  checkin: DailyCheckinItem | null;
  message: string;
  expired: number;
  neo4j_connected: boolean;
}

// 量表得分回写（2026-10-12）
export interface ScaleScoreResult {
  user_id: string;
  scale: string;
  score: number;
  written: number;
  neo4j_connected: boolean;
  inference_triggered: boolean;
  report?: {
    risk_level: 'green' | 'yellow' | 'orange' | 'red' | 'unknown';
    reference_only?: boolean;
    source?: string;
    risk_label: string;
    overall_score: number;
    crisis: boolean;
  } | null;
}

// AI 陪伴对话（2026-10-14：回复改为后端 LLM 生成，此前一直是前端本地随机文案）
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CompanionChatResult {
  user_id: string;
  /** mock=true 时为空串，前端回退本地兜底文案 */
  reply: string;
  mock: boolean;
  /** 本轮回复是否用上了服务端个人知识图谱上下文 */
  kg_context_used: boolean;
}

/**
 * SSE 流式请求：逐帧解析 `data: {...}` 并 yield 解析后的对象。
 * 只用于陪伴对话——大模型生成要 20~30 秒，必须边生成边出。
 */
export async function* streamRequest<T>(
  path: string,
  init?: RequestInit,
): AsyncGenerator<T> {
  if (!PERSONAL_API_READY) {
    throw new Error(
      '知识图谱 / 推理服务未配置：打包版没有开发代理，需要设置 VITE_PERSONAL_API_BASE ' +
        '指向已部署的 personal-backend（FastAPI + Neo4j）。当前构建未设置，这一组功能不可用。',
    );
  }
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(authErrorMessage(resp.status, text));
  }
  if (!resp.body) return;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 帧与帧之间以空行分隔，最后一段可能不完整，留到下一轮再解析
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data) as T;
      } catch {
        // 单帧解析失败不打断整条流
      }
    }
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!PERSONAL_API_READY) {
    throw new Error(
      '知识图谱 / 推理服务未配置：打包版没有开发代理，需要设置 VITE_PERSONAL_API_BASE ' +
        '指向已部署的 personal-backend（FastAPI + Neo4j）。当前构建未设置，这一组功能不可用。',
    );
  }
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(authErrorMessage(resp.status, text));
  }
  return resp.json() as Promise<T>;
}

export const api = {
  extract: (userId: string, text: string) =>
    request<ExtractResult>('/api/v1/kg/extract', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, text }),
    }),

  // AI 陪伴对话：后端 LLM 生成回复（history 为最近几轮，不含本轮 user 消息）
  chatCompanion: (userId: string, message: string, history: ChatTurn[] = []) =>
    request<CompanionChatResult>('/api/v1/chat/companion', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, message, history }),
    }),

  /**
   * AI 陪伴对话（流式）：逐帧返回增量文本，用于打字机效果。
   * 上游断流时后端会发 error 帧（调用方据此转非流式重试），
   * 正常结束是 [DONE] 帧。
   */
  streamChatCompanion: (userId: string, message: string, history: ChatTurn[] = [], signal?: AbortSignal) =>
    streamRequest<{ delta?: string; error?: string }>('/api/v1/chat/companion/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, message, history }),
      signal,
    }),

  getGraph: (userId: string) => request<GraphData>(`/api/v1/kg/graph/${encodeURIComponent(userId)}`),

  /**
   * 删除个人子图里的一个节点（服务端只删"该用户 → 该节点"的边，不影响其他用户）。
   * node_id 可直接传图谱给的 `Label:name`；后端会拆出标签与名字。
   */
  deleteGraphNode: (userId: string, nodeId: string) =>
    request<{ user_id: string; node_id: string; deleted: number; neo4j_connected: boolean; mock?: boolean }>(
      '/api/v1/kg/node/delete',
      { method: 'POST', body: JSON.stringify({ user_id: userId, node_id: nodeId }) },
    ),

  runInference: (userId: string) =>
    request<InferenceRunResult>('/api/v1/inference/run', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  listAlerts: (userId?: string) => {
    const q = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    return request<AlertItem[]>(`/api/v1/alerts${q}`);
  },

  health: () => request<{ status: string; neo4j_connected: boolean; mock_mode: boolean }>('/api/v1/health'),

  // 每日问询（阶段 3.5；2026-11-07 起改为「当天首次登录触发」，一天只问一次）
  getDailyCheckin: (userId: string) =>
    request<CheckinMessage>(`/api/v1/checkin/daily?user_id=${encodeURIComponent(userId)}`),

  /**
   * 登录触发「今日问询」。幂等：今天已有记录时后端直接返回既有那条
   * （created=false），不会重复生成、也不会重复调大模型。
   */
  ensureDailyCheckin: (userId: string) =>
    request<DailyCheckinEnsureResult>(
      `/api/v1/checkin/ensure?user_id=${encodeURIComponent(userId)}`,
      { method: 'POST' },
    ),

  /** 拉取待回复的问询（登录触发落库的那条，此前前端完全拿不到） */
  getPendingCheckins: (userId: string, limit = 5) =>
    request<CheckinPendingResult>(
      `/api/v1/checkin/pending?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
    ),

  /** 回复某条问询：标记已回复并把回复内容抽取进个人图谱 */
  replyCheckin: (checkinId: number, userId: string, reply: string) =>
    request<CheckinReplyResult>(`/api/v1/checkin/${checkinId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, reply }),
    }),

  /**
   * 「不想回复」某条问询：pending → declined（不写任何回复正文）。
   * 流转后该条不再出现在待回复列表，今天也不会再弹窗打扰。
   */
  declineCheckin: (checkinId: number, userId: string) =>
    request<CheckinReplyResult>(`/api/v1/checkin/${checkinId}/decline`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  getCheckinHistory: (userId: string, limit = 20) =>
    request<DailyCheckinItem[]>(
      `/api/v1/checkin/history?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
    ),

  getInterestFeed: (userId: string, limit = 4) =>
    request<CopingRecommendation[]>(`/api/v1/recommendations/by_interest?user_id=${encodeURIComponent(userId)}&limit=${limit}`),

  // 量表得分回写个人 KG（Screening 页提交后自动调用）
  submitScaleScore: (userId: string, scale: string, score: number, runInference = false) =>
    request<ScaleScoreResult>('/api/v1/kg/scale', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, scale, score, run_inference: runInference }),
    }),
};
