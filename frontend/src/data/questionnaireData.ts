export type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

/** The server uses the same version to map original option indices to scores. */
export const QUESTIONNAIRE_VERSION = '2026-11-standard-v1';
export const QUESTIONNAIRE_ANSWER_ENCODING = 'option-index' as const;

/** 反向计分表：题号 → (是否反向, 满分)。原始值按 满分 − 原始值 计入总分。 */
const REVERSE_ITEMS: Record<string, { items: Set<string>; max: number }> = {
  'PSS-10': { items: new Set(['4', '5', '7', '8']), max: 4 },
  SAS: { items: new Set(['5', '9', '13', '17', '19']), max: 5 },
};

/**
 * PSQI 七成分算法（Buysse 等 1989）。
 * 题目编号：1 上床时间 / 2 入睡耗时(分钟) / 3 起床时间 / 4 实际睡眠(分钟) /
 *          5~14 = Q5a~Q5j（0~3）/ 15 整体睡眠质量 / 16 服药 / 17 日间困倦 / 18 精力不足
 * 返回 7 个成分分（各 0~3），总分 0~21，>7 提示睡眠质量差。
 */
export function psqiComponents(answers: Record<string, number>): number[] {
  const q = (k: string) => answers[k] ?? 0;
  const twoToThree = (v: number) => (v <= 0 ? 0 : v <= 2 ? 1 : v <= 4 ? 2 : 3);
  const latency = q('2');
  const latencyBand = latency <= 15 ? 0 : latency <= 30 ? 1 : latency <= 60 ? 2 : 3;
  const c1 = q('15');
  const c2 = twoToThree(latencyBand + q('5'));
  const dur = q('4');
  const c3 = dur > 420 ? 0 : dur > 360 ? 1 : dur > 300 ? 2 : 3;
  const bed = q('1');
  const wake = q('3');
  const inBed = ((wake - bed) + 1440) % 1440 || 1;
  const rate = Math.min(100, Math.round((dur / inBed) * 100));
  const c4 = rate > 85 ? 0 : rate >= 75 ? 1 : rate >= 65 ? 2 : 3;
  const disturbance = [6, 7, 8, 9, 10, 11, 12, 13, 14].reduce((s, id) => s + q(String(id)), 0);
  const c5 = disturbance === 0 ? 0 : disturbance <= 9 ? 1 : disturbance <= 18 ? 2 : 3;
  const c6 = q('16');
  const c7 = twoToThree(q('17') + q('18'));
  return [c1, c2, c3, c4, c5, c6, c7];
}

/** Local preview only; the server recomputes the result from original answers. */
export function calculateQuestionnaireScore(id: string, answers: Record<string, number>): number {
  // PSQI 不是把 18 道题直接相加，先算七个成分再求和（详见 psqiComponents）
  if (id === 'PSQI') return psqiComponents(answers).reduce((s, v) => s + v, 0);
  const reverse = REVERSE_ITEMS[id];
  if (!reverse) {
    return Object.values(answers).reduce((sum, option) => sum + option, 0);
  }
  return Object.entries(answers).reduce((sum, [question, option]) =>
    sum + (reverse.items.has(question) ? reverse.max - option : option), 0);
}

export interface QuestionOption {
  /** Original 0-based response, before any reverse scoring. */
  value: number;
  label: string;
}

/**
 * 题型：
 *   choice（默认）—— 选项按钮组
 *   time           —— 时刻选择，答案存「当天第几分钟」（0~1439），如 23:30 → 1410
 *   number         —— 数值输入（分钟数）或 0~3 量表按钮
 * PSQI 的上床/起床时间与入睡耗时、睡眠时长依赖这些题型；
 * 其余量表全是 choice，不受影响。
 */
export type QuestionKind = 'choice' | 'time' | 'number';

export interface Question {
  id: number;
  text: string;
  kind?: QuestionKind;
  /** time / number 为空数组；choice 必填 */
  options: QuestionOption[];
  /** time / number 的补充说明 */
  hint?: string;
  /** number 的取值下限/上限与单位（分钟） */
  min?: number;
  max?: number;
  unit?: string;
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
  /** 满分：含 time/number 题的量表无法用“选项最大值×题数”推算，这里显式给出 */
  maxScore?: number;
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

/** UCLA-3：1~3 分（总分 3~9，注意不是从 0 起） */
const ucla3: QuestionOption[] = [
  { value: 1, label: '很少' },
  { value: 2, label: '有时' },
  { value: 3, label: '经常' },
];

/** SAS：1~4 分（粗分 20~80，标准分 = 粗分 × 1.25） */
const sas4: QuestionOption[] = [
  { value: 1, label: '没有或很少时间' },
  { value: 2, label: '小部分时间' },
  { value: 3, label: '相当多时间' },
  { value: 4, label: '绝大部分或全部时间' },
];

/** PSQI 频率题：0~3 */
const psqi4: QuestionOption[] = [
  { value: 0, label: '没有' },
  { value: 1, label: '每周不到 1 次' },
  { value: 2, label: '每周 1~2 次' },
  { value: 3, label: '每周 3 次以上' },
];

/** PSQI 主观睡眠质量：0~3（0 最好） */
const psqiQuality: QuestionOption[] = [
  { value: 0, label: '很好' },
  { value: 1, label: '较好' },
  { value: 2, label: '较差' },
  { value: 3, label: '很差' },
];

/** PSQI 日间精力不足：0~3（0 最好） */
const psqiEnergy: QuestionOption[] = [
  { value: 0, label: '没有' },
  { value: 1, label: '偶尔有' },
  { value: 2, label: '有时有' },
  { value: 3, label: '经常有' },
];

// PSS-10 item order and reverse scoring: Cohen laboratory, CMU.
// https://www.cmu.edu/dietrich/psychology/stress-immunity-disease-lab/scales/html/pssscoring.html
// Unlike the previous mixed PSS-14 items, only items 4, 5, 7, 8 reverse.

export const questionnaires: QuestionnaireDefinition[] = [
  {
    id: 'PHQ-9',
    name: 'PHQ-9 抑郁筛查',
    description: '评估过去两周抑郁症状程度',
    instructions: '在过去 2 周里，您有多少时候受到以下问题的困扰？',
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
    instructions: '在过去 2 周里，您有多少时候受到以下问题的困扰？',
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
    instructions: '请评估您在过去 2 周内的睡眠问题程度：',
    introduction: {
      summary: 'ISI 是失眠严重程度指数，用来了解主观睡眠困难及其对白天生活的影响。它不仅关注睡了多久，也关注您对睡眠的感受。',
      measures: ['入睡困难、夜间醒来和早醒', '对当前睡眠的满意程度', '睡眠对精力、注意力和情绪的影响', '对睡眠问题的担忧程度'],
      suitableFor: '最近入睡时间很长、夜间容易醒、醒得过早，或睡眠已经影响白天状态时。',
      recallPeriod: '请按照过去 2 周的睡眠情况作答。',
      scoreBands: [
        { range: '0–7', label: '无明显失眠' },
        { range: '8–14', label: '轻度' },
        { range: '15–21', label: '中度' },
        { range: '22–28', label: '重度' },
      ],
      notice: '量表反映的是您感受到的睡眠困难，不能替代睡眠障碍诊断。若失眠持续存在、白天功能明显受影响，建议咨询医生或睡眠专业人员。',
    },
    questions: [
      { id: 1, text: '入睡困难的严重程度', options: [{ value: 0, label: '无' }, { value: 1, label: '轻度' }, { value: 2, label: '中度' }, { value: 3, label: '重度' }, { value: 4, label: '极重度' }] },
      { id: 2, text: '难以维持睡眠（夜间频繁醒来或醒来后再入睡困难）', options: [{ value: 0, label: '无' }, { value: 1, label: '轻度' }, { value: 2, label: '中度' }, { value: 3, label: '重度' }, { value: 4, label: '极重度' }] },
      { id: 3, text: '早醒后无法再入睡', options: [{ value: 0, label: '无' }, { value: 1, label: '轻度' }, { value: 2, label: '中度' }, { value: 3, label: '重度' }, { value: 4, label: '极重度' }] },
      { id: 4, text: '对您目前的睡眠状况满意程度', options: [{ value: 0, label: '非常满意' }, { value: 1, label: '满意' }, { value: 2, label: '一般' }, { value: 3, label: '不满意' }, { value: 4, label: '非常不满意' }] },
      { id: 5, text: '您认为您的睡眠问题在多大程度上影响了您的日间功能（如疲劳、注意力、记忆力、情绪等）', options: [{ value: 0, label: '完全无影响' }, { value: 1, label: '轻微影响' }, { value: 2, label: '有些影响' }, { value: 3, label: '明显影响' }, { value: 4, label: '严重影响' }] },
      { id: 6, text: '您的睡眠问题对生活质量的影响与损害程度在他人眼中有多明显', options: [{ value: 0, label: '完全没有' }, { value: 1, label: '轻微' }, { value: 2, label: '有些' }, { value: 3, label: '明显' }, { value: 4, label: '非常明显' }] },
      { id: 7, text: '您对目前睡眠问题的担忧和苦恼程度', options: [{ value: 0, label: '完全不担心' }, { value: 1, label: '有点' }, { value: 2, label: '有些' }, { value: 3, label: '很担心' }, { value: 4, label: '极度担心' }] },
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
    instructions: '以下问题询问您在过去一个月里的感受和想法，请对每个问题选择出现的频率：',
    introduction: {
      summary: 'PSS-10 用来了解您主观感受到的压力，重点是生活是否让您觉得不可预测、难以控制或难以应付。它不针对某一种心理疾病。',
      measures: ['意外事件带来的烦恼', '对重要事情的控制感', '紧张和压力感', '处理问题与应对变化的信心'],
      suitableFor: '最近学习、工作或生活负担较重，想了解自己的压力感受和应对状态时。',
      recallPeriod: '请按照过去 1 个月的总体感受作答。',
      scoreBands: [{ range: '0–40', label: '连续压力自评分数，无统一诊断分界值' }],
      notice: 'PSS-10 不用于诊断心理疾病，没有统一的临床分界值。本次展示连续分数，结合生活背景及同版本复评观察变化，不把高分直接标为危机。',
    },
    questions: [
      { id: 1, text: '因为某些意外发生而感到烦恼？', options: frequency5 },
      { id: 2, text: '感到无法控制您生活中的重要事情？', options: frequency5 },
      { id: 3, text: '感到紧张和压力？', options: frequency5 },
      { id: 4, text: '对自己处理个人问题的能力感到有信心？', options: frequency5 },
      { id: 5, text: '感到事情按照您的意愿发展？', options: frequency5 },
      { id: 6, text: '发现自己无法处理所有必须做的事情？', options: frequency5 },
      { id: 7, text: '能够控制生活中令您烦恼的事情？', options: frequency5 },
      { id: 8, text: '觉得自己能掌握事情的发展？', options: frequency5 },
      { id: 9, text: '因为无法控制的事情而感到生气？', options: frequency5 },
      { id: 10, text: '感到困难的事情累积太多，以致无法克服？', options: frequency5 },
    ],
    scoring: () => ({ level: 'yellow', label: '压力自评分数', description: 'PSS-10 没有统一诊断分界值，请结合生活背景理解 0–40 分的连续结果。同版本复评可用于观察变化；不按总分判定疾病或危机。' }),
  },
  // ---------------- UCLA-3 孤独感（Hughes 等 2004）：3 题、每题 1~3、总分 3~9 ----------------
  {
    id: 'UCLA-3',
    name: 'UCLA-3 孤独感量表',
    description: '三项量表，快速了解近期的孤独感',
    instructions: '请回想最近一段时间，选择最接近您感受的一项。',
    introduction: {
      summary: 'UCLA-3 是三项孤独感量表，用三个问题了解您感到缺少陪伴、被冷落、与他人隔绝的频率。它很短，适合随时做一次，用来看近期的变化。',
      measures: ['缺少陪伴的感受', '被冷落的感受', '与他人隔绝的感受'],
      suitableFor: '最近觉得没什么人说得上话，或想快速了解自己近期的人际感受时。',
      recallPeriod: '请按最近一段时间的整体感受作答。',
      scoreBands: [
        { range: '3–5', label: '孤独感低' },
        { range: '6–7', label: '需要关注' },
        { range: '8–9', label: '孤独感偏高' },
      ],
      notice: '孤独感是常见的感受，不等于心理疾病。评分偏高时，优先考虑联系可信任的人或学校的心理支持资源。',
    },
    questions: [
      { id: 1, text: '你多久感到缺少陪伴？', options: ucla3 },
      { id: 2, text: '你多久感到被冷落？', options: ucla3 },
      { id: 3, text: '你多久感到与他人隔绝？', options: ucla3 },
    ],
    scoring: (total) => {
      if (total <= 5) return { level: 'green', label: '孤独感低', description: '本次结果提示近期孤独感较低，人际连结状况尚可。' };
      if (total <= 7) return { level: 'yellow', label: '孤独感需要关注', description: '本次结果提示孤独感有所上升，建议留意最近的社交状态与情绪变化。' };
      return { level: 'orange', label: '孤独感偏高', description: '本次结果提示孤独感偏高，建议主动联系可信任的人，必要时寻求学校心理支持。' };
    },
  },
  // ---------------- SAS 焦虑自评量表（Zung）：20 题、1~4 计分、第 5/9/13/17/19 反向 ----------------
  {
    id: 'SAS',
    name: 'SAS 焦虑自评量表',
    description: '20 题自评，评估近一周的焦虑症状',
    instructions: '请根据最近一周的实际感觉，选择最符合的一项。有些题目是正向描述，请照实作答。',
    introduction: {
      summary: 'SAS 是经典的焦虑自评量表，20 个题目覆盖紧张、害怕、心慌、躯体不适等焦虑相关体验。它与 GAD-7 互为补充：GAD-7 更短更快，SAS 覆盖的躯体症状更细。',
      measures: ['紧张与着急', '害怕与失控感', '心慌、头晕、手脚发麻等躯体感受', '睡眠与消化相关困扰'],
      suitableFor: '最近容易紧张、担心、心慌，或想从更细的躯体症状角度了解焦虑程度时。',
      recallPeriod: '请按照最近一周的真实情况作答。',
      scoreBands: [
        { range: '标准分 <50', label: '无焦虑症状' },
        { range: '标准分 50–59', label: '轻度焦虑' },
        { range: '标准分 60–69', label: '中度焦虑' },
        { range: '标准分 ≥70', label: '重度焦虑' },
      ],
      notice: 'SAS 用标准分（粗分 × 1.25 取整）判断程度，结果仅用于筛查参考，不等同于焦虑障碍的诊断。',
    },
    questions: [
      { id: 1, text: '我觉得比平常容易紧张和着急', options: sas4 },
      { id: 2, text: '我无缘无故地感到害怕', options: sas4 },
      { id: 3, text: '我容易心里烦乱或觉得惊恐', options: sas4 },
      { id: 4, text: '我觉得我可能将要发疯', options: sas4 },
      { id: 5, text: '我觉得一切都很好，也不会发生什么不幸', options: sas4 },
      { id: 6, text: '我手脚发抖打颤', options: sas4 },
      { id: 7, text: '我因为头痛、颈痛和背痛而苦恼', options: sas4 },
      { id: 8, text: '我感觉容易衰弱和疲乏', options: sas4 },
      { id: 9, text: '我觉得心平气和，并且容易安静坐着', options: sas4 },
      { id: 10, text: '我觉得心跳得很快', options: sas4 },
      { id: 11, text: '我因为一阵阵头晕而苦恼', options: sas4 },
      { id: 12, text: '我有过晕倒发作，或觉得要晕倒似的', options: sas4 },
      { id: 13, text: '我呼气吸气都感到很容易', options: sas4 },
      { id: 14, text: '我手脚麻木和刺痛', options: sas4 },
      { id: 15, text: '我因为胃痛和消化不良而苦恼', options: sas4 },
      { id: 16, text: '我常常要小便', options: sas4 },
      { id: 17, text: '我的手常常是干燥温暖的', options: sas4 },
      { id: 18, text: '我脸红发热', options: sas4 },
      { id: 19, text: '我容易入睡并且一夜睡得很好', options: sas4 },
      { id: 20, text: '我做恶梦', options: sas4 },
    ],
    scoring: (total) => {
      // total 为粗分（20~80）；标准分 = 粗分 × 1.25 取整
      const std = Math.round(total * 1.25);
      if (std < 50) return { level: 'green', label: `无焦虑症状（标准分 ${std}）`, description: '本次结果未提示明显焦虑症状。' };
      if (std < 60) return { level: 'yellow', label: `轻度焦虑（标准分 ${std}）`, description: '本次结果提示轻度焦虑，建议关注压力来源与休息状况。' };
      if (std < 70) return { level: 'orange', label: `中度焦虑（标准分 ${std}）`, description: '本次结果提示中度焦虑，建议进一步专业评估。' };
      return { level: 'red', label: `重度焦虑（标准分 ${std}）`, description: '本次结果提示重度焦虑，建议尽快联系专业人员进一步评估。' };
    },
  },
  // ---------------- PSQI 匹兹堡睡眠质量指数（Buysse 等 1989）：18 题、七成分、总分 0~21 ----------------
  {
    id: 'PSQI',
    name: 'PSQI 匹兹堡睡眠质量指数',
    description: '评估近一个月的整体睡眠质量，比 ISI 更细',
    instructions: '以下问题关于您最近一个月的睡眠习惯，请按多数情况填写。',
    introduction: {
      summary: 'PSQI 从七个成分评估睡眠：主观质量、入睡时间、睡眠时长、睡眠效率、睡眠障碍、催眠药物、日间功能。相比 ISI（失眠严重程度），PSQI 更全面地反映"睡得够不够、效率高不高"。',
      measures: ['主观睡眠质量', '入睡所需时间', '实际睡眠时长与卧床时间之比', '夜间困扰（起夜、疼痛、做梦等）', '日间精力与困倦'],
      suitableFor: '想了解整体睡眠质量，而不只是"失眠有多严重"时；可与 ISI 一起做，两者看的角度不同。',
      recallPeriod: '请按照最近一个月的多数情况填写。',
      scoreBands: [
        { range: '0–4', label: '睡眠质量良好' },
        { range: '5–7', label: '睡眠质量一般' },
        { range: '8–14', label: '睡眠质量差' },
        { range: '15–21', label: '睡眠质量很差' },
      ],
      notice: 'PSQI 总分 >7 通常提示睡眠质量差。结果用于筛查参考，不构成睡眠障碍诊断；长期睡眠问题建议就医。',
    },
    // 18 题：1 上床时间 / 2 入睡耗时 / 3 起床时间 / 4 实际睡眠 / 5~14 夜间困扰 / 15~18 质量与日间
    maxScore: 21,
    questions: [
      { id: 1, text: '最近一个月，您通常几点上床睡觉？', kind: 'time', options: [], hint: '选择最接近的时刻即可' },
      { id: 2, text: '上床后通常需要多久才能入睡？', kind: 'number', options: [], min: 0, max: 240, unit: '分钟' },
      { id: 3, text: '最近一个月，您通常几点起床？', kind: 'time', options: [], hint: '选最接近的时刻即可' },
      { id: 4, text: '最近一个月，您每晚实际睡了多少小时？', kind: 'number', options: [], min: 0, max: 720, unit: '分钟' },
      { id: 5, text: '不能在 30 分钟内入睡', options: psqi4, hint: '近一个月，因下列情况影响睡眠的频率' },
      { id: 6, text: '夜间或凌晨醒来', options: psqi4 },
      { id: 7, text: '需要起床上厕所', options: psqi4 },
      { id: 8, text: '呼吸不畅', options: psqi4 },
      { id: 9, text: '咳嗽或打鼾', options: psqi4 },
      { id: 10, text: '感觉冷', options: psqi4 },
      { id: 11, text: '感觉热', options: psqi4 },
      { id: 12, text: '做恶梦', options: psqi4 },
      { id: 13, text: '疼痛不适', options: psqi4 },
      { id: 14, text: '其他影响睡眠的事情', options: psqi4 },
      { id: 15, text: '总体来说，您觉得自己的睡眠质量', options: psqiQuality },
      { id: 16, text: '最近一个月，您用药物催眠的情况', options: psqi4 },
      { id: 17, text: '最近一个月，您常感到困倦吗', options: psqi4 },
      { id: 18, text: '最近一个月，您做事情的精力不足吗', options: psqiEnergy },
    ],
    scoring: (total) => {
      if (total <= 4) return { level: 'green', label: `睡眠质量良好（${total}/21）`, description: '本次结果提示整体睡眠质量良好。' };
      if (total <= 7) return { level: 'yellow', label: `睡眠质量一般（${total}/21）`, description: '本次结果提示睡眠质量一般，可以留意入睡时间与夜间醒来情况。' };
      if (total <= 14) return { level: 'orange', label: `睡眠质量差（${total}/21）`, description: '本次结果提示睡眠质量偏差，建议结合 ISI 一起看，并考虑专业评估。' };
      return { level: 'red', label: `睡眠质量很差（${total}/21）`, description: '本次结果提示睡眠质量很差，建议尽快寻求专业帮助。' };
    },
  },
];
