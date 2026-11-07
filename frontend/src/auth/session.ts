/**
 * session.ts
 * 基于 Token 的会话管理（同时兼容 mock token 与真实 JWT）。
 *
 * 约定：无论 mock 还是真实后端，token 都是标准 JWT 三段式格式
 *   header.payload.signature
 * 其中 payload 是 base64 编码的 JSON：{ username, role, exp? }
 *
 * 这样前端路由守卫与用户信息显示都能通用。
 */

import { clearToken, getToken, resetOfflineDemo, setToken } from '../services/http';
import { apiLogout } from '../services/mockApi';
import { clearDraft } from '../services/firstRun';

export type UserRole = 'admin' | 'user';

export interface Session {
  username: string;
  role: UserRole;
  exp?: number;
}

/**
 * 后端登录接口在 JWT 之外单独返回了显示名（users.name，如「本地演示用户」）。
 * JWT 里只有 username，拿不到这个字段，所以单独存一份。
 * 档案接口在没有筛查记录时 name 会退化成「用户」，页面用这份数据覆盖掉那个占位。
 */
const NAME_KEY = 'psych_user_name';

export function saveDisplayName(name?: string | null) {
  try {
    if (name && name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* 隐私模式下 localStorage 不可用，忽略 */
  }
}

export function getDisplayName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

/**
 * 从 token 中解码出当前会话信息。
 * 若 token 不存在、格式错误、或已过期，则返回 null。
 */
export function getCurrentSession(): Session | null {
  const token = getToken();
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    // base64url → base64
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as Session;

    if (payload.exp && Date.now() > payload.exp * 1000) {
      clearToken();
      return null;
    }
    if (!payload.username || !payload.role) return null;

    // 后端 JWT 里的 role 可能是 admin / counselor / user，而登录接口统一把非 admin
    // 映射成 user。这里做同样的归一化，避免同一账号在「登录返回值」与「会话」两处
    // 角色不一致（counselor 账号此前会出现这种情况）。
    return { ...payload, role: payload.role === 'admin' ? 'admin' : 'user' };
  } catch {
    return null;
  }
}

export function saveSessionToken(token: string, remember: boolean) {
  setToken(token, remember);
}

export async function logout() {
  /* 用户名要在清 token 之前取：草稿按账号隔离，退出时只清当前这个人的，
     避免同一标签页换账号后还读得到上一个人的中途作答。 */
  const username = getCurrentSession()?.username;
  try {
    await apiLogout();
  } finally {
    clearDraft(username);
    clearToken();
    /* 退出后回到"先试真实后端"的状态：离线演示只是这一次连不上时的兜底，
       不应该粘住下一个账号。构建期就定死的演示包不受影响。 */
    resetOfflineDemo();
    saveDisplayName(null); // 换账号时别把上一个人的显示名留在本机
  }
}
