export type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface UserProfile {
  name: string;
  age: number;
  gender: string;
  campus: string;
  major: string;
  stage: string;
  emergencyContact: string;
}

export interface QuestionnaireItem {
  id: string;
  name: string;
  description: string;
  questions: number;
  minutes: number;
  target: string;
}

export interface PersonalScreeningRecord {
  id: string;
  questionnaire: string;
  score: number;
  maxScore: number;
  level: AlertLevel;
  status: 'completed' | 'pending';
  moodTag: string;
  date: string;
}

export type ScreeningRecord = PersonalScreeningRecord;

export interface WarningEvent {
  id: string;
  level: AlertLevel;
  title: string;
  reason: string;
  suggestion: string;
  status: 'new' | 'tracking' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

export interface RetrievalResult {
  id: string;
  similarity: number;
  modality: 'text' | 'audio' | 'image' | 'multimodal';
  summary: string;
  tags: string[];
  alertLevel: AlertLevel;
  date: string;
}

export interface MoodTrendPoint {
  date: string;
  mood: number;
  stress: number;
  sleep: number;
}

export interface PersonalTimelineEvent {
  date: string;
  type: 'screening' | 'warning' | 'collection' | 'plan';
  title: string;
  detail: string;
}

export const userProfile: UserProfile = {
  name: '林晓',
  age: 21,
  gender: '女',
  campus: '南校区',
  major: '软件工程',
  stage: '大三',
  emergencyContact: '室友-陈悦',
};

export const questionnaireCatalog: QuestionnaireItem[] = [
  { id: 'PHQ-9', name: 'PHQ-9 抑郁筛查', description: '评估过去两周抑郁症状程度', questions: 9, minutes: 3, target: '情绪低落、兴趣下降' },
  { id: 'GAD-7', name: 'GAD-7 焦虑筛查', description: '评估焦虑水平与紧张程度', questions: 7, minutes: 2, target: '紧张、担忧、躯体焦虑' },
  { id: 'ISI', name: 'ISI 失眠评估', description: '评估入睡、维持睡眠和早醒问题', questions: 7, minutes: 3, target: '睡眠质量下降' },
  { id: 'PSS-10', name: 'PSS-10 压力量表', description: '评估近期主观压力感知', questions: 10, minutes: 4, target: '学习和生活压力' },
];

export const screeningRecords: PersonalScreeningRecord[] = [
  { id: 'ME-SCR-0318', questionnaire: 'PHQ-9', score: 15, maxScore: 27, level: 'orange', status: 'completed', moodTag: '情绪低落', date: '2026-03-18' },
  { id: 'ME-SCR-0316', questionnaire: 'GAD-7', score: 13, maxScore: 21, level: 'orange', status: 'completed', moodTag: '焦虑反复', date: '2026-03-16' },
  { id: 'ME-SCR-0312', questionnaire: 'ISI', score: 17, maxScore: 28, level: 'yellow', status: 'completed', moodTag: '睡眠不稳', date: '2026-03-12' },
  { id: 'ME-SCR-0308', questionnaire: 'PSS-10', score: 21, maxScore: 40, level: 'yellow', status: 'completed', moodTag: '课程压力', date: '2026-03-08' },
  { id: 'ME-SCR-0304', questionnaire: 'PHQ-9', score: 9, maxScore: 27, level: 'yellow', status: 'completed', moodTag: '波动期', date: '2026-03-04' },
  { id: 'ME-SCR-0320', questionnaire: 'GAD-7', score: 0, maxScore: 21, level: 'green', status: 'pending', moodTag: '待完成', date: '2026-03-20' },
];

export const warningEvents: WarningEvent[] = [
  {
    id: 'WARN-0318-A',
    level: 'red',
    title: '连续负性情绪 + 睡眠下降',
    reason: '过去 7 天文本与语音信号均出现高风险特征，且 PHQ-9 上升到 15 分。',
    suggestion: '建议今天完成一次危机自评，并联系可信赖同伴进行陪伴。',
    status: 'tracking',
    createdAt: '2026-03-18 08:40',
    updatedAt: '2026-03-19 21:00',
  },
  {
    id: 'WARN-0316-B',
    level: 'orange',
    title: '焦虑水平持续偏高',
    reason: 'GAD-7 连续两次 >= 10，跨模态哈希检索命中高相似焦虑案例。',
    suggestion: '进行 10 分钟呼吸训练，并将学习任务拆分为 25 分钟番茄钟。',
    status: 'new',
    createdAt: '2026-03-16 22:10',
    updatedAt: '2026-03-16 22:10',
  },
  {
    id: 'WARN-0312-C',
    level: 'yellow',
    title: '睡眠中断风险',
    reason: 'ISI 评分处于中度风险区间，夜间醒来次数增加。',
    suggestion: '晚间 23:30 前停止使用电子屏幕，固定起床时间。',
    status: 'resolved',
    createdAt: '2026-03-12 07:30',
    updatedAt: '2026-03-15 09:00',
  },
];

export const retrievalResults: RetrievalResult[] = [
  {
    id: 'RET-ME-001',
    similarity: 0.93,
    modality: 'multimodal',
    summary: '与历史案例中“期中周压力-睡眠下降-情绪低落”模式高度一致，需提前干预。',
    tags: ['课程压力', '睡眠下降', '情绪耗竭'],
    alertLevel: 'red',
    date: '2026-03-18',
  },
  {
    id: 'RET-ME-002',
    similarity: 0.86,
    modality: 'audio',
    summary: '语音特征显示语速偏慢、停顿增多，和焦虑-疲惫共存模式相似。',
    tags: ['语音平坦', '精神疲劳'],
    alertLevel: 'orange',
    date: '2026-03-16',
  },
  {
    id: 'RET-ME-003',
    similarity: 0.8,
    modality: 'text',
    summary: '日记文本出现“没有动力”“逃避任务”等关键词，匹配中风险抑郁样本。',
    tags: ['回避行为', '动力不足'],
    alertLevel: 'orange',
    date: '2026-03-15',
  },
  {
    id: 'RET-ME-004',
    similarity: 0.74,
    modality: 'image',
    summary: '绘画与情绪色彩分析提示精力感偏低，但社会连接意愿仍存在。',
    tags: ['低唤醒', '社交意愿保留'],
    alertLevel: 'yellow',
    date: '2026-03-11',
  },
];

export const moodTrend: MoodTrendPoint[] = [
  { date: '03-10', mood: 62, stress: 71, sleep: 6.8 },
  { date: '03-11', mood: 58, stress: 74, sleep: 6.5 },
  { date: '03-12', mood: 55, stress: 76, sleep: 6.1 },
  { date: '03-13', mood: 53, stress: 79, sleep: 5.9 },
  { date: '03-14', mood: 49, stress: 83, sleep: 5.5 },
  { date: '03-15', mood: 52, stress: 78, sleep: 6.2 },
  { date: '03-16', mood: 51, stress: 81, sleep: 5.8 },
  { date: '03-17', mood: 47, stress: 85, sleep: 5.3 },
  { date: '03-18', mood: 45, stress: 87, sleep: 5.1 },
  { date: '03-19', mood: 50, stress: 80, sleep: 6.0 },
];

export const warningDistribution = [
  { name: '稳定', value: 42, color: '#22c55e' },
  { name: '关注', value: 31, color: '#f59e0b' },
  { name: '警告', value: 18, color: '#f97316' },
  { name: '高危', value: 9, color: '#ef4444' },
];

export const personalTimeline: PersonalTimelineEvent[] = [
  { date: '2026-03-19', type: 'plan', title: '执行今日行动计划', detail: '完成 12 分钟呼吸放松 + 15 分钟轻运动。' },
  { date: '2026-03-18', type: 'warning', title: '触发高风险预警', detail: '模型判断为红色预警，建议启动危机应对流程。' },
  { date: '2026-03-18', type: 'screening', title: '完成 PHQ-9 筛查', detail: '总分 15/27，较上次上升 6 分。' },
  { date: '2026-03-16', type: 'collection', title: '提交语音样本', detail: '录音 3 分 40 秒，用于情感特征分析。' },
  { date: '2026-03-12', type: 'screening', title: '完成 ISI 失眠评估', detail: '总分 17/28，睡眠问题处于中度。' },
];

export const actionPlan = [
  { id: 'PLAN-1', title: '5-4-3-2-1 地面化练习', duration: '8 分钟', status: 'new' as const },
  { id: 'PLAN-2', title: '与朋友进行一次 15 分钟通话', duration: '15 分钟', status: 'tracking' as const },
  { id: 'PLAN-3', title: '睡前情绪日记（3条）', duration: '10 分钟', status: 'resolved' as const },
];

export const ragReport = {
  subject: '林晓',
  date: '2026-03-19',
  summary:
    '基于动态跨模态哈希检索与 RAG 结果，你当前处于“中高风险波动期”，风险主要来自持续学习压力、睡眠剥夺和负性自动思维叠加。通过短周期行为干预与同伴支持，风险有较高概率在 1-2 周内下降。',
  riskLevel: 'high' as const,
  sections: [
    {
      title: '量表变化趋势',
      content:
        'PHQ-9 从 9 分上升到 15 分，GAD-7 从 8 分上升到 13 分，提示抑郁和焦虑并行波动。近 10 天情绪评分持续低于 55，属于需重点关注区间。',
    },
    {
      title: '动态跨模态哈希匹配',
      content:
        '文本、语音、图像三类信号在哈希空间中与高相似案例的平均相似度达到 0.83，且语音与文本的一致性较高。模型提示“压力-睡眠-情绪”链式反应明显。',
    },
    {
      title: 'RAG 生成建议',
      content:
        '结合检索到的相似个体恢复路径，最有效策略是：先稳定睡眠，再降低即时压力峰值，最后逐步恢复社交和学习掌控感。建议按行动计划进行 7 天追踪。',
    },
  ],
  recommendations: [
    '未来 3 天优先保证睡眠时长 >= 6.5 小时',
    '每天固定 1 次 8-12 分钟呼吸或正念练习',
    '将高压任务拆解为 25 分钟可执行清单',
    '若出现持续绝望/自伤想法，立即联系校园心理中心或紧急支持资源',
  ],
};
