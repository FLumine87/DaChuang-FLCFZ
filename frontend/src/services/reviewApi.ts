/** 数据审核接口：新数据进公共池与训练池的闸门。 */
import { request } from './http';

export interface ReviewStats {
  scope: Record<string, number>;
  pending: number;
  public: number;
  private: number;
  rejected: number;
  queue: number;
  train_version: string;
}

export interface PendingItem {
  record_id: string;
  user_id: number | null;
  date: string;
  window: number | null;
  alert_level: string;
  tags: string[];
  summary: string;
  modalities: string[];
  review_status: string;
}

export interface PendingPage {
  total: number;
  items: PendingItem[];
  limit: number;
  offset: number;
}

export interface ReviewResult {
  action: string;
  updated: number;
  records: string[];
  skipped: { record_id?: string; window?: number; reason: string }[];
  pending: number;
  retrain_scheduled?: boolean;
}

export interface RetrainStatus {
  running: boolean;
  pending: number;
  last_version: string;
  windows: number;
}

export const getReviewStats = () => request.get<ReviewStats>('/api/admin/review/stats');

export const getPendingReviews = (params: { limit?: number; offset?: number; keyword?: string } = {}) =>
  request.get<PendingPage>('/api/admin/review/pending', { params });

export const reviewBatch = (recordIds: string[], action: 'approve' | 'reject', note = '') =>
  request.post<ReviewResult>('/api/admin/review/batch', {
    record_ids: recordIds,
    action,
    note,
  });

export const triggerRetrain = () => request.post<RetrainStatus & { started: boolean; message: string }>(
  '/api/admin/hashing/retrain',
);

export const getRetrainStatus = () => request.get<RetrainStatus>('/api/admin/hashing/status');

export interface LabelSpace {
  labels: string[];
  max: number;
}

export interface TagResult {
  ok: boolean;
  record_id: string;
  tags: string[];
  units: number;
  reason?: string;
}

export interface SuggestResult {
  ok: boolean;
  record_id: string;
  current: string[];
  labels: string[];
  source: 'llm' | 'rule' | 'none';
  reason: string;
}

export const getLabelSpace = () => request.get<LabelSpace>('/api/admin/review/labels');

export const setRecordTags = (recordId: string, tags: string[]) =>
  request.post<TagResult>('/api/admin/review/tags', { record_id: recordId, tags });

export const suggestRecordTags = (recordId: string) =>
  request.post<SuggestResult>('/api/admin/review/suggest-tags', { record_id: recordId });
