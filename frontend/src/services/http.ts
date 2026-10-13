/**
 * http.ts
 * 统一的 axios 客户端：
 * - 自动注入 Authorization token
 * - 统一错误处理（401 过期自动跳转登录）
 * - 统一响应解包（后端约定 { code, message, data }）
 */

import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'true').toLowerCase() === 'true';

const TOKEN_KEY_PERSISTENT = 'psych_token_persistent';
const TOKEN_KEY_TEMP = 'psych_token_temp';

export function getToken(): string | null {
  return (
    localStorage.getItem(TOKEN_KEY_PERSISTENT) ||
    sessionStorage.getItem(TOKEN_KEY_TEMP)
  );
}

export function setToken(token: string, remember: boolean) {
  clearToken();
  if (remember) {
    localStorage.setItem(TOKEN_KEY_PERSISTENT, token);
  } else {
    sessionStorage.setItem(TOKEN_KEY_TEMP, token);
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY_PERSISTENT);
  sessionStorage.removeItem(TOKEN_KEY_TEMP);
}

/**
 * 从当前 token 里解出用户名（mock token 与真实 JWT 都是三段式，payload 第二段）。
 *
 * 为什么放在 http.ts：mock 数据层要按账号区分演示数据（见 mockApi 里的
 * 「演示数据按账号隔离」），而 session.ts 反过来依赖 mockApi（logout），
 * 两边互相 import 会形成环。token 的读写本来就归这里管，放在这一层最合适。
 */
export function getTokenUsername(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(base64)) as { username?: string };
    return parsed.username || null;
  } catch {
    return null;
  }
}

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL || '/',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

/**
 * 类型化的请求包装：
 * axios 拦截器已把 response.data 解包，但 axios 原生类型仍认为返回 AxiosResponse，
 * 这里提供类型安全的 get/post/put/del 方法，直接返回业务数据类型。
 */
export const request = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return http.get(url, config) as unknown as Promise<T>;
  },
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return http.post(url, data, config) as unknown as Promise<T>;
  },
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return http.put(url, data, config) as unknown as Promise<T>;
  },
  del<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return http.delete(url, config) as unknown as Promise<T>;
  },
};

http.interceptors.response.use(
  (response) => {
    // 约定后端返回 { code: 0|200, message, data }
    // 若无此包装，则直接返回 data
    const body = response.data;
    if (body && typeof body === 'object' && 'code' in body) {
      const code = body.code;
      if (code === 0 || code === 200) {
        return body.data;
      }
      return Promise.reject(new Error(body.message || `业务错误 ${code}`));
    }
    return body;
  },
  (error: AxiosError<{ message?: string }>) => {
    // 登录/注册接口的 401 是"凭证错误"，不是会话过期，需透传后端原因
    const isAuthEntry = /\/api\/auth\/(login|register)$/.test(error.config?.url ?? '');
    if (error.response?.status === 401 && !isAuthEntry) {
      clearToken();
      // 项目用 HashRouter：登录路由在 hash 里；线上又部署在仓库子路径下，
      // 所以必须带上 BASE_URL，否则 GitHub Pages 上会跳到不存在的 /auth 而 404。
      // （团队 main 也改成判 hash，但他们用 location.hash = '#/auth'，会丢掉子路径；
      //   这里保留我们这版带 BASE_URL 的写法，语义一致且线上不会 404。）
      if (!location.hash.startsWith('#/auth')) {
        const base = import.meta.env.BASE_URL || '/';
        location.href = `${base}#/auth`;
      }
      return Promise.reject(new Error('登录已过期，请重新登录'));
    }
    const message =
      error.response?.data?.message ||
      error.message ||
      '网络请求失败';
    return Promise.reject(new Error(message));
  }
);

export default http;
