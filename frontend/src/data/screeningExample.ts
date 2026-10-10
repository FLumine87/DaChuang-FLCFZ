import type { PersonalScreeningRecord } from './mockData';

export const screeningExample: PersonalScreeningRecord = {
  id: 'preview-only', questionnaire: 'PHQ-9', score: 8, maxScore: 27,
  level: 'yellow', status: 'completed', moodTag: '示例数据', date: '2026-10-10',
};

// 仅演示详情，合计 8 分，不提交到服务器。
export const exampleAnswers = [1, 1, 2, 1, 1, 1, 1, 0, 0];
