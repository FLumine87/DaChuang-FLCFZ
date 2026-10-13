import { request } from './http';

export type Scope = 'demo' | 'live';
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
export interface Run {
  id: string; created_at: string; total: number; records: number; days: number; department: string;
  priority_count: number; unlinked_count: number; distribution: Record<string, number>;
  summary: string; limits: string[]; subjects: Subject[];
  trace: { agent: string; tool: string; status: string; at: string; summary: string; count: number }[];
}
export interface Workspace { scope: Scope; latest_run: Run | null; tasks: Task[]; available_subjects: number; departments: string[] }
export interface CaseDetail extends Subject {
  assessment?: { id: string; created_at: string; summary: string; recommendation: string; evidence_ids: string[]; limits: string[]; trace: { tool: string; summary: string }[] } | null;
  history: { id: string; date: string; score: number; max_score: number; questionnaire: string }[];
  tasks: Task[];
  materials: { kind: string; title: string; source: string; text?: string; url?: string }[];
}
export const loadWorkspace = (scope: Scope) => request.get<Workspace>('/api/agent-workspace', { params: { scope } });
export const startRun = (scope: Scope, days: number, department: string) =>
  request.post<Workspace>('/api/agent-workspace/runs', { scope, days, department }, { timeout: 60000 });
export const loadCase = (scope: Scope, subject: string) =>
  request.get<CaseDetail>(`/api/agent-workspace/cases/${encodeURIComponent(subject)}`, { params: { scope } });
export const analyseCase = (scope: Scope, subject: string) =>
  request.post<CaseDetail>(`/api/agent-workspace/cases/${encodeURIComponent(subject)}/runs`, { scope });
export const saveTask = (task: Task, action: string, fields: { assignee: string; title: string; due_at: string; note: string }) =>
  request.put<Task>(`/api/agent-workspace/tasks/${encodeURIComponent(task.id)}`, { ...fields, version: task.version, action });
