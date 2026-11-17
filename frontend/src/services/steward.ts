import { useEffect, useSyncExternalStore } from 'react';
import { personalRequest } from './api';
import { getToken } from './http';
import { usePageActive } from './pageActivity';

export interface StewardSettings { enabled: boolean; screening: boolean; chat: boolean; checkin: boolean; feedback: boolean; history: boolean }
export interface Evidence { id: string; source: string; source_key: string; occurred_at: string; body: string; payload: Record<string, unknown> }
export interface Observation { text: string; evidence_ids: string[] }
export interface Memory { id: string; content: string; status: string; evidence_ids: string[] }
export interface Suggestion { id: string; title: string; detail: string; reason: string; evidence_ids: string[]; state: string; plan_id?: number }
export interface MultimodalHistoryItem { id: string; at: string; kind: 'text' | 'audio' | 'image'; summary: string; filename?: string; conclusion: string; level?: string | null; analysis_mode?: string | null; metadata_only?: boolean }
export interface StewardState {
  indicators?: { risk: { level: string; at?: string; evidence_id?: string }; mbti?: { type: string; status: string; reason: string; evidence_ids: string[] } | null };
  settings: StewardSettings; version: number; updated_at: string; status: string; error: string; evidence_count: number;
  snapshot: { summary?: string; window_start?: string; window_end?: string; observations?: Observation[]; changes?: Observation[]; questions?: Observation[]; portrait?: Observation[]; mbti?: { type: string; status: string; reason: string; evidence_ids: string[] }; source?: string; context_count?: number };
  memories: Memory[]; suggestions: Suggestion[];
  series: Record<string, { at: string; score: number; max: number; id: string; version?: string }[]>;
  multimodal_history?: MultimodalHistoryItem[];
}
export interface ChatRun { id: string; message: string; reply: string; status: string; error: string; created_at: string }
const root = '/api/v1/steward';
export const stewardApi = {
  state: () => personalRequest<StewardState>(root),
  settings: (settings: StewardSettings) => mutate('/settings', 'PUT', settings),
  refresh: () => mutate('/refresh', 'POST'),
  evidence: (offset = 0, ids: string[] = []) => personalRequest<Evidence[]>(`${root}/evidence?offset=${offset}&ids=${encodeURIComponent(ids.join(','))}`),
  forget: (id: string) => mutate(`/evidence/${id}`, 'DELETE'),
  remember: (content: string) => mutate('/memories', 'POST', { content }),
  memory: (id: string, action: string, content = '') => mutate(`/memories/${id}`, 'PUT', { action, content }),
  clear: () => mutate('/memory', 'DELETE'),
  suggestion: (id: string, action: string, title = '') => mutate(`/suggestions/${id}`, 'POST', { action, title }),
  history: () => personalRequest<ChatRun[]>(`${root}/chat/history`),
  clearHistory: () => mutate('/chat/history', 'DELETE'),
  importHistory: (messages: unknown[]) => mutate('/chat/import', 'POST', { messages: messages.slice(-200) }),
  chat: (id: string, message: string, history: unknown[]) => personalRequest<{ id: string }>(`${root}/chat/runs`, { method: 'POST', body: JSON.stringify({ id, message, history }) }),
  run: (id: string) => personalRequest<ChatRun>(`${root}/chat/runs/${id}`),
  retry: (id: string) => personalRequest(`${root}/chat/runs/${id}/retry`, { method:'POST' }),
  safety: (message: string) => personalRequest<{ crisis_hits: string[] }>(`${root}/safety`, { method:'POST', body:JSON.stringify({ message }) }),
};
async function mutate(path: string, method: string, body?: unknown) {
  const result = await personalRequest(root + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  sequence++; request = undefined;
  await reloadSteward();
  if (path.startsWith('/suggestions/')) window.dispatchEvent(new Event('steward-plans-changed'));
  return result;
}

let identity = '';
let value: { data?: StewardState; error?: string } = {};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let request: Promise<void> | undefined;
let sequence = 0;
function emit() { listeners.forEach(fn => fn()); }
export async function reloadSteward() {
  const token = getToken() ?? '';
  if (identity !== token) { identity = token; value = {}; request = undefined; sequence++; emit(); }
  if (!token) return;
  try { if (JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role !== 'user') return; } catch { return; }
  if (request) return request;
  const revision = ++sequence;
  const job = stewardApi.state().then(data => { if (identity === token && sequence === revision) { value = { data }; emit(); } }).catch(() => {
    if (identity === token && sequence === revision) { value = { ...value, error: '心理管家暂未连接，请确认已启动完整服务。' }; emit(); }
  }).finally(() => { if (request === job) request = undefined; });
  request = job;
  return job;
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) timer = setInterval(() => { if (document.visibilityState === 'visible') void reloadSteward(); }, 5000);
  return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); timer = undefined; } };
}
export function useSteward() {
  const active = usePageActive();
  const token = getToken() ?? '';
  const state = useSyncExternalStore(subscribe, () => value);
  useEffect(() => { if (active) void reloadSteward(); }, [active, token]);
  return identity === token ? state : {};
}

export async function* streamSteward(id: string, message: string, history: unknown[]): AsyncGenerator<{ delta?: string; error?: string; run_id?: string }> {
  const run = await stewardApi.chat(id, message, history);
  yield { run_id:run.id };
  let previous = '';
  while (true) {
    const next = await stewardApi.run(run.id);
    if (!next.reply.startsWith(previous)) previous = '';
    if (next.reply !== previous) yield { delta: next.reply.slice(previous.length) };
    previous = next.reply;
    if (next.status === 'done') { void reloadSteward(); return; }
    if (next.status === 'failed') throw new Error(next.error);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
