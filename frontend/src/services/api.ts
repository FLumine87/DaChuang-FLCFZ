// 个人端 KG + Agent 服务 API 封装（阶段 3）
// 所有请求指向后端 FastAPI 服务（默认 8001 端口，可用 VITE_API_BASE 覆盖）

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8001';

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
}

export interface ExtractResult {
  user_id: string;
  triples: Triple[];
  written: number;
  neo4j_connected: boolean;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
