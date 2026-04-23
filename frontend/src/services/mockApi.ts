/**
 * mockApi.ts
 * 统一的 API 层：
 * - 当 VITE_USE_MOCK=true：返回本地 mock 数据（用于演示 / 离线开发）
 * - 当 VITE_USE_MOCK=false：走真实后端（见 http.ts）
 *
 * 组件只需要 import 这里的方法，不用关心数据来源。
 * 要接后端只需改环境变量 VITE_USE_MOCK=false，组件无需改动。
 */

import { request, USE_MOCK } from './http';

import {
  screeningRecords,
  warningEvents,
  retrievalResults,
  ragReport,
  moodTrend,
  warningDistribution,
  actionPlan,
  userProfile,
  questionnaireCatalog,
  personalTimeline,
  type PersonalScreeningRecord,
  type AlertLevel,
  type RetrievalResult as PersonalRetrievalResult,
  type WarningEvent,
  type UserProfile,
  type PersonalTimelineEvent,
  type MoodTrendPoint,
} from '../data/mockData';

import {
  screeningRecords as adminScreeningRecords,
  alertRecords,
  caseRecords,
  trendData,
  alertDistribution,
  ragReport as adminRagReport,
  retrievalResults as adminRetrievalResults,
  textSubmissions,
  audioSubmissions,
  imageSubmissions,
  type ScreeningRecord as AdminScreeningRecord,
  type AlertRecord,
  type CaseRecord,
  type RetrievalResult as AdminRetrievalResult,
  type TextSubmission,
  type AudioSubmission,
  type ImageSubmission,
} from '../admin/data/adminMockData';

import {
  login as mockAuthLogin,
  register as mockAuthRegister,
} from '../auth/mockAuth';

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function delay(ms?: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms ?? 200 + Math.random() * 600)
  );
}

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface LoginResult {
  ok: boolean;
  token?: string;
  role?: 'admin' | 'user';
  name?: string;
  message?: string;
}

export interface RegisterResult {
  ok: boolean;
  message?: string;
}

export interface SearchResponse<T> {
  results: T[];
  report: {
    summary: string;
    riskLevel?: string;
    sections?: { title: string; content: string }[];
    recommendations?: string[];
  };
  query: string;
}

export interface DashboardResponse {
  moodTrend: MoodTrendPoint[];
  warningDistribution: { name: string; value: number; color: string }[];
  warningEvents: WarningEvent[];
  actionPlan: { id: string; title: string; duration: string; status: 'new' | 'tracking' | 'resolved' }[];
  screeningRecords: PersonalScreeningRecord[];
  userProfile: UserProfile;
  questionnaireCatalog: typeof questionnaireCatalog;
  personalTimeline: PersonalTimelineEvent[];
}

export interface AdminDashboardResponse {
  trendData: { date: string; count: number; alerts: number }[];
  alertDistribution: { name: string; value: number; color: string }[];
  alertRecords: AlertRecord[];
  screeningRecords: AdminScreeningRecord[];
  caseRecords: CaseRecord[];
}

// ─── 认证 ────────────────────────────────────────────────────────────────────

export async function apiLogin(
  username: string,
  password: string,
  remember: boolean
): Promise<LoginResult> {
  if (USE_MOCK) {
    await delay();
    const result = mockAuthLogin(username, password, remember);
    if (!result.ok) return { ok: false, message: result.message };

    // 构造一个标准 JWT 三段式 mock token：<header>.<payload>.<sig>
    // 前端 session.ts 会解码第二段获取 username / role / exp
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = btoa(
      JSON.stringify({
        username,
        role: result.role,
        exp: Date.now() + 24 * 3600 * 1000,
      })
    );
    return {
      ok: true,
      token: `${header}.${payload}.mock`,
      role: result.role,
      name: result.role === 'admin' ? '管理员' : username,
    };
  }

  try {
    const data = await request.post<{ token: string; role: string; name: string }>(
      '/api/auth/login',
      { username, password }
    );
    // 后端返回的role可能是'admin'或'counselor'，前端统一处理
    return { 
      ok: true, 
      ...data, 
      role: data.role === 'admin' ? 'admin' : 'user' as 'admin' | 'user' 
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function apiRegister(
  username: string,
  password: string,
  name: string
): Promise<RegisterResult> {
  if (USE_MOCK) {
    await delay();
    return mockAuthRegister(username, password);
  }
  try {
    await request.post('/api/auth/register', { username, password, name, role: "user" });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function apiLogout(): Promise<void> {
  if (USE_MOCK) return;
  try {
    await request.post('/api/auth/logout');
  } catch {
    /* 登出失败也无妨，前端清 token 即可 */
  }
}

// ─── 个人端 ──────────────────────────────────────────────────────────────────

export async function getScreeningRecords(): Promise<PersonalScreeningRecord[]> {
  if (USE_MOCK) {
    await delay();
    return [...screeningRecords];
  }
  return request.get<PersonalScreeningRecord[]>('/api/personal/screenings');
}

export async function submitScreening(data: {
  questionnaire: string;
  score: number;
  maxScore: number;
  level: AlertLevel;
  answers?: Record<string, number>;
}): Promise<{ id: string; status: 'success'; riskLevel: string }> {
  if (USE_MOCK) {
    await delay();
    const labels: Record<AlertLevel, string> = {
      green: '低',
      yellow: '中低',
      orange: '中高',
      red: '高',
    };
    return {
      id: `ME-SCR-${Date.now().toString().slice(-6)}`,
      status: 'success',
      riskLevel: labels[data.level],
    };
  }
  return request.post('/api/personal/screenings', data);
}

export async function getDashboardData(): Promise<DashboardResponse> {
  if (USE_MOCK) {
    await delay();
    return {
      moodTrend,
      warningDistribution,
      warningEvents,
      actionPlan: [...actionPlan],
      screeningRecords,
      userProfile,
      questionnaireCatalog,
      personalTimeline,
    };
  }
  return request.get<DashboardResponse>('/api/personal/dashboard');
}

export async function getWarnings(): Promise<WarningEvent[]> {
  if (USE_MOCK) {
    await delay();
    return [...warningEvents];
  }
  return request.get<WarningEvent[]>('/api/personal/warnings');
}

export async function getCases() {
  if (USE_MOCK) {
    await delay();
    return { screeningRecords, warningEvents, userProfile, personalTimeline };
  }
  return request.get<{
    screeningRecords: PersonalScreeningRecord[];
    warningEvents: WarningEvent[];
    userProfile: UserProfile;
    personalTimeline: PersonalTimelineEvent[];
  }>('/api/personal/profile');
}

export async function search(query: string): Promise<SearchResponse<PersonalRetrievalResult>> {
  if (USE_MOCK) {
    await delay(400 + Math.random() * 400);
    return { results: retrievalResults, report: ragReport, query };
  }
  return request.post<SearchResponse<PersonalRetrievalResult>>(
    '/api/personal/search',
    { query }
  );
}

export async function uploadFile(file: File): Promise<{ url: string; filename: string; analysis: string }> {
  if (USE_MOCK) {
    await delay(600 + Math.random() * 400);
    return {
      url: URL.createObjectURL(file),
      filename: file.name,
      analysis: `对"${file.name}"的模拟分析完成：已完成哈希编码，特征向量维度 256，与历史库相似度最高 0.87。`,
    };
  }
  const form = new FormData();
  form.append('file', file);
  const data = await request.post<{ file_path: string; file_name: string; file_id: string }>('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return {
    url: data.file_path,
    filename: data.file_name,
    analysis: `文件上传成功，文件ID: ${data.file_id}`
  };
}

// ─── 管理端 ──────────────────────────────────────────────────────────────────

export async function getAdminDashboardData(): Promise<AdminDashboardResponse> {
  if (USE_MOCK) {
    await delay();
    return {
      trendData,
      alertDistribution,
      alertRecords,
      screeningRecords: adminScreeningRecords,
      caseRecords,
    };
  }
  return request.get<AdminDashboardResponse>('/api/admin/dashboard');
}

export async function getAdminScreeningRecords(): Promise<AdminScreeningRecord[]> {
  if (USE_MOCK) {
    await delay();
    return [...adminScreeningRecords];
  }
  return request.get<AdminScreeningRecord[]>('/api/admin/screenings');
}

export async function getAdminAlerts(): Promise<AlertRecord[]> {
  if (USE_MOCK) {
    await delay();
    return [...alertRecords];
  }
  return request.get<AlertRecord[]>('/api/admin/alerts');
}

export async function getAdminCases(): Promise<CaseRecord[]> {
  if (USE_MOCK) {
    await delay();
    return [...caseRecords];
  }
  return request.get<CaseRecord[]>('/api/admin/cases');
}

export async function adminSearch(query: string): Promise<SearchResponse<AdminRetrievalResult>> {
  if (USE_MOCK) {
    await delay(400 + Math.random() * 400);
    return { results: adminRetrievalResults, report: adminRagReport, query };
  }
  return request.post<SearchResponse<AdminRetrievalResult>>(
    '/api/admin/search',
    { query }
  );
}

export async function getAdminCollectionData(): Promise<{
  textSubmissions: TextSubmission[];
  audioSubmissions: AudioSubmission[];
  imageSubmissions: ImageSubmission[];
}> {
  if (USE_MOCK) {
    await delay();
    return { textSubmissions, audioSubmissions, imageSubmissions };
  }
  return request.get('/api/admin/data-collection');
}
