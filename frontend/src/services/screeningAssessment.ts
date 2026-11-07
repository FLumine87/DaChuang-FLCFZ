import { request, USE_MOCK } from './http';

export interface RetrievalAnalysisReport {
  summary: string;
  riskLevel: string;
  sections: { title: string; content: string }[];
  recommendations: string[];
  originalInput?: { enabled: boolean; used: boolean; modality: string; notice: string };
  generationMessage?: string;
  /** true 表示检索规则说明，未使用大模型生成。 */
  mock?: boolean;
}

export interface RetrievalAssessment {
  analysisMode?: 'retrieval';
  queryModality?: 'text' | 'image' | 'audio';
  retrievalToken?: string;
  id: string;
  screeningId?: string | null;
  supplementId?: number | null;
  status: 'needs_followup' | 'needs_scale' | 'ready' | 'needs_human_review';
  level: 'green' | 'yellow' | 'orange' | 'red' | null;
  levelLabel: string;
  conclusion: string;
  evidence: { id: string; label: string; value: string; source: string }[];
  missingFields: string[];
  questions: { id: string; field: string; prompt: string; referenceIds: string[] }[];
  recommendedScales: { code: string; name: string; reason: string }[];
  nextAction: { type: string; label: string };
  references: {
    id: string; recordId?: string; modality?: string; similarity?: number;
    usage: 'candidate' | 'followup' | 'explanation' | 'screening'; matchedDimensions: string[];
    reason: string; questionIds: string[];
  }[];
  trace: { step: string; detail: string; referenceIds?: string[] }[];
  repeatedNegative: { days: string[]; count: number; threshold: number; windowDays: number };
  safetyStatus: string;
  ruleVersion: string;
  updatedAt: string;
  followupAnswers?: Record<string, string>;
}

export interface AssessmentRequest {
  retrievalToken?: string;
  query: string;
  screeningId?: string | null;
  supplementId?: number | null;
  modality?: 'text' | 'audio' | 'image';
  followupAnswers?: Record<string, string>;
  save?: boolean;
}

/** 风险由服务端统一评估；浏览器不通过命中数或相似度自行定级。 */
export async function assessRetrieval(input: AssessmentRequest): Promise<RetrievalAssessment> {
  if (USE_MOCK) {
    return {
      id: 'demo-preview', status: 'needs_followup', level: null, levelLabel: '演示模式 · 未评估',
      conclusion: '当前展示演示检索素材，尚未执行真实筛查评估。',
      evidence: [{ id: 'input', label: '本次输入', value: input.query || '媒体输入', source: '本人输入' }],
      missingFields: [], questions: [], recommendedScales: [],
      nextAction: { type: 'none', label: '连接后端后可分析本人线索与跨模态参考' },
      references: [], trace: [{ step: '演示模式', detail: '演示素材不参与本人风险判断。' }],
      repeatedNegative: { days: [], count: 0, threshold: 3, windowDays: 14 },
      safetyStatus: 'unknown', ruleVersion: 'demo', updatedAt: new Date().toISOString(),
    };
  }
  const data = await request.post<{ assessment: RetrievalAssessment }>(
    '/api/personal/retrieval-screening', { supplementId: input.supplementId, retrievalToken: input.retrievalToken }, { timeout: 60_000 },
  );
  if (!data?.assessment) throw new Error('本次筛查评估未返回，请重试');
  return data.assessment;
}

export function assessmentScaleHref(assessment: RetrievalAssessment, code: string | undefined, query: string): string {
  const params = new URLSearchParams({ tab: 'scale' });
  if (code) params.set('paper', code);
  if (assessment.supplementId) {
    params.set('assessmentSupplementId', String(assessment.supplementId));
    params.set('assessmentQuery', query);
  }
  return `/personal/screening?${params.toString()}`;
}
