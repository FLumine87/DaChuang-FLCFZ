export interface ScreeningRecord {
  id: string;
  name: string;
  age: number;
  gender: string;
  questionnaire: string;
  score: number;
  maxScore: number;
  status: 'completed' | 'in_progress' | 'pending';
  alertLevel: 'green' | 'yellow' | 'orange' | 'red';
  date: string;
  counselor: string;
}

export interface AlertRecord {
  id: string;
  screeningId: string;
  name: string;
  level: 'green' | 'yellow' | 'orange' | 'red';
  trigger: string;
  description: string;
  status: 'pending' | 'processing' | 'resolved' | 'closed';
  assignee: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaseRecord {
  id: string;
  name: string;
  age: number;
  gender: string;
  department: string;
  tags: string[];
  screeningCount: number;
  lastScreening: string;
  alertLevel: 'green' | 'yellow' | 'orange' | 'red';
  status: 'active' | 'monitoring' | 'closed';
}

export interface RetrievalResult {
  id: string;
  similarity: number;
  modality: 'text' | 'audio' | 'image' | 'multimodal';
  summary: string;
  tags: string[];
  alertLevel: 'green' | 'yellow' | 'orange' | 'red';
  date: string;
}

export const screeningRecords: ScreeningRecord[] = [
  { id: 'SCR-001', name: '张三', age: 20, gender: '男', questionnaire: 'PHQ-9', score: 18, maxScore: 27, status: 'completed', alertLevel: 'red', date: '2026-03-12', counselor: '李老师' },
  { id: 'SCR-002', name: '李四', age: 22, gender: '女', questionnaire: 'GAD-7', score: 12, maxScore: 21, status: 'completed', alertLevel: 'orange', date: '2026-03-11', counselor: '王老师' },
  { id: 'SCR-003', name: '王五', age: 19, gender: '男', questionnaire: 'SCL-90', score: 180, maxScore: 450, status: 'completed', alertLevel: 'yellow', date: '2026-03-11', counselor: '李老师' },
  { id: 'SCR-004', name: '赵六', age: 21, gender: '女', questionnaire: 'PHQ-9', score: 4, maxScore: 27, status: 'completed', alertLevel: 'green', date: '2026-03-10', counselor: '王老师' },
  { id: 'SCR-005', name: '孙七', age: 23, gender: '男', questionnaire: 'GAD-7', score: 15, maxScore: 21, status: 'completed', alertLevel: 'red', date: '2026-03-10', counselor: '李老师' },
  { id: 'SCR-006', name: '周八', age: 20, gender: '女', questionnaire: 'PHQ-9', score: 8, maxScore: 27, status: 'in_progress', alertLevel: 'yellow', date: '2026-03-09', counselor: '张老师' },
  { id: 'SCR-007', name: '吴九', age: 21, gender: '男', questionnaire: 'SCL-90', score: 120, maxScore: 450, status: 'completed', alertLevel: 'green', date: '2026-03-09', counselor: '王老师' },
  { id: 'SCR-008', name: '郑十', age: 22, gender: '女', questionnaire: 'GAD-7', score: 10, maxScore: 21, status: 'pending', alertLevel: 'orange', date: '2026-03-08', counselor: '李老师' },
];

export const alertRecords: AlertRecord[] = [
  { id: 'ALT-001', screeningId: 'SCR-001', name: '张三', level: 'red', trigger: 'PHQ-9 得分 18 (≥15)', description: '重度抑郁倾向，存在自伤风险条目阳性', status: 'processing', assignee: '李老师', createdAt: '2026-03-12 09:30', updatedAt: '2026-03-12 10:15' },
  { id: 'ALT-002', screeningId: 'SCR-005', name: '孙七', level: 'red', trigger: 'GAD-7 得分 15 (≥15)', description: '重度焦虑，伴有躯体化症状', status: 'pending', assignee: '李老师', createdAt: '2026-03-10 14:20', updatedAt: '2026-03-10 14:20' },
  { id: 'ALT-003', screeningId: 'SCR-002', name: '李四', level: 'orange', trigger: 'GAD-7 得分 12 (≥10)', description: '中度焦虑，建议进一步评估', status: 'processing', assignee: '王老师', createdAt: '2026-03-11 11:00', updatedAt: '2026-03-11 15:30' },
  { id: 'ALT-004', screeningId: 'SCR-003', name: '王五', level: 'yellow', trigger: 'SCL-90 总分 180 (≥160)', description: '轻度心理问题，建议关注', status: 'resolved', assignee: '李老师', createdAt: '2026-03-11 10:00', updatedAt: '2026-03-12 09:00' },
  { id: 'ALT-005', screeningId: 'SCR-008', name: '郑十', level: 'orange', trigger: 'GAD-7 得分 10 (≥10)', description: '中度焦虑倾向', status: 'pending', assignee: '李老师', createdAt: '2026-03-08 16:00', updatedAt: '2026-03-08 16:00' },
];

export const caseRecords: CaseRecord[] = [
  { id: 'CASE-001', name: '张三', age: 20, gender: '男', department: '计算机学院', tags: ['抑郁', '自伤风险'], screeningCount: 3, lastScreening: '2026-03-12', alertLevel: 'red', status: 'active' },
  { id: 'CASE-002', name: '李四', age: 22, gender: '女', department: '文学院', tags: ['焦虑'], screeningCount: 2, lastScreening: '2026-03-11', alertLevel: 'orange', status: 'active' },
  { id: 'CASE-003', name: '王五', age: 19, gender: '男', department: '理学院', tags: ['压力', '睡眠问题'], screeningCount: 4, lastScreening: '2026-03-11', alertLevel: 'yellow', status: 'monitoring' },
  { id: 'CASE-004', name: '赵六', age: 21, gender: '女', department: '艺术学院', tags: ['适应性'], screeningCount: 1, lastScreening: '2026-03-10', alertLevel: 'green', status: 'closed' },
  { id: 'CASE-005', name: '孙七', age: 23, gender: '男', department: '工学院', tags: ['焦虑', '躯体化'], screeningCount: 2, lastScreening: '2026-03-10', alertLevel: 'red', status: 'active' },
  { id: 'CASE-006', name: '周八', age: 20, gender: '女', department: '经管学院', tags: ['抑郁倾向'], screeningCount: 1, lastScreening: '2026-03-09', alertLevel: 'yellow', status: 'monitoring' },
];

export const retrievalResults: RetrievalResult[] = [
  { id: 'RET-001', similarity: 0.94, modality: 'text', summary: '男性，20岁，PHQ-9得分17，存在明显的兴趣缺失和睡眠障碍，历史上有类似波动', tags: ['抑郁', '睡眠障碍'], alertLevel: 'red', date: '2025-12-15' },
  { id: 'RET-002', similarity: 0.89, modality: 'multimodal', summary: '男性，21岁，语音分析显示情绪低落特征，文本中多次出现消极词汇', tags: ['情绪低落', '消极认知'], alertLevel: 'red', date: '2025-11-20' },
  { id: 'RET-003', similarity: 0.85, modality: 'text', summary: '女性，19岁，GAD-7得分14，伴有躯体化焦虑症状', tags: ['焦虑', '躯体化'], alertLevel: 'orange', date: '2026-01-08' },
  { id: 'RET-004', similarity: 0.78, modality: 'image', summary: '绘画测试分析：房树人测试显示自我认知偏低，社会支持感薄弱', tags: ['自我认知', '社会支持'], alertLevel: 'yellow', date: '2026-02-03' },
  { id: 'RET-005', similarity: 0.72, modality: 'audio', summary: '语音情感分析：语速偏慢，音调平坦，情感表达抑制', tags: ['情感抑制', '语音特征'], alertLevel: 'orange', date: '2026-01-25' },
];

export const trendData = [
  { date: '03-01', count: 12, alerts: 2 },
  { date: '03-02', count: 8, alerts: 1 },
  { date: '03-03', count: 15, alerts: 3 },
  { date: '03-04', count: 10, alerts: 2 },
  { date: '03-05', count: 18, alerts: 4 },
  { date: '03-06', count: 14, alerts: 2 },
  { date: '03-07', count: 20, alerts: 5 },
  { date: '03-08', count: 16, alerts: 3 },
  { date: '03-09', count: 22, alerts: 4 },
  { date: '03-10', count: 19, alerts: 3 },
  { date: '03-11', count: 25, alerts: 6 },
  { date: '03-12', count: 15, alerts: 2 },
];

export const alertDistribution = [
  { name: '正常(绿)', value: 45, color: '#22c55e' },
  { name: '关注(黄)', value: 28, color: '#f59e0b' },
  { name: '警告(橙)', value: 18, color: '#f97316' },
  { name: '危险(红)', value: 9, color: '#ef4444' },
];

export const ragReport = {
  subject: '张三',
  date: '2026-03-12',
  summary: '综合多模态数据分析，该被试呈现明显的抑郁症状特征，需要高度关注和及时干预。',
  riskLevel: 'high' as const,
  sections: [
    {
      title: '量表分析',
      content: 'PHQ-9得分18分（重度抑郁），其中"对事物缺乏兴趣"和"感到疲倦或没有精力"两项得分最高。与上次筛查（得分12分）相比，症状有明显加重趋势。GAD-7得分8分（轻度焦虑），存在焦虑共病可能。',
    },
    {
      title: '跨模态特征匹配',
      content: '通过动态跨模态哈希检索，匹配到5例高相似度历史案例（相似度>0.7）。其中2例最终确诊为重度抑郁障碍，1例伴有自伤行为。检索结果提示当前案例具有较高的风险特征。哈希编码在文本和语音模态上的一致性为0.91，表明多模态信号高度一致。',
    },
    {
      title: '语音情感分析',
      content: '语音样本分析显示：语速较正常偏慢（-23%），音调变化幅度减小（平坦化），停顿频率增加。情感分类结果为"悲伤"（置信度0.82），这些特征与抑郁症状的语音表现一致。',
    },
    {
      title: '综合评估结论',
      content: '基于RAG分析引擎综合以上多维度信息，结合知识库中的临床指南和循证数据，评估该被试当前处于重度抑郁状态，存在进一步恶化的风险。建议立即安排专业心理咨询师进行面谈评估，必要时转介精神科。',
    },
  ],
  recommendations: [
    '立即安排专业心理咨询师一对一面谈',
    '评估自伤/自杀风险，必要时启动危机干预流程',
    '通知辅导员和院系相关负责人',
    '建议每周至少一次跟踪评估',
    '考虑转介至专业精神卫生机构',
  ],
};
