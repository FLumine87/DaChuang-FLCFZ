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
}

export interface MatchedDisorder {
  name: string;
  matched_symptoms: string[];
  matched_triggers: string[];
  score: number;
  coverage: number;
}

export interface CopingRecommendation {
  name: string;
  category?: string | null;
  suggestion?: string | null;
  reason: string;
}

export interface RiskReport {
  user_id: string;
  risk_level: 'green' | 'yellow' | 'orange' | 'red';
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

// 量表得分回写（2026-10-12）
export interface ScaleScoreResult {
  user_id: string;
  scale: string;
  score: number;
  written: number;
  neo4j_connected: boolean;
  inference_triggered: boolean;
  report?: {
    risk_level: 'green' | 'yellow' | 'orange' | 'red';
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
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`请求失败 ${resp.status}: ${text.slice(0, 200)}`);
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
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`请求失败 ${resp.status}: ${text.slice(0, 200)}`);
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

  // 阶段 3.5：日常问询 + 兴趣推送
  getDailyCheckin: (userId: string) =>
    request<CheckinMessage>(`/api/v1/checkin/daily?user_id=${encodeURIComponent(userId)}`),

  getInterestFeed: (userId: string, limit = 4) =>
    request<CopingRecommendation[]>(`/api/v1/recommendations/by_interest?user_id=${encodeURIComponent(userId)}&limit=${limit}`),

  // 量表得分回写个人 KG（Screening 页提交后自动调用）
  submitScaleScore: (userId: string, scale: string, score: number, runInference = false) =>
    request<ScaleScoreResult>('/api/v1/kg/scale', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, scale, score, run_inference: runInference }),
    }),
};
