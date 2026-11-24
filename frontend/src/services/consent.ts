import { request } from './http';

/*
 * 提交时的「上传同意」
 * ====================
 * 默认：每次提交（量表 / 文字 / 语音 / 图片）都弹一次询问，同意才提交。
 * 用户可在「账号设置 → 数据与隐私」把询问关掉 —— 关掉后不再问，也就等于
 * "自动不提交"（不询问 ≠ 默认同意），这是需求明确要求的语义。
 *
 * 弹窗本身由 components/ConsentHost.tsx 渲染，任何代码都可以：
 *   if (!(await requestConsent())) return;   // 不同意就停在这里
 */

export interface ConsentPromptPref {
  promptDisabled: boolean;
  note?: string;
}

const FALLBACK: ConsentPromptPref = { promptDisabled: false };
let cached: ConsentPromptPref | null = null;

export async function loadConsentPrompt(): Promise<ConsentPromptPref> {
  if (cached) return cached;
  try {
    const data = await request.get<ConsentPromptPref>('/api/account/consent-prompt');
    cached = data ?? FALLBACK;
  } catch {
    /* 拿不到偏好就按默认处理：仍然询问（宁可多问，不可默认同意） */
    cached = FALLBACK;
  }
  return cached;
}

export async function saveConsentPrompt(promptDisabled: boolean): Promise<ConsentPromptPref> {
  const data = await request.put<ConsentPromptPref>('/api/account/consent-prompt', {
    promptDisabled,
  });
  cached = data ?? { promptDisabled };
  return cached;
}

export function peekConsentPrompt(): ConsentPromptPref {
  return cached ?? FALLBACK;
}

/* ---------------- 全局询问队列（同一时刻只可能有一个弹窗） ---------------- */

interface ConsentState {
  open: boolean;
  resolve: ((agree: boolean) => void) | null;
}

let state: ConsentState = { open: false, resolve: null };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeConsent(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getConsentState(): ConsentState {
  return state;
}

/** 请求一次同意。返回 true 表示可以提交；false 表示不要提交。 */
export async function requestConsent(): Promise<boolean> {
  const pref = await loadConsentPrompt();
  if (pref.promptDisabled) return false; // 关掉询问 = 自动不提交
  /* 已经有一个弹窗开着：复用同一次结果，避免叠出两个 */
  if (state.open) {
    return new Promise<boolean>((resolve) => {
      const prev = state.resolve;
      state = {
        open: true,
        resolve: (agree) => {
          prev?.(agree);
          resolve(agree);
        },
      };
    });
  }
  return new Promise<boolean>((resolve) => {
    state = { open: true, resolve };
    emit();
  });
}

/** 弹窗按钮回调 */
export function settleConsent(agree: boolean) {
  const resolve = state.resolve;
  state = { open: false, resolve: null };
  emit();
  resolve?.(agree);
}
