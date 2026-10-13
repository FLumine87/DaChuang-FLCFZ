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

/**
 * 当前这枚 token 是不是"演示 token"（由前端 mockApi.apiLogin 自己签的 alg=none 三段式）。
 *
 * 401 处理里用它：演示 token 被真实后端拒绝是必然的，不能因此把用户登出。
 * mockApi 的读取兜底也用它：演示会话在真实后端下必然 401，这类失败应退回演示数据，
 * 而不是让页面整页报错（真实 JWT 的失败不受影响，照实暴露）。
 * 解不出来（或不是 alg:none）就当真实 JWT 处理，走原来的登出逻辑。
 */
export function isDemoToken(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const header = token.split('.')[0];
    if (!header) return false;
    const parsed = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/'))) as {
      alg?: string;
    };
    return parsed.alg === 'none';
  } catch {
    return false;
  }
}

/**
 * 把后端 / 网络的错误收敛成一句能直接上屏的短句。
 *
 * 为什么必须有它：axios 抛出的消息可能是 `请求失败 500: {"detail":"…"}` 这种
 * **带着原始响应体**的字符串。2026-10-14 干净 profile 实测（后端没起时）：
 * 「我的知识图谱」「个性化推送」两页就是把这句话原样渲染出来，用户看到的是裸 JSON。
 * 规则：
 *   · 传输层错误（请求失败 5xx / 超时 / 连不上）→ 用调用方给的通用说法；
 *   · 任何看起来像 JSON 片段（{ 或 [ 后跟引号）→ 同样用通用说法，绝不透出原始响应体；
 *   · 后端本来就说人话的（如"登录已过期，请重新登录"）→ 原样沿用；
 *   · 其余过长的一律截断，别让堆栈占满一行。
 */
export function briefErrorMessage(reason: unknown, fallback = '服务暂时不可用'): string {
  const raw = (reason instanceof Error ? reason.message : String(reason ?? '')).trim();
  if (!raw) return fallback;
  if (/^请求失败\s*\d{3}/.test(raw)) return fallback;
  if (/Network Error|Failed to fetch|ECONNREFUSED|timeout/i.test(raw)) return fallback;
  if (/[{[]\s*"/.test(raw)) return fallback;
  if (raw.length > 120) return `${raw.slice(0, 120)}…`;
  return raw;
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
      /* 演示 token 不触发全局登出。
       *
       * 演示/离线模式下发的是一枚 alg=none 的三段式自家 token（见 mockApi.apiLogin），
       * 真实后端（personal-backend / backend）校验签名，必然回 401。
       * 若照常 clearToken + 跳登录页，就会变成"打开智能体工作台 = 被强制登出"——
       * 一个可选增强接口的鉴权失败不该毁掉整个会话。
       *
       * 所以：拿演示 token 时只把错误透传给调用方（页面据此如实展示"需登录后端/
       * 服务不可用"），不清凭证、不跳转；真实 JWT 的 401（确实过期/被吊销）
       * 仍然按原逻辑登出。 */
      if (isDemoToken()) {
        return Promise.reject(
          new Error(error.response?.data?.message || '当前为演示登录，后端接口需要真实登录凭证'),
        );
      }
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
