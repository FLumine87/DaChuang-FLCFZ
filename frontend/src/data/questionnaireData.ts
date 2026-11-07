export type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

/** The server uses the same version to map original option indices to scores. */
export const QUESTIONNAIRE_VERSION = '2026-11-standard-v1';
export const QUESTIONNAIRE_ANSWER_ENCODING = 'option-index' as const;

/** Local preview only; the server recomputes the result from original answers. */
export function calculateQuestionnaireScore(id: string, answers: Record<string, number>): number {
  const reversed = id === 'PSS-10' ? new Set(['4', '5', '7', '8']) : new Set<string>();
  return Object.entries(answers).reduce((sum, [question, option]) =>
    sum + (reversed.has(question) ? 4 - option : option), 0);
}

export interface QuestionOption {
  /** Original 0-based response, before any reverse scoring. */
  value: number;
  label: string;
}

export interface Question {
  id: number;
  text: string;
  options: QuestionOption[];
}

export interface QuestionnaireDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  introduction: {
    summary: string;
    measures: string[];
    suitableFor: string;
    recallPeriod: string;
    scoreBands: { range: string; label: string }[];
    notice: string;
  };
  questions: Question[];
  scoring: (total: number) => {
    level: AlertLevel;
    label: string;
    description: string;
  };
}

const frequency4: QuestionOption[] = [
  { value: 0, label: '完全不会' },
  { value: 1, label: '好几天' },
  { value: 2, label: '一半以上的天数' },
  { value: 3, label: '几乎每天' },
];

const frequency5: QuestionOption[] = [
  { value: 0, label: '从不' },
  { value: 1, label: '偶尔' },
  { value: 2, label: '有时' },
  { value: 3, label: '经常' },
  { value: 4, label: '总是' },
];

// PSS-10 item order and reverse scoring: Cohen laboratory, CMU.
// https://www.cmu.edu/dietrich/psychology/stress-immunity-disease-lab/scales/html/pssscoring.html
// Unlike the previous mixed PSS-14 items, only items 4, 5, 7, 8 reverse.

export const questionnaires: QuestionnaireDefinition[] = [
  {
    id: 'PHQ-9',
    name: 'PHQ-9 抑郁筛查',
    description: '评估过去两周抑郁症状程度',
    instructions: '在过去 2 周里，你有多少时候受到以下问题的困扰？',
    introduction: {
      summary: 'PHQ-9 是一份简短的抑郁症状自评量表，通过 9 个问题了解近期情绪和生活状态。它用于帮助发现需要进一步关注的信号，不等同于医学诊断。',
      measures: ['兴趣或愉悦感下降', '情绪低落与绝望感', '睡眠、精力和食欲变化', '自我评价、注意力与行动状态'],
      suitableFor: '最近持续心情低落、做事提不起兴趣，或想了解自己近期抑郁相关症状时。',
      recallPeriod: '请按照过去 2 周的真实情况作答。',
      scoreBands: [
        { range: '0–4', label: '无或极轻' },
        { range: '5–9', label: '轻度' },
        { range: '10–14', label: '中度' },
        { range: '15–19', label: '中重度' },
        { range: '20–27', label: '重度' },
      ],
      notice: '结果仅用于初步筛查。第 9 题涉及伤害自己的想法；如果该题不是“完全不会”，无论总分多少，都建议尽快联系心理老师、心理咨询师、医疗专业人员或身边可信任的人。',
    },
    questions: [
      { id: 1, text: '做事时提不起劲或没有兴趣', options: frequency4 },
      { id: 2, text: '感到心情低落、沮丧或绝望', options: frequency4 },
      { id: 3, text: '入睡困难、睡不安稳或睡眠过多', options: frequency4 },
      { id: 4, text: '感觉疲倦或没有精力', options: frequency4 },
      { id: 5, text: '食欲不振或吃太多', options: frequency4 },
      { id: 6, text: '觉得自己很糟——或觉得自己很失败，或让自己或家人失望', options: frequency4 },
      { id: 7, text: '对事物专注困难，例如看报纸或看电视时', options: frequency4 },
      { id: 8, text: '行动或说话速度慢到让人注意到？或者刚好相反——坐立不安，动来动去', options: frequency4 },
      { id: 9, text: '有不如死掉或用某种方式伤害自己的念头', options: frequency4 },
    ],
    scoring: (total) => {
      if (total <= 4) return { level: 'green', label: '无或极轻抑郁症状', description: '本次量表提示无或极轻抑郁症状，不代表整体心理健康结论。第 9 题需要单独关注。' };
      if (total <= 9) return { level: 'yellow', label: '轻度抑郁症状', description: '本次量表提示轻度抑郁症状，建议关注困扰和生活影响，必要时寻求专业支持。' };
      if (total <= 14) return { level: 'orange', label: '中度抑郁症状', description: '本次量表提示中度抑郁症状，建议进一步专业评估；筛查结果不等于疾病诊断。' };
      if (total <= 19) return { level: 'orange', label: '中重度抑郁症状', description: '本次量表提示中重度抑郁症状，建议尽快进一步专业评估。症状程度与安全紧急性分别判断。' };
      return { level: 'orange', label: '重度抑郁症状', description: '本次量表提示重度抑郁症状，建议尽快联系专业人员进一步评估。总分不单独决定危机等级。' };
    },
  },
  {
    id: 'GAD-7',
    name: 'GAD-7 焦虑筛查',
    description: '评估焦虑水平与紧张程度',
    instructions: '在过去 2 周里，你有多少时候受到以下问题的困扰？',
    introduction: {
      summary: 'GAD-7 用 7 个问题了解近期焦虑症状的频率，重点关注担忧是否难以控制，以及紧张感是否已经影响日常生活。',
      measures: ['紧张、焦虑或不安', '难以停止或控制担忧', '难以放松和坐立不安', '烦躁以及对坏事发生的担心'],
      suitableFor: '最近经常担心、容易紧张、难以放松，或者感觉脑子一直停不下来时。',
      recallPeriod: '请按照过去 2 周的真实情况作答。',
      scoreBands: [
        { range: '0–4', label: '无或极轻' },
        { range: '5–9', label: '轻度' },
        { range: '10–14', label: '中度' },
        { range: '15–21', label: '重度' },
      ],
      notice: '分数反映焦虑症状的多少和频率，不代表已经患有焦虑障碍。若症状持续、明显影响学习、工作、睡眠或人际关系，建议寻求专业评估。',
    },
    questions: [
      { id: 1, text: '感到紧张、焦虑或处于崩溃边缘', options: frequency4 },
      { id: 2, text: '不能停止或控制担忧', options: frequency4 },
      { id: 3, text: '对各种各样的事情担忧过多', options: frequency4 },
      { id: 4, text: '很难放松下来', options: frequency4 },
      { id: 5, text: '烦躁不安以至于无法静坐', options: frequency4 },
      { id: 6, text: '容易烦恼或急躁', options: frequency4 },
      { id: 7, text: '感到好像有什么可怕的事情会发生', options: frequency4 },
    ],
    scoring: (total) => {
      if (total <= 4) return { level: 'green', label: '无或极轻焦虑症状', description: '本次量表提示无或极轻焦虑症状，不代表整体心理健康结论。' };
      if (total <= 9) return { level: 'yellow', label: '轻度焦虑症状', description: '存在轻度焦虑症状，建议关注困扰及其对日常生活的影响。' };
      if (total <= 14) return { level: 'orange', label: '中度焦虑症状', description: '存在中度焦虑症状，建议寻求专业帮助。' };
      return { level: 'orange', label: '重度焦虑症状', description: '本次量表提示重度焦虑症状，建议尽快进一步专业评估。总分不单独决定危机等级。' };
    },
  },
  {
    id: 'ISI',
    name: 'ISI 失眠评估',
    description: '评估入睡、维持睡眠和早醒问题',
    instructions: '请评估你在过去 2 周内的睡眠问题程度：',
    introduction: {
      summary: 'ISI 是失眠严重程度指数，用来了解主观睡眠困难及其对白天生活的影响。它不仅关注睡了多久，也关注你对睡眠的感受。',
      measures: ['入睡困难、夜间醒来和早醒', '对当前睡眠的满意程度', '睡眠对精力、注意力和情绪的影响', '对睡眠问题的担忧程度'],
      suitableFor: '最近入睡时间很长、夜间容易醒、醒得过早，或睡眠已经影响白天状态时。',
      recallPeriod: '请按照过去 2 周的睡眠情况作答。',
      scoreBands: [
        { range: '0–7', label: '无明显失眠' },
        { range: '8–14', label: '轻度' },
        { range: '15–21', label: '中度' },
        { range: '22–28', label: '重度' },
      ],
      notice: '量表反映的是你感受到的睡眠困难，不能替代睡眠障碍诊断。若失眠持续存在、白天功能明显受影响，建议咨询医生或睡眠专业人员。',
    },
    questions: [
      { id: 1, text: '入睡困难的严重程度', options: [{ value: 0, label: '无' }, { value: 1, label: '轻度' }, { value: 2, label: '中度' }, { value: 3, label: '重度' }, { value: 4, label: '极重度' }] },
      { id: 2, text: '难以维持睡眠（夜间频繁醒来或醒来后再入睡困难）', options: [{ value: 0, label: '无' }, { value: 1, label: '轻度' }, { value: 2, label: '中度' }, { value: 3, label: '重度' }, { value: 4, label: '极重度' }] },
      { id: 3, text: '早醒后无法再入睡', options: [{ value: 0, label: '无' }, { value: 1, label: '轻度' }, { value: 2, label: '中度' }, { value: 3, label: '重度' }, { value: 4, label: '极重度' }] },
      { id: 4, text: '对你目前的睡眠状况满意程度', options: [{ value: 0, label: '非常满意' }, { value: 1, label: '满意' }, { value: 2, label: '一般' }, { value: 3, label: '不满意' }, { value: 4, label: '非常不满意' }] },
      { id: 5, text: '你认为你的睡眠问题在多大程度上影响了你的日间功能（如疲劳、注意力、记忆力、情绪等）', options: [{ value: 0, label: '完全无影响' }, { value: 1, label: '轻微影响' }, { value: 2, label: '有些影响' }, { value: 3, label: '明显影响' }, { value: 4, label: '严重影响' }] },
      { id: 6, text: '你的睡眠问题对生活质量的影响与损害程度在他人眼中有多明显', options: [{ value: 0, label: '完全没有' }, { value: 1, label: '轻微' }, { value: 2, label: '有些' }, { value: 3, label: '明显' }, { value: 4, label: '非常明显' }] },
      { id: 7, text: '你对目前睡眠问题的担忧和苦恼程度', options: [{ value: 0, label: '完全不担心' }, { value: 1, label: '有点' }, { value: 2, label: '有些' }, { value: 3, label: '很担心' }, { value: 4, label: '极度担心' }] },
    ],
    scoring: (total) => {
      if (total <= 7) return { level: 'green', label: '无明显失眠症状', description: '本次量表未提示明显失眠症状；若仍有困扰，可以补充具体情况。' };
      if (total <= 14) return { level: 'yellow', label: '轻度失眠', description: '存在轻度失眠，建议保持规律睡眠时间，减少睡前屏幕使用。' };
      if (total <= 21) return { level: 'orange', label: '中度失眠', description: '存在中度失眠，建议进行睡眠卫生干预，必要时咨询专业人员。' };
      return { level: 'orange', label: '重度失眠症状', description: '本次量表提示重度失眠症状，建议尽快寻求专业评估；不据总分判定危机。' };
    },
  },
  {
    id: 'PSS-10',
    name: 'PSS-10 压力量表',
    description: '评估近期主观压力感知',
    instructions: '以下问题询问你在过去一个月里的感受和想法，请对每个问题选择出现的频率：',
    introduction: {
      summary: 'PSS-10 用来了解你主观感受到的压力，重点是生活是否让你觉得不可预测、难以控制或难以应付。它不针对某一种心理疾病。',
      measures: ['意外事件带来的烦恼', '对重要事情的控制感', '紧张和压力感', '处理问题与应对变化的信心'],
      suitableFor: '最近学习、工作或生活负担较重，想了解自己的压力感受和应对状态时。',
      recallPeriod: '请按照过去 1 个月的总体感受作答。',
      scoreBands: [{ range: '0–40', label: '连续压力自评分数，无统一诊断分界值' }],
      notice: 'PSS-10 不用于诊断心理疾病，没有统一的临床分界值。本次展示连续分数，结合生活背景及同版本复评观察变化，不把高分直接标为危机。',
    },
    questions: [
      { id: 1, text: '因为某些意外发生而感到烦恼？', options: frequency5 },
      { id: 2, text: '感到无法控制你生活中的重要事情？', options: frequency5 },
      { id: 3, text: '感到紧张和压力？', options: frequency5 },
      { id: 4, text: '对自己处理个人问题的能力感到有信心？', options: frequency5 },
      { id: 5, text: '感到事情按照你的意愿发展？', options: frequency5 },
      { id: 6, text: '发现自己无法处理所有必须做的事情？', options: frequency5 },
      { id: 7, text: '能够控制生活中令你烦恼的事情？', options: frequency5 },
      { id: 8, text: '觉得自己能掌握事情的发展？', options: frequency5 },
      { id: 9, text: '因为无法控制的事情而感到生气？', options: frequency5 },
      { id: 10, text: '感到困难的事情累积太多，以致无法克服？', options: frequency5 },
    ],
    scoring: () => ({ level: 'yellow', label: '压力自评分数', description: 'PSS-10 没有统一诊断分界值，请结合生活背景理解 0–40 分的连续结果。同版本复评可用于观察变化；不按总分判定疾病或危机。' }),
  },
];
