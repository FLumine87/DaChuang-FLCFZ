/** Management views use this module so their data source is explicit. */
import { request, USE_MOCK } from './http';
import {
  alertRecords as sampleAlerts,
  caseRecords as sampleCases,
  trendData as sampleTrend,
  alertDistribution as sampleDistribution,
  screeningRecords as sampleScreenings,
  type AlertRecord,
  type CaseRecord,
} from '../admin/data/adminMockData';

export { USE_MOCK };

export interface AdminStats {
  totalScreenings: number;
  monthlyScreenings: number;
  openAlerts: number;
  completionRate: number;
  seedRecords: number;
}

export interface AdminDashboardData {
  stats: AdminStats;
  trendData: { date: string; count: number; alerts: number }[];
  alertDistribution: { name: string; value: number; color: string }[];
  alertRecords: AlertRecord[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AlertEvent {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string;
  actor: string;
  createdAt: string;
}

export interface AdminAlertDetail extends AlertRecord {
  assigneeId: number | null;
  followUpNotes: string;
  score: number | null;
  maxScore: number | null;
  questionnaire: string;
  history: AlertEvent[];
}

export interface Assignee {
  id: number;
  name: string;
  role: string;
}

export interface AdminCaseDetail extends CaseRecord {
  userId: number | null;
  notes: string;
  screenings: { id: string; questionnaire: string; score: number; maxScore: number; alertLevel: string; date: string }[];
  alerts: { id: string; level: string; status: string; createdAt: string }[];
  timeline: { id: number | string; type: string; title: string; description: string; date: string }[];
}

let demoAlerts = sampleAlerts.map((item) => ({ ...item }));
let demoCases = sampleCases.map((item) => ({ ...item }));
const demoHistory: Record<string, AlertEvent[]> = {};
const demoTimeline: Record<string, AdminCaseDetail['timeline']> = {};
const demoCaseNotes: Record<string, string> = {};
const demoAlertNotes: Record<string, string> = {};

function params(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  return query.toString();
}

export async function getAdminDashboard(): Promise<AdminDashboardData> {
  if (USE_MOCK) {
    return {
      stats: {
        totalScreenings: sampleScreenings.length,
        monthlyScreenings: sampleScreenings.length,
        openAlerts: demoAlerts.filter((a) => a.status === 'pending' || a.status === 'processing').length,
        completionRate: sampleScreenings.length
          ? Math.round(sampleScreenings.filter((s) => s.status === 'completed').length / sampleScreenings.length * 100)
          : 0,
        seedRecords: sampleScreenings.length,
      },
      trendData: sampleTrend,
      alertDistribution: sampleDistribution,
      alertRecords: demoAlerts,
    };
  }
  return request.get<AdminDashboardData>('/api/admin/dashboard');
}

export async function listAdminAlerts(filters: {
  keyword?: string; level?: string; status?: string; page?: number;
}): Promise<Page<AlertRecord>> {
  if (USE_MOCK) {
    const filtered = demoAlerts.filter((a) =>
      (!filters.keyword || a.name.includes(filters.keyword) || a.id.includes(filters.keyword)) &&
      (!filters.level || a.level === filters.level) &&
      (!filters.status || a.status === filters.status));
    const page = filters.page || 1;
    return { items: filtered.slice((page - 1) * 50, page * 50), total: filtered.length, page, pageSize: 50 };
  }
  return request.get<Page<AlertRecord>>(`/api/admin/alerts?${params(filters)}`);
}

export async function getAdminAlert(id: string): Promise<AdminAlertDetail> {
  if (USE_MOCK) {
    const found = demoAlerts.find((a) => a.id === id);
    if (!found) throw new Error('预警不存在');
    return { ...found, assigneeId: found.assignee === '演示管理员' ? 1 : null,
      followUpNotes: demoAlertNotes[id] || '', score: null,
      maxScore: null, questionnaire: '', history: demoHistory[id] || [] };
  }
  return request.get<AdminAlertDetail>(`/api/admin/alerts/${encodeURIComponent(id)}`);
}

export async function listAdminAssignees(): Promise<Assignee[]> {
  if (USE_MOCK) return [{ id: 1, name: '演示管理员', role: 'admin' }];
  return request.get<Assignee[]>('/api/admin/assignees');
}

export async function updateAdminAlert(id: string, data: {
  status: string; assignee_id: number | null; follow_up_notes: string;
}): Promise<AdminAlertDetail> {
  if (USE_MOCK) {
    const found = demoAlerts.find((a) => a.id === id);
    if (!found) throw new Error('预警不存在');
    const previous = found.status;
    const note = data.follow_up_notes.trim();
    if (data.status === 'resolved' && previous !== 'resolved' && !note) throw new Error('解决预警时需要填写处理记录');
    if (data.status !== previous || note) {
      demoHistory[id] = [{ id: Date.now(), fromStatus: previous, toStatus: data.status,
        note, actor: '演示管理员', createdAt: new Date().toLocaleString('zh-CN') }, ...(demoHistory[id] || [])];
    }
    if (note) demoAlertNotes[id] = [demoAlertNotes[id], note].filter(Boolean).join('\n');
    demoAlerts = demoAlerts.map((a) => a.id === id ? {
      ...a, status: data.status as AlertRecord['status'],
      assignee: data.assignee_id ? '演示管理员' : (found.assignee === '演示管理员' ? '未分配' : found.assignee),
      updatedAt: new Date().toLocaleString('zh-CN'),
    } : a);
    return getAdminAlert(id);
  }
  return request.put<AdminAlertDetail>(`/api/admin/alerts/${encodeURIComponent(id)}`, data);
}

export async function listAdminCases(filters: {
  keyword?: string; status?: string; page?: number;
}): Promise<Page<CaseRecord>> {
  if (USE_MOCK) {
    const filtered = demoCases.filter((c) =>
      (!filters.keyword || c.name.includes(filters.keyword) || c.id.includes(filters.keyword)) &&
      (!filters.status || c.status === filters.status));
    const page = filters.page || 1;
    return { items: filtered.slice((page - 1) * 50, page * 50), total: filtered.length, page, pageSize: 50 };
  }
  return request.get<Page<CaseRecord>>(`/api/admin/cases?${params(filters)}`);
}

export async function getAdminCase(id: string): Promise<AdminCaseDetail> {
  if (USE_MOCK) {
    const found = demoCases.find((c) => c.id === id);
    if (!found) throw new Error('案例不存在');
    return { ...found, userId: null, notes: demoCaseNotes[id] || '', screenings: [], alerts: [], timeline: demoTimeline[id] || [] };
  }
  return request.get<AdminCaseDetail>(`/api/admin/cases/${encodeURIComponent(id)}`);
}

export async function updateAdminCase(id: string, data: { status: string; notes: string }): Promise<AdminCaseDetail> {
  if (USE_MOCK) {
    demoCases = demoCases.map((c) => c.id === id ? { ...c, status: data.status as CaseRecord['status'] } : c);
    demoCaseNotes[id] = data.notes;
    return getAdminCase(id);
  }
  return request.put<AdminCaseDetail>(`/api/admin/cases/${encodeURIComponent(id)}`, data);
}

export async function addAdminCaseEvent(id: string, data: { title: string; description: string }): Promise<AdminCaseDetail> {
  if (USE_MOCK) {
    demoTimeline[id] = [{ id: Date.now(), type: 'follow_up', title: data.title,
      description: data.description, date: new Date().toLocaleString('zh-CN') }, ...(demoTimeline[id] || [])];
    return getAdminCase(id);
  }
  return request.post<AdminCaseDetail>(`/api/admin/cases/${encodeURIComponent(id)}/timeline`, data);
}
