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

import { getToken, setToken, clearToken } from '../services/http';
import { apiLogout } from '../services/mockApi';

export type UserRole = 'admin' | 'user';

export interface Session {
  username: string;
  role: UserRole;
  exp?: number;
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

    if (payload.exp && Date.now() > payload.exp) {
      clearToken();
      return null;
    }
    if (!payload.username || !payload.role) return null;

    return payload;
  } catch {
    return null;
  }
}

export function saveSessionToken(token: string, remember: boolean) {
  setToken(token, remember);
}

export async function logout() {
  try {
    await apiLogout();
  } finally {
    clearToken();
  }
}
