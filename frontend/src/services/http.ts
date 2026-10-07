/**
 * http.ts
 * 统一的 axios 客户端：
 * - 自动注入 Authorization token
 * - 统一错误处理（401 过期自动跳转登录）
 * - 统一响应解包（后端约定 { code, message, data }）
 */

import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

// ─── 运行时配置（2026-10-07 移动端改造） ─────────────────────────────────────
// 移动端（mobile/）需要在「离线演示（Mock）」与「连接实机（真实后端）」之间
// **运行时切换**（同一个 APK 两用），所以模式与后端地址不能再是构建期常量。
//   优先级：运行时覆盖值（localStorage） > 构建期环境变量（VITE_*）
// Web 端不写这两个 key 时，行为与改造前完全一致。
const RUNTIME_MODE_KEY = 'psych_runtime_mode';
const RUNTIME_API_KEY = 'psych_runtime_api_base';

/** 构建期默认值 */
export const ENV_USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'true').toLowerCase() === 'true';
export const ENV_API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export type AppMode = 'mock' | 'live';

/** 当前运行模式：运行时覆盖 > 构建期默认 */
export function getAppMode(): AppMode {
  try {
    const raw = localStorage.getItem(RUNTIME_MODE_KEY);
    if (raw === 'mock' || raw === 'live') return raw;
  } catch {
    /* localStorage 不可用时回退构建期默认 */
  }
  return ENV_USE_MOCK ? 'mock' : 'live';
}

export function setAppMode(mode: AppMode) {
  try {
    localStorage.setItem(RUNTIME_MODE_KEY, mode);
  } catch {
    /* 忽略写入失败 */
  }
}

/** 是否走本地 Mock 数据（原 USE_MOCK 常量，改为动态判定） */
export function isMockMode(): boolean {
  return getAppMode() === 'mock';
}

/** 当前后端地址：运行时覆盖 > 构建期默认 */
export function getApiBase(): string {
  try {
    const raw = localStorage.getItem(RUNTIME_API_KEY);
    if (raw !== null) return raw;
  } catch {
    /* 忽略读取失败 */
  }
  return ENV_API_BASE;
}

export function setApiBase(base: string) {
  try {
    localStorage.setItem(RUNTIME_API_KEY, base);
  } catch {
    /* 忽略写入失败 */
  }
}

const BASE_URL = ENV_API_BASE;

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

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL || '/',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // 后端地址运行时可变（移动端「连接实机」模式里用户可改），所以每次请求现取
  config.baseURL = getApiBase() || '/';
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
      // HashRouter 下 location.pathname 恒为 "/<base>/"（路由在 hash 里），
      // 所以必须带 BASE_URL 跳 hash 路由；直接用 '/auth' 会落到子路径之外
      // → Web 上是 GitHub Pages 404，移动端 WebView 里是空白页。
      if (!location.hash.startsWith('#/auth')) {
        location.replace(`${import.meta.env.BASE_URL || '/'}#/auth`);
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
