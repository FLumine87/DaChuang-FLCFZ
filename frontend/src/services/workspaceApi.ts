import { request } from './http';

export type Scope = 'demo' | 'live';
export type AiStatus = 'generated' | 'disabled' | 'not_configured' | 'unavailable' | 'live_rules' | 'no_data';
export interface Event { at: string; actor: string; action: string; note: string }
export interface Task {
  id: string; subject: string; title: string; state: string; assignee: string;
  due_at: string; version: number; events: Event[];
}
export interface Subject {
  subject: string; ref: string; department: string; questionnaire: string;
  score: number; max_score: number; alert_level: string; date: string;
  delta: number | null; media: string[]; reasons: string[]; missing: string[]; evidence_ids: string[];
}
export interface GroupAiSummary {
  status: AiStatus;
  model?: string;
  latency_ms?: number;
  generated_at?: string | null;
  summary?: {
    overview: string;
    key_findings: string[];
    anomalies: string[];
    department_focus: string[];
    suggested_actions: string[];
    limits: string[];
  } | null;
}
export interface IndividualAiDraft {
  summary: string;
  observations: string[];
  multimodal_notes: string[];
  risk_points: string[];
  recommendations: string[];
  evidence_refs: string[];
}
export interface MultimodalEvidence {
  ref: string; kind: string; label: string; content: string;
  retrieval?: { level?: string; conclusion?: string; hit_count?: number };
}
export interface Run {
  id: string; created_at: string; total: number; records: number; days: number; department: string;
  priority_count: number; unlinked_count: number; distribution: Record<string, number>;
  summary: string; limits: string[]; subjects: Subject[];
  trace: { agent: string; tool: string; status: string; at: string; summary: string; count: number }[];
  ai_summary?: GroupAiSummary;
}
export interface Workspace {
  scope: Scope; latest_run: Run | null; tasks: Task[]; available_subjects: number;
  departments: string[]; model_available?: boolean; latest_screening_date?: string | null;
}
export interface ModelSettings {
  /** 设置页里的开关状态（存后端，默认开启）。 */
  enabled: boolean;
  /** 后端是否配置了可用的 DEEPSEEK_API_KEY。 */
  configured: boolean;
  /** 开关开启且凭据就绪，个案研判才真的会调用模型。 */
  available: boolean;
}
export interface CaseDetail extends Subject {
  assessmentState?: { status: 'none' | 'unknown' | 'current' | 'outdated'; newRecords: number; changedRecords: number; removedRecords?: number };
  assessment?: {
    id: string; created_at: string; summary: string; recommendation: string; evidence_ids: string[];
    limits: string[]; trace: { tool: string; summary: string }[];
    model_status?: AiStatus;
    model_draft?: IndividualAiDraft;
    multimodal_evidence?: MultimodalEvidence[];
    multimodal_coverage?: { text: number; audio: number; image: number };
    ai_model?: string;
    ai_latency_ms?: number;
  } | null;
  history: { id: string; date: string; score: number; max_score: number; questionnaire: string }[];
  tasks: Task[];
  materials: {
    kind: string; title: string; source: string; text?: string; url?: string;
    createdAt?: string;
    analysis?: { level?: string; levelLabel?: string; conclusion?: string; reason?: string; hit_count?: number } | null;
  }[];
}
export const loadWorkspace = (scope: Scope) => request.get<Workspace>('/api/agent-workspace', { params: { scope } });
export const startRun = (scope: Scope, days: number, department: string) =>
  request.post<Workspace>('/api/agent-workspace/runs', { scope, days, department }, { timeout: 90000 });
export const loadCase = (scope: Scope, subject: string) =>
  request.get<CaseDetail>(`/api/agent-workspace/cases/${encodeURIComponent(subject)}`, { params: { scope } });
export const analyseCase = (scope: Scope, subject: string) =>
  request.post<CaseDetail>(`/api/agent-workspace/cases/${encodeURIComponent(subject)}/runs`, { scope }, { timeout: 60000 });
export const saveTask = (task: Task, action: string, fields: { assignee: string; title: string; due_at: string; note: string }) =>
  request.put<Task>(`/api/agent-workspace/tasks/${encodeURIComponent(task.id)}`, { ...fields, version: task.version, action });
export const loadModelSettings = () => request.get<ModelSettings>('/api/agent-workspace/model');
export const saveModelSettings = (enabled: boolean) =>
  request.put<ModelSettings>('/api/agent-workspace/model', { enabled });
