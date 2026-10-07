/**
 * mode.ts — 运行模式（离线演示 / 连接实机）
 *
 * 一个 APK 两用：
 *   · mock  —— 内置 Mock 数据，断网可跑（答辩/演示零风险）
 *   · live  —— 走真实后端（需网络可达；workers.dev 在国内需科学上网）
 *
 * 真正的开关值存在 localStorage，由共享的 `@shared/services/http` 读取，
 * 所以数据层（mockApi）无需任何改动即可切换。
 */

import axios from 'axios';
import {
  getAppMode,
  setAppMode,
  getApiBase,
  setApiBase,
  type AppMode,
} from '@shared/services/http';

export type { AppMode };

/** 后端默认地址（与 Web 生产环境一致） */
export const DEFAULT_LIVE_BASE =
  'https://mental-screening-api.787249795.workers.dev';

const CHOSEN_KEY = 'psych_mode_chosen';
/** Mock 演示账号（见 @shared/auth/mockAuth） */
export const MOCK_ACCOUNTS = [
  { username: 'xiaoyu', password: '123456', note: '学生端' },
  { username: 'adminer', password: 'admin', note: '管理端（移动端不做管理端）' },
];

export const getMode = getAppMode;
export const setMode = setAppMode;
export const getBase = getApiBase;
export const setBase = setApiBase;

/** 用户是否已经做过首启模式选择 */
export function isModeChosen(): boolean {
  try {
    return localStorage.getItem(CHOSEN_KEY) === '1';
  } catch {
    return true; // localStorage 不可用时不再拦首启页
  }
}

export function markModeChosen() {
  try {
    localStorage.setItem(CHOSEN_KEY, '1');
  } catch {
    /* 忽略 */
  }
}

/** 清除首启选择（设置页「重新选择模式」用） */
export function resetModeChoice() {
  try {
    localStorage.removeItem(CHOSEN_KEY);
  } catch {
    /* 忽略 */
  }
}

function normalizeBase(base: string): string {
  const trimmed = (base || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function isValidBase(base: string): boolean {
  const b = normalizeBase(base);
  return /^https?:\/\/.+/i.test(b);
}

/**
 * 探测后端是否可达。
 *
 * 用 `/api/personal/warnings`（无 token 时返回 401）：**只要能拿到 HTTP 响应
 * 就说明网络与后端都通**，401 属于预期结果，不算失败。
 */
export async function testConnection(
  base: string,
): Promise<{ ok: boolean; message: string }> {
  const b = normalizeBase(base);
  if (!isValidBase(b)) {
    return { ok: false, message: '地址格式不对，需要以 http:// 或 https:// 开头' };
  }
  try {
    const res = await axios.get(`${b}/api/personal/warnings`, {
      timeout: 10000,
      validateStatus: () => true,
    });
    const hint = res.status === 401 ? '（返回 401 = 后端正常，只是未登录）' : '';
    return { ok: true, message: `连接成功：HTTP ${res.status}${hint}` };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECONNABORTED') {
      return { ok: false, message: '连接超时：网络不通，或国内直连被墙（需科学上网）' };
    }
    return {
      ok: false,
      message: `连接失败：${e.message || '未知错误'}（国内直连 workers.dev 通常会被墙）`,
    };
  }
}
