/**
 * mockApi.ts
 * 统一的 API 层：
 * - 当 VITE_USE_MOCK=true：返回本地 mock 数据（用于演示 / 离线开发）
 * - 当 VITE_USE_MOCK=false：走真实后端（见 http.ts）
 *
 * 组件只需要 import 这里的方法，不用关心数据来源。
 * 要接后端只需改环境变量 VITE_USE_MOCK=false，组件无需改动。
 */

import { request, USE_MOCK, getTokenUsername } from './http';

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
  type RetrievalIndexInfo,
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

/**
 * 演示模式的"网络"延迟。
 * 原先 200~800ms 是照着真实接口的体感写的，但首次引导要连着走
 * 作答 → 补充 → 结果 → 主页四屏，每一步都等半秒就明显发顿（用户反馈过）。
 * 现在收到 90~240ms：仍然能看出"数据是取回来的"，但不挡手。
 */
function delay(ms?: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms ?? 90 + Math.random() * 150)
  );
}

// ─── 演示数据（仅 VITE_USE_MOCK=true 生效）──────────────────────────────────
/**
 * 用户 2026-10-14 拍板：**不做空状态，演示数据要给足** ——
 * "不要空状态，还是要保留我们本来带有的展示数据，这样才能看到更多的东西。"
 *
 * 所以个人端在演示模式下**恒等于**「仓库自带那套样例记录 + 本账号自己提交的记录」：
 * 任何新注册账号进首页都能看到预警卡、最近 30 天趋势与最近记录，而不是一片空白。
 * 同一 id 只保留一条，避免自己的提交与样例数据重复计数。
 *
 * 下面这组函数只负责"本账号提交过什么"，是上面那份合并结果的增量部分；
 * `rememberSubmittedRecord` 保留 —— 自己刚提交的筛查要真的出现在列表与档案里。
 * 接了真实后端以后这一段完全不生效。
 */
const MOCK_RECORDS_KEY = 'psych_mock_records:v1';

function readSubmittedRecords(): Record<string, PersonalScreeningRecord[]> {
  try {
    const raw = localStorage.getItem(MOCK_RECORDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PersonalScreeningRecord[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSubmittedRecords(all: Record<string, PersonalScreeningRecord[]>) {
  try {
    localStorage.setItem(MOCK_RECORDS_KEY, JSON.stringify(all));
  } catch {
    /* 隐私模式下写不进去：本次会话内列表会少一条自己的提交，不影响流程 */
  }
}

/** 当前账号能看到的个人筛查记录（新的在前）：样例数据 + 本账号自己的提交 */
function personalRecords(): PersonalScreeningRecord[] {
  const username = getTokenUsername();
  const mine = username ? readSubmittedRecords()[username] ?? [] : [];
  // 自己的提交排在前面；与样例数据同 id 的只留一条
  return [
    ...mine,
    ...screeningRecords.filter((item) => !mine.some((s) => s.id === item.id)),
  ];
}

/** 给已提交的记录补一条内容（改它、再写回当前账号的记录列表） */
function patchSubmittedRecord(id: string, patch: Partial<PersonalScreeningRecord>) {
  const username = getTokenUsername();
  if (!username) return;
  const all = readSubmittedRecords();
  const mine = all[username] ?? [];
  const index = mine.findIndex((item) => item.id === id);
  if (index < 0) return;
  mine[index] = { ...mine[index], ...patch };
  all[username] = mine;
  writeSubmittedRecords(all);
}

/** 记一条自己提交的筛查，让它在列表/档案里真的出现 */
function rememberSubmittedRecord(record: PersonalScreeningRecord) {
  const username = getTokenUsername();
  if (!username) return;
  const all = readSubmittedRecords();
  all[username] = [record, ...(all[username] ?? [])].slice(0, 50);
  writeSubmittedRecords(all);
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
  /** 检索过程信息：候选数、探测桶数、查询哈希码等（真实后端返回） */
  index?: RetrievalIndexInfo;
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
  monthlyAlertCounts: { yellow: number; red: number };
  alertRecords: AlertRecord[];
  screeningRecords: AdminScreeningRecord[];
  caseRecords: CaseRecord[];
}

// ─── 认证 ────────────────────────────────────────────────────────────────────

export async function apiLogin(
  username: string,
  password: string
): Promise<LoginResult> {
  if (USE_MOCK) {
    await delay();
    const result = mockAuthLogin(username, password);
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
    return personalRecords();
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
    const id = `ME-SCR-${Date.now().toString().slice(-6)}`;
    /* 以前只返回一个 id，数据里什么都不落 —— 演示模式下刚做完的筛查
       不会出现在记录列表里。现在按账号记一条，列表和档案都能看到。 */
    rememberSubmittedRecord({
      id,
      questionnaire: data.questionnaire,
      score: data.score,
      maxScore: data.maxScore,
      level: data.level,
      status: 'completed',
      moodTag: '已完成',
      date: new Date().toLocaleDateString('sv-SE'),
      /* 逐题作答也要落下来：以前只存分数，档案里看不到"哪一题答了什么" */
      answers: data.answers,
    });
    return {
      id,
      status: 'success',
      riskLevel: labels[data.level],
    };
  }
  return request.post('/api/personal/screenings', data);
}

/**
 * 把用户在 02「补充记录」里写/传的内容挂到本次筛查记录上。
 *
 * 之前这一步只写进了 sessionStorage 草稿（给 03 结果页看），一离开就没了——
 * 档案里查不到，等于白填。真实后端需要对应的
 * `POST /api/personal/screenings/{id}/supplement` 接口。
 */
export async function saveScreeningSupplement(
  recordId: string,
  supplement: { kind: 'text' | 'audio' | 'image'; text?: string; filename?: string; url?: string },
): Promise<void> {
  if (USE_MOCK) {
    await delay(120);
    patchSubmittedRecord(recordId, { supplement });
    return;
  }
  await request.post(`/api/personal/screenings/${encodeURIComponent(recordId)}/supplement`, supplement);
}

export async function getDashboardData(): Promise<DashboardResponse> {
  if (USE_MOCK) {
    await delay();
    /* 演示模式下整页都给仓库那套样例数据（趋势 / 预警 / 行动计划 / 筛查记录），
       筛查记录再叠上本账号自己的提交 —— 见文件开头的「演示数据」说明。
       用户明确要求不做空状态：新账号也要能看到预警卡、趋势与最近记录。
       真实后端下这些字段自然随账号返回。 */
    return {
      moodTrend,
      warningDistribution,
      warningEvents,
      actionPlan: [...actionPlan],
      screeningRecords: personalRecords(),
      userProfile,
      questionnaireCatalog,
      personalTimeline,
    };
  }
  return request.get<DashboardResponse>('/api/personal/dashboard');
}

/** 管理端顶部指标（真实聚合查询）。后端 /api/dashboard/stats 已提供
 *  monthly_screenings / completion_rate 等字段，此前前端用的是写死的 87%、9。 */
export interface DashboardStats {
  total_screenings: number;
  monthly_screenings: number;
  pending_alerts: number;
  completion_rate: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  if (USE_MOCK) {
    await delay();
    return {
      total_screenings: 300,
      monthly_screenings: 261,
      pending_alerts: 9,
      completion_rate: 87,
    };
  }
  return request.get<DashboardStats>('/api/dashboard/stats');
}

export async function getWarnings(): Promise<WarningEvent[]> {
  if (USE_MOCK) {
    await delay();
    return [...warningEvents];
  }
  return request.get<WarningEvent[]>('/api/personal/warnings');
}

/**
 * 更新一条预警的处理状态（标记为跟踪中 / 已缓解）。
 *
 * 真实模式走 PUT /api/alerts/{id}。注意后端 update_alert 需要数据库数字 id，
 * 而个人预警列表返回的是展示编号（WARN-…），若后端未提供 dbId，该调用会被拒绝 ——
 * 所以调用方必须处理失败并回滚界面，绝不能静默改状态。
 */
export async function updateWarningStatus(
  id: string,
  status: WarningEvent['status']
): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    return;
  }
  await request.put(`/api/alerts/${encodeURIComponent(id)}`, { status });
}

export async function getCases() {
  if (USE_MOCK) {
    await delay();
    return { screeningRecords: personalRecords(), warningEvents, userProfile, personalTimeline };
  }
  return request.get<{
    screeningRecords: PersonalScreeningRecord[];
    warningEvents: WarningEvent[];
    userProfile: UserProfile;
    personalTimeline: PersonalTimelineEvent[];
  }>('/api/personal/profile');
}

/** 检索请求参数（文本 / 图像 / 语音三种查询方式共用） */
export interface RetrievalQuery {
  /** 查询模态：text（默认）/ image / audio */
  modality?: 'text' | 'image' | 'audio';
  /** 结果范围过滤：只返回该模态的命中单元 */
  modalityFilter?: 'text' | 'image' | 'audio';
  /** 图像 / 语音查询的媒体内容（base64，不含 data URL 前缀） */
  mediaBase64?: string | null;
  /** 媒体原始文件名（仅用于推断扩展名，决定落盘格式） */
  mediaName?: string;
}

export async function search(
  query: string,
  opts: RetrievalQuery = {},
): Promise<SearchResponse<PersonalRetrievalResult>> {
  if (USE_MOCK) {
    await delay(400 + Math.random() * 400);
    const filtered = opts.modalityFilter
      ? retrievalResults.filter((r) => r.modality === opts.modalityFilter)
      : retrievalResults;
    return { results: filtered, report: ragReport, query };
  }
  return request.post<SearchResponse<PersonalRetrievalResult>>(
    '/api/personal/search',
    {
      query,
      modality: opts.modality ?? 'text',
      modality_filter: opts.modalityFilter ?? 'all',
      media_base64: opts.mediaBase64 ?? null,
      media_name: opts.mediaName ?? '',
    }
  );
}

/** 单元的真实媒体文件（语音可播放 / 图像原图），按需单独取用 */
export interface RetrievalMediaPayload {
  unit_id: string;
  modality: 'image' | 'audio';
  media_kind?: string | null;
  /** data URL：语音为可直接播放的 wav，图像为原图 */
  media: string;
  media_meta?: Record<string, unknown> | null;
}

export async function fetchRetrievalMedia(unitId: string): Promise<RetrievalMediaPayload> {
  if (USE_MOCK) {
    await delay(150);
    throw new Error('演示语料没有真实媒体文件，请连接后端（VITE_USE_MOCK=false）');
  }
  return request.get<RetrievalMediaPayload>(
    `/api/retrieval/media/${encodeURIComponent(unitId)}`
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
  // 注意：不要手动设置 Content-Type，浏览器/axios 会在发送 FormData 时
  // 自动加上带 boundary 的 multipart/form-data，否则 FastAPI 无法解析。
  const data = await request.post<{ file_path: string; file_name: string; file_id: string; analysis?: string }>('/api/upload', form);
  return {
    url: data.file_path,
    filename: data.file_name,
    analysis: data.analysis || `文件上传成功，文件ID: ${data.file_id}`,
  };
}

// ─── 管理端 ──────────────────────────────────────────────────────────────────

export async function getAdminDashboardData(): Promise<AdminDashboardResponse> {
  if (USE_MOCK) {
    await delay();
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return {
      trendData,
      alertDistribution,
      monthlyAlertCounts: {
        yellow: alertRecords.filter((item) => item.level === 'yellow' && item.createdAt.startsWith(monthPrefix)).length,
        red: alertRecords.filter((item) => item.level === 'red' && item.createdAt.startsWith(monthPrefix)).length,
      },
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

export async function adminSearch(
  query: string,
  opts?: {
    modality?: 'text' | 'image' | 'audio';
    mediaBase64?: string;
    mediaName?: string;
  }
): Promise<SearchResponse<AdminRetrievalResult>> {
  if (USE_MOCK) {
    await delay(400 + Math.random() * 400);
    return { results: adminRetrievalResults, report: adminRagReport, query };
  }
  // 后端本来就支持图像 / 语音查询（与个人端同一套），此前前端只传了 query
  return request.post<SearchResponse<AdminRetrievalResult>>('/api/admin/search', {
    query,
    modality: opts?.modality ?? 'text',
    ...(opts?.mediaBase64
      ? { media_base64: opts.mediaBase64, media_name: opts.mediaName ?? '' }
      : {}),
  });
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
