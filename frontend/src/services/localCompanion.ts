/**
 * localCompanion.ts —— 离线版（无后端）的 AI 陪伴对话
 *
 * 背景：`api.*` 这一组接口（陪伴对话 / 知识图谱 / 推理 / 推送 / 问询）
 * 原先**没有离线实现**，永远打真实接口。离线包里没有后端地址，
 * 请求失败后只能落到 ChatPage 里那句写死的兜底文案
 * （"收到。我把你提到的内容记下来了…"）—— 每轮都一样，演示时一眼假。
 *
 * 这里做的是**跟着用户输入走**的本地回应器，不是随机抽一句：
 *   1. 先用 keywordsIn / triplesFromText 认出这句话里的症状、情绪、事件；
 *   2. 按"先接住情绪 → 再顺着内容追问"的顺序组句，并把用户自己的词嵌回去；
 *   3. 按输入内容做稳定哈希选模板，**同样的话给同样的回应，不同的话给不同的回应**，
 *      既不会每轮重复，也不会前后矛盾。
 *
 * 它不是大模型，也不假装是：调用方会把返回结果标成 mock，
 * 界面照常显示"离线/演示模式"的提示。目标只是让演示时对话看起来是通的。
 */

import { keywordsIn, triplesFromText, type ExtractedTriple } from './localKg';

/** 接住情绪的开场：按识别到的情绪词分档 */
const EMOTION_OPENERS: Record<string, string[]> = {
  难过: ['听起来这段时间挺不容易的。', '你说的这些分量不轻，我听着呢。'],
  低落: ['这种提不起劲的感觉，确实很磨人。', '情绪低下来的时候，做什么都要多花几分力气。'],
  焦虑: ['心里一直悬着的感觉，很消耗人。', '这种不安不是你想多了，它确实在影响你。'],
  紧张: ['绷着的那根弦一直没松下来，挺累的。', '紧张到这个程度，身体也会跟着受影响。'],
  烦躁: ['烦躁起来的时候，一点小事都能点着火。', '这种状态确实很难静下来。'],
  疲惫: ['累到这个份上，先别急着要求自己。', '身体和情绪一起累的时候，恢复得慢一些是正常的。'],
};

/** 症状类：先共情，再给一个可执行的小动作 */
const SYMPTOM_REPLIES: Record<string, string> = {
  失眠: '睡不好这件事最麻烦的地方在于，它会连带影响白天的一切。最近是入睡困难，还是容易醒？',
  焦虑: '焦虑常常是因为有件事悬着没落地。如果愿意，可以说说是哪件事在占你的心思。',
  抑郁: '这种低落如果已经持续了一段时间，值得认真对待，而不是硬扛过去。',
  情绪低落: '情绪低的时候，能把它说出来本身就需要力气。',
  注意力下降: '注意力散了，往往不是你不努力，而是心里有别的东西在占用资源。',
  注意力不集中: '注意力散了，往往不是你不努力，而是心里有别的东西在占用资源。',
  食欲下降: '吃不下这件事，有时候比情绪本身更早发出信号。',
  疲惫: '一直提不起劲，是身体在提醒你该歇一歇了。',
  心慌: '心慌的时候人会更容易紧张，这是个互相加剧的循环。',
  压力大: '压力大的时候，先把事情按"能不能控制"分一分，会好受一些。',
};

/** 事件类：顺着事件追问 */
const EVENT_REPLIES: Record<string, string> = {
  考试: '考试这件事，压力往往不只来自考试本身，还有它背后代表的东西。',
  挂科: '挂科带来的挫败感很真实，但它定义不了你这个人。',
  面试: '等结果的那段时间最难熬，你已经把能做的做了。',
  分手: '分开之后的那段日子，情绪反复是正常的，不用逼自己快点好起来。',
  失恋: '这种失落需要时间，急不来。',
  搬家: '环境一变，很多原来熟悉的东西都要重新适应，累是正常的。',
  开学: '重新进入节奏需要一段缓冲期，不用一上来就要求自己满状态。',
  毕业: '站在这个节点上，迷茫几乎是必然的，不是你一个人的问题。',
  加班: '长期加班对情绪的消耗是累积的，不是睡一觉就能补回来的。',
  答辩: '准备到这个阶段，紧张说明你在乎，这是好事。',
};

/** 应对方式：认可 + 补一句 */
const COPING_REPLIES: Record<string, string> = {
  听歌: '音乐确实能兜住一些情绪，这是个好办法。',
  跑步: '运动对情绪的调节是有实证支持的，能坚持很不容易。',
  运动: '运动对情绪的调节是有实证支持的，能坚持很不容易。',
  冥想: '冥想这类练习，效果是慢慢累积出来的，别急着看变化。',
  倾诉: '愿意找人说出来，本身就是一种有效的应对。',
  写日记: '把它写下来，能让乱糟糟的念头变得清楚一些。',
  睡觉: '睡觉有时是最好的恢复方式，但如果变成回避，就要留意了。',
  散步: '走走能让脑子空一点，这个办法很实在。',
};

/** 什么关键词都没认出来时的承接句 */
const GENERIC_OPENERS = [
  '我在听。',
  '谢谢你愿意说这些。',
  '嗯，我听到了。',
  '你说的这些对我很重要。',
];

/** 收尾的开放式追问（一次只问一个，与后端提示词的要求一致） */
const FOLLOW_UPS = [
  '这件事对你的影响，主要体现在哪方面？',
  '这种情况大概持续多久了？',
  '你身边有人知道你现在这个状态吗？',
  '如果从一件最小的事开始，你觉得可以先动哪一件？',
];

/** 危机相关词：优先给求助信息，不做其他展开 */
const CRISIS_WORDS = ['自杀', '不想活', '活不下去', '结束生命', '自伤', '割腕', '轻生'];

/** 稳定哈希：同一句话永远得到同一个下标，不同的话分散开 */
function stableIndex(text: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

function pick<T>(list: T[], seed: string, salt = 0): T {
  return list[(stableIndex(seed, list.length) + salt) % list.length];
}

export interface LocalCompanionReply {
  reply: string;
  triples: ExtractedTriple[];
}

/**
 * 生成一条本地回应。
 *
 * @param text 用户这一轮说的话
 */
export function buildLocalCompanionReply(text: string): LocalCompanionReply {
  const trimmed = (text || '').trim();
  const triples = triplesFromText(trimmed);

  /* ① 危机词优先：这种情况不做任何"顺着聊"的展开 */
  if (CRISIS_WORDS.some((w) => trimmed.includes(w))) {
    return {
      reply:
        '你刚才说的这些，我很在意。这种时候请一定不要一个人扛着 —— ' +
        '可以先联系你信任的人，也可以拨打全国 24 小时心理援助热线 12356，' +
        '或者去学校心理中心找老师聊聊。你愿意现在多跟我说一点吗？',
      triples,
    };
  }

  const kw = keywordsIn(trimmed);
  const parts: string[] = [];

  /* ② 先接住情绪 */
  let opener = '';
  for (const [word, lines] of Object.entries(EMOTION_OPENERS)) {
    if (kw.emotions.includes(word)) {
      opener = pick(lines, trimmed);
      break;
    }
  }

  /* ③ 再回应具体内容：症状 > 事件 > 应对方式，只挑一条，避免堆砌 */
  let body = '';
  const hitSymptom = Object.keys(SYMPTOM_REPLIES).find((k) => kw.symptoms.includes(k));
  const hitEvent = Object.keys(EVENT_REPLIES).find((k) => kw.events.includes(k));
  const hitCoping = Object.keys(COPING_REPLIES).find((k) => trimmed.includes(k));

  if (hitSymptom) body = SYMPTOM_REPLIES[hitSymptom];
  else if (hitEvent) body = EVENT_REPLIES[hitEvent];
  else if (hitCoping) body = COPING_REPLIES[hitCoping];

  if (!opener && !body) {
    /* 什么都没认出来：承接一句 + 追问，不硬编内容 */
    opener = pick(GENERIC_OPENERS, trimmed);
  }
  if (opener) parts.push(opener);
  if (body) parts.push(body);

  /* ④ 有具体内容时才追问，避免"共情 + 追问"两头都空 */
  if (body) {
    parts.push(pick(FOLLOW_UPS, trimmed, 1));
  } else {
    parts.push('愿意多说一点吗？比如最近发生了什么事，或者身体上有什么感觉。');
  }

  return { reply: parts.join(''), triples };
}
