/**
 * scaleGuide.ts
 * 「了解 XX」量表介绍弹窗的内容（图七那份文案的结构化版本）。
 *
 * 为什么单独一份、而不是塞进 questionnaireData 的 introduction：
 *   introduction 是给**结果页**看的（measures / notice / scoreBands / recallPeriod），
 *   这里描述的是**用户作答之前**要理解的量表——名称 → 用途 → 关注的状态 →
 *   结果的边界。两者读者不同、措辞也不同，混在一起会互相迁就。
 *
 * 弹窗的阅读顺序固定为：量表介绍（眉标）→ 名称 → 简介 → 它关注什么 →
 * 它如何帮助你 → 结果的边界 → 「返回当前题」。
 * 刻意**不写**"怎么作答"（那是答题页顶部说明条的事）也**不做成操作教程**。
 */

/* 图标用字符串键而不是直接引组件：数据文件保持纯数据，
   组件侧再做一次映射（见 pages/first/ScaleIntroDialog.tsx）。 */
export type ScaleFocusIcon =
  | 'mood'
  | 'sleep'
  | 'focusGray'
  | 'risk'
  | 'worry'
  | 'body'
  | 'expect'
  | 'night'
  | 'satisfaction'
  | 'daytime'
  | 'events'
  | 'control'
  | 'burden'
  | 'coping';

export interface ScaleFocusItem {
  icon: ScaleFocusIcon;
  title: string;
  desc: string;
}

export interface ScaleGuide {
  /** 弹窗主标题：中文字段名 + 量表定位，不再出现英文大写眉标 */
  modalTitle: string;
  /** 一句话说明这份量表是什么、问多少个问题、看多长时间 */
  summary: string;
  /** 「这份量表关注什么」的四组（或三组）内容 */
  focus: ScaleFocusItem[];
  /** 它如何帮助你 */
  helps: string;
  /** 结果的边界（不能用来做什么） */
  boundary: string;
  /** 答题页顶部说明条左半句：回想的时间范围（每个量表不同） */
  recall: string;
  /** 答题页顶部说明条右半句：选项是按什么选的（频率 / 程度） */
  answerHint: string;
}

export const scaleGuides: Record<string, ScaleGuide> = {
  'PHQ-9': {
    modalTitle: 'PHQ-9 抑郁症状自评量表',
    summary: '通过 9 个问题，了解过去两周抑郁相关症状的出现情况。',
    focus: [
      { icon: 'mood', title: '情绪与兴趣', desc: '做事提不起劲、心情低落或绝望' },
      { icon: 'sleep', title: '睡眠、精力与食欲', desc: '入睡困难或睡不安稳、疲倦、食欲变化' },
      { icon: 'focusGray', title: '注意力、行动与自我感受', desc: '专注困难、动作迟缓或坐立不安、觉得自己很糟' },
      { icon: 'risk', title: '伤害自身的想法', desc: '第 9 题询问死亡或伤害自己的念头，该题作答页会单独给出支持信息' },
    ],
    helps: '帮助你初步了解近期哪些困扰更常出现。之后再次填写时，也可以对照自己的状态变化。',
    boundary: '结果不能单独用于诊断抑郁症。如果困扰持续或影响生活，建议寻求专业评估。',
    recall: '回想过去两周',
    answerHint: '按出现频率选择一项',
  },
  'GAD-7': {
    modalTitle: 'GAD-7 焦虑症状自评量表',
    summary: '通过 7 个问题，了解过去两周焦虑相关症状的出现情况。',
    focus: [
      { icon: 'worry', title: '紧张与担忧', desc: '紧张不安、难以控制的担忧' },
      { icon: 'body', title: '身体与情绪反应', desc: '难以放松、坐立不安、容易烦躁' },
      { icon: 'expect', title: '对未来的预期', desc: '担心不好的事情会发生' },
    ],
    helps: '帮助你初步了解担忧和紧张感近期出现得有多频繁；再次填写时，可作为观察变化的参考。',
    boundary:
      '结果不能单独用于诊断焦虑障碍。如果这些感受持续存在，或明显影响学习、工作、睡眠和人际关系，建议寻求专业评估。',
    recall: '回想过去两周',
    answerHint: '按出现频率选择一项',
  },
  ISI: {
    modalTitle: 'ISI 失眠严重程度评估',
    summary: '通过 7 个问题，了解近期睡眠困难及其对日常生活的影响。',
    focus: [
      { icon: 'night', title: '夜间睡眠', desc: '入睡困难、夜间醒来和早醒' },
      { icon: 'satisfaction', title: '睡眠满意度', desc: '对目前睡眠的满意程度' },
      { icon: 'daytime', title: '白天的影响', desc: '睡眠问题对白天生活的影响，以及由此产生的担忧' },
    ],
    helps: '帮助你看清困扰主要来自夜间睡眠，还是睡眠问题带来的白天影响。之后复评时，可以对照这些感受是否发生变化。',
    boundary:
      '这是对睡眠困难的自我报告，不能替代睡眠障碍诊断。如果问题持续存在，或白天生活明显受到影响，建议咨询医生或睡眠专业人员。',
    recall: '回想过去两周',
    answerHint: '按严重程度选择一项',
  },
  'PSS-10': {
    modalTitle: 'PSS-10 主观压力感知量表',
    summary: '通过 10 个问题，了解你在过去一个月里如何感受生活中的压力。',
    focus: [
      { icon: 'events', title: '意外与烦恼', desc: '意外事件带来的烦恼' },
      { icon: 'control', title: '控制感', desc: '对重要事情的控制感' },
      { icon: 'burden', title: '紧张与负担', desc: '感到紧张、觉得负担过重' },
      { icon: 'coping', title: '应对信心', desc: '处理问题和应对变化时的信心' },
    ],
    helps: '帮助你整理近期的压力感受和应对状态；以后再次填写时，可作为回看自身变化的参考。',
    /* 这一条按图七的口径写死：PSS-10 没有临床分界值，
       平台显示的等级必须说成"系统参考分组"，不能写成临床结论。 */
    boundary:
      'PSS-10 不用于诊断心理疾病，也没有统一的临床诊断分界值。平台显示的「低、中、高」是系统参考分组，不是临床结论。',
    recall: '回想过去一个月',
    answerHint: '按出现频率选择一项',
  },
};

export function getScaleGuide(id: string | null | undefined): ScaleGuide | undefined {
  return id ? scaleGuides[id] : undefined;
}
