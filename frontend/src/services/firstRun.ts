/**
 * firstRun.ts
 * 个人端「首次引导」状态：这个账号有没有看过欢迎页、有没有一份正在进行中的首次筛查。
 *
 * 为什么不能只看「有没有筛查记录」：
 *   跳过引导的人本来就没有记录。若用「记录为空」当判据，他每次登录都会被再拦一次
 *   欢迎页；点进量表又中途退出的同理。所以这里记的是**账号是否已经处理过引导**，
 *   与记录数量无关。
 *
 * 三种状态（互相之间的迁移）：
 *
 *   new ──点「开始首次筛查」──▶ in_progress ──提交成功──▶ done
 *    │                              ▲
 *    └──点「先进入主页」────────────┘（留在 new，首页给一个随时可用的入口）
 *
 *   · new         第一次登录，还没做过选择 → 登录后进欢迎页
 *   · in_progress 选过量表但没提交（中途退出）→ 下次直接进主页，首页提示「继续筛查」
 *   · done        已经完成过一次 → 之后完全按老流程走
 *
 * 存储：localStorage，key 里带用户名 —— 同一台电脑换账号登录互不影响。
 *
 * 跨设备：正式使用时这个状态应该放在**用户账号**上（后端加一张表或一个字段），
 *   届时只需要把 readState / writeState 换成 request.get / request.put，
 *   调用方（LoginPage、WelcomePage、Screening、Dashboard）一行都不用改。
 */

import { getCurrentSession } from '../auth/session';

export type FirstRunStatus = 'new' | 'in_progress' | 'done';

export interface FirstRunState {
  status: FirstRunStatus;
  /* 欢迎页是否已经"处理过"（点过开始或跳过）。关掉标签页不算处理过，
     下次登录还会看到——因为用户其实没有做过选择。 */
  guideSeen: boolean;
  /* in_progress 时用户选中的量表 id（PHQ-9 / GAD-7 / ISI / PSS-10），
     首页据此把入口写成「继续筛查」并直接回到那份量表。 */
  scaleId?: string;
  updatedAt?: string;
}

const KEY_PREFIX = 'psych_first_run:v1:';

const EMPTY: FirstRunState = { status: 'new', guideSeen: false };

/* 未登录时（理论上进不来）用一个固定 key 兜底，避免读到别人的状态 */
export function resolveUsername(explicit?: string | null): string {
  const name = explicit?.trim() || getCurrentSession()?.username || '';
  return name || 'anonymous';
}

function storageKey(username: string): string {
  return `${KEY_PREFIX}${username}`;
}

function readState(username: string): FirstRunState {
  try {
    const raw = window.localStorage.getItem(storageKey(username));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<FirstRunState>;
    const status: FirstRunStatus =
      parsed.status === 'in_progress' || parsed.status === 'done'
        ? parsed.status
        : 'new';
    return {
      status,
      guideSeen: parsed.guideSeen === true,
      scaleId: typeof parsed.scaleId === 'string' ? parsed.scaleId : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
    };
  } catch {
    /* 隐私模式下 localStorage 不可读、或存了坏数据：当作全新账号 */
    return { ...EMPTY };
  }
}

function writeState(username: string, next: FirstRunState): FirstRunState {
  const state: FirstRunState = { ...next, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(storageKey(username), JSON.stringify(state));
  } catch {
    /* 隐私模式下写不进去：本次会话内仍然按内存里的状态走，刷新后退回 new */
  }
  return state;
}

export function getFirstRunState(explicitUsername?: string | null): FirstRunState {
  return readState(resolveUsername(explicitUsername));
}

/**
 * 登录后要不要先进欢迎页。
 * 只看 guideSeen：跳过的人（new + guideSeen）与中途退出的人（in_progress）
 * 都不该再看到欢迎页。
 */
export function needsFirstRunGuide(explicitUsername?: string | null): boolean {
  return !getFirstRunState(explicitUsername).guideSeen;
}

/** 在欢迎页点了「先进入主页」：记下"看过引导了"，但不代表开始过筛查 */
export function markGuideSeen(explicitUsername?: string | null): FirstRunState {
  const username = resolveUsername(explicitUsername);
  const current = readState(username);
  return writeState(username, { ...current, guideSeen: true });
}

/** 在欢迎页点了「开始首次筛查」：记下看过了，并记住选的是哪份量表 */
export function markGuideStarted(
  scaleId: string,
  explicitUsername?: string | null,
): FirstRunState {
  const username = resolveUsername(explicitUsername);
  return writeState(username, {
    status: 'in_progress',
    guideSeen: true,
    scaleId,
  });
}

/** 首次筛查提交成功：引导流程结束，之后完全按老流程走 */
export function markFirstScreeningDone(
  explicitUsername?: string | null,
): FirstRunState {
  const username = resolveUsername(explicitUsername);
  const current = readState(username);
  return writeState(username, { ...current, status: 'done', guideSeen: true });
}

/**
 * 首页空状态用：有没有一份"选了但没提交"的量表。
 * 返回量表 id；没有则返回 null。
 */
export function getPendingScale(explicitUsername?: string | null): string | null {
  const state = getFirstRunState(explicitUsername);
  return state.status === 'in_progress' && state.scaleId ? state.scaleId : null;
}

/** 演示 / 自测用：把这个账号的引导状态清回全新（界面上没有入口，只在控制台用） */
export function resetFirstRun(explicitUsername?: string | null): void {
  try {
    window.localStorage.removeItem(storageKey(resolveUsername(explicitUsername)));
  } catch {
    /* 忽略 */
  }
}

/* ==========================================================================
   三步向导的进行中草稿（01 作答 → 02 补充 → 03 结果）
   —— 量表提交后要跨两个页面才知道分数与分档，光靠 useState 传不过去；
      放 sessionStorage 而不是 URL：分数、补充内容不该出现在地址栏里，
      而且用户中途刷新（02 页按 F5）不该把流程打回第一步。
      关掉标签页即失效——这是"这一次引导"的临时数据，不是账号资料。
   ========================================================================== */

export type SupplementKind = 'text' | 'audio' | 'image';

export interface SupplementDraft {
  kind: SupplementKind;
  /** 文字补充的正文 */
  text?: string;
  /** 语音 / 图片的原始文件名 */
  filename?: string;
  /** 语音 / 图片上传后的地址（mock 模式下是 blob URL） */
  url?: string;
  /** 语音 / 图片的分析描述（上传接口返回的 analysis），存下来供首页与检索页一致展示 */
  description?: string;
  /** 哈希检索引擎的分析报告（保存补充时后端同步生成） */
  analysis?: {
    level: 'green' | 'yellow' | 'orange' | 'red';
    levelLabel?: string;
    conclusion?: string;
    reason?: string;
    alertId?: string | null;
  };
}

export interface FirstRunDraft {
  scaleId: string;
  recordId?: string;
  score?: number;
  maxScore?: number;
  level?: 'green' | 'yellow' | 'orange' | 'red';
  /** 量表提交的时刻（03 报告卡顶部显示"完成于 …"） */
  completedAt?: string;
  supplement?: SupplementDraft;
  updatedAt?: string;
}

const DRAFT_KEY = 'psych_first_run:draft';

export function getDraft(): FirstRunDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FirstRunDraft;
    return parsed && typeof parsed.scaleId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(patch: Partial<FirstRunDraft>): FirstRunDraft | null {
  const current = getDraft();
  if (!current) return null;
  const next: FirstRunDraft = { ...current, ...patch, updatedAt: new Date().toISOString() };
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下写不进去：本次会话内后面的步骤会退回第一步，不影响主流程 */
  }
  return next;
}

/** 开始一份新的首次筛查：清掉上一轮的草稿 */
export function startDraft(scaleId: string): FirstRunDraft {
  const next: FirstRunDraft = { scaleId, updatedAt: new Date().toISOString() };
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    /* 忽略 */
  }
  return next;
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 忽略 */
  }
}
