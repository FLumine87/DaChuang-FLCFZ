import { QUESTIONNAIRE_VERSION, QUESTIONNAIRE_ANSWER_ENCODING } from '../data/questionnaireData';
import { request, USE_MOCK } from './http';

export interface ReviewRequest {
  id: string; title: string; instructions: string; questionnaire: string; due_at: string;
  status: 'sent' | 'acknowledged' | 'submitted' | 'reviewed' | 'cancelled';
  screening_id: string | null; version: number; created_at: string;
  recipient?: string; review_notes?: string;
  source_task_id?: string; score?: number; max_score?: number; alert_level?: string;
}
export const reviewStates: Record<ReviewRequest['status'], string> = {
  sent: '待确认', acknowledged: '已确认收到', submitted: '已提交，待复核', reviewed: '已复核', cancelled: '已取消',
};
export async function personalReviews(): Promise<ReviewRequest[]> {
  if (USE_MOCK) return [];
  return request.get('/api/personal/reviews');
}
export async function staffReviews(caseId: string): Promise<ReviewRequest[]> {
  if (USE_MOCK) return [];
  return request.get('/api/admin/reviews', { params: { case: caseId } });
}
export async function sendReview(data: { task_id: string; title: string; instructions: string; questionnaire: string; due_at: string }): Promise<ReviewRequest> {
  if (USE_MOCK) throw new Error('请连接真实后端发送复查任务');
  return request.post('/api/admin/reviews', data);
}
export const acknowledgeReview = (id: string) => request.post<ReviewRequest>(`/api/personal/reviews/${encodeURIComponent(id)}/acknowledge`);
export const submitReview = (id: string, answers: Record<string, number>) =>
  request.post<ReviewRequest>(`/api/personal/reviews/${encodeURIComponent(id)}/submit`, { answers, questionnaireVersion: QUESTIONNAIRE_VERSION, answerEncoding: QUESTIONNAIRE_ANSWER_ENCODING });
export const staffReviewAction = (item: ReviewRequest, action: 'review' | 'cancel', note: string) =>
  request.put<ReviewRequest>(`/api/admin/reviews/${encodeURIComponent(item.id)}`, { action, version: item.version, note });
export interface Notice { id: string; request_id: string; message: string; read_at: string | null; created_at: string; path: string }
export async function loadNotices(): Promise<{ unread: number; items: Notice[] }> {
  if (USE_MOCK) return { unread: 0, items: [] };
  return request.get('/api/notifications');
}
export const readNotice = (id: string) => request.put(`/api/notifications/${encodeURIComponent(id)}/read`);
