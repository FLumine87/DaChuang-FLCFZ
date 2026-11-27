import { request } from './http';

/*
 * 登录验证码（四位字母）
 * ==================
 * 图中文字由**服务端**生成并校验，前端只负责显示与提交 —— 纯前端生成的
 * 验证码谁都能绕过，等于没有。
 *
 * 演示账号（xiaoyu / adminer）由服务端额外返回 demoCode，登录页据此自动填充，
 * 演示时不必手抄；校验依旧在服务端走一遍。
 */

export interface CaptchaPayload {
  id: string;
  /** 服务端渲染好的 SVG 字符串 */
  svg: string;
  length: number;
  /** 有效期（秒） */
  expiresIn: number;
  /** 只有演示账号才有：前端用来自动填充 */
  demoCode?: string;
}

/** 取一张新验证码；传 username 时演示账号会带回 demoCode。 */
export async function fetchCaptcha(username?: string): Promise<CaptchaPayload> {
  const query = username ? `?username=${encodeURIComponent(username)}` : '';
  return request.get<CaptchaPayload>(`/api/auth/captcha${query}`);
}

/** 把 SVG 字符串转成 <img src> 可用的 data URI。 */
export function captchaImageSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 登录页上的演示账号：与 backend/app/handlers/auth.py 的 DEMO_USERNAMES 保持一致。 */
export const DEMO_LOGIN_NAMES = ['xiaoyu', 'adminer'];

export function isDemoLoginName(username: string): boolean {
  return DEMO_LOGIN_NAMES.includes(username.trim().toLowerCase());
}
