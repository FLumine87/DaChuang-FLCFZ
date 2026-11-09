/**
 * chatTime.ts · 对话记录里的时间显示（2026-11-07 新增）
 *
 * 用户要求：「用户与AI的对话希望能够显示时间节点。」
 *
 * 什么是「时间节点」：不是每条气泡都钉一个时间（那样很快就满屏小字，
 * 心理对话页面更需要留白），而是**在合适的位置插一条居中的时间分隔线**，
 * 让整段对话有可读的时间脉络。规则（与主流 IM 一致，用户不用重新学）：
 *
 *   1. 跨天      → 必插，显示「今天 14:30」「昨天 09:12」「3月5日 20:41」「2025年12月1日 08:00」
 *   2. 同天但间隔超过 GAP_MINUTES → 插，只显示「14:30」
 *   3. 其余      → 不插
 *   4. 第一条消息 → 必插（作为整段记录的时间起点）
 *
 * 关于老数据（本次改动之前存的记录没有 at 字段）：
 *   **不猜、不补**。没有时间的消息一律不参与分组，也不显示时间；
 *   绝不用"打开页面的时刻"去冒充历史消息的时间——那是在编造用户的时间线。
 *   只有新发出的消息才会带上真实时间。
 *
 * 时区：全程用浏览器本地时区（用户看到的时间就是他手表上的时间）。
 * 日期比较用「本地日期字符串」，不用 toISOString()——后者是 UTC，
 * 在东八区会把 00:00-07:59 的消息算到前一天去。
 */

import type { StoredChatMessage } from './chatHistory';

/** 同一天内，两条消息间隔超过这个分钟数才插时间分隔 */
const GAP_MINUTES = 5;

/** 把 ISO 字符串解析成 Date；无效返回 null（不抛错，界面上少显示一行而已） */
export function parseAt(at?: string | null): Date | null {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 本地日期键（YYYY-MM-DD）。刻意不用 toISOString()——那是 UTC，会把凌晨算到前一天 */
export function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 两个本地日期相差几天（今天 - 那天） */
function dayDiff(a: Date, b: Date): number {
  const keyA = localDayKey(a);
  const keyB = localDayKey(b);
  const [ay, am, ad] = keyA.split('-').map(Number);
  const [by, bm, bd] = keyB.split('-').map(Number);
  const ta = new Date(ay, am - 1, ad).getTime();
  const tb = new Date(by, bm - 1, bd).getTime();
  return Math.round((ta - tb) / 86400000);
}

/** 24 小时制时间 HH:mm */
export function clockText(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 分隔线上的文字。now 可注入，方便测试跨天文案。
 */
export function dividerText(d: Date, now: Date = new Date()): string {
  const diff = dayDiff(now, d);
  const clock = clockText(d);
  if (diff === 0) return `今天 ${clock}`;
  if (diff === 1) return `昨天 ${clock}`;
  if (diff === 2) return `前天 ${clock}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
}

/** 气泡上悬停提示用的完整时间：2026年11月7日 23:12 */
export function fullText(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clockText(d)}`;
}

export interface ChatRow {
  message: StoredChatMessage;
  /** 这条消息上方要显示的时间分隔文字；不需要分隔时为 null */
  divider: string | null;
  /** 悬停提示（完整时间）；无时间信息时为 null */
  title: string | null;
}

/**
 * 把消息列表加工成"带时间分隔"的渲染序列。
 *
 * 只在**跨天**或**间隔够久**处插分隔 —— 连续一来一回的对话不该被时间切碎。
 * 判定用的是"上一条有时间消息"的时刻，而不是"上一条消息"：
 * 老记录（无 at）夹在中间时，不该因为读到它而丢掉与它前面那条的时间比较。
 */
export function withTimeDividers(
  messages: StoredChatMessage[],
  now: Date = new Date(),
): ChatRow[] {
  let lastDate: Date | null = null;
  return messages.map((m) => {
    const date = parseAt(m.at);
    if (!date) {
      /* 没有时间信息：不显示分隔，也不参与后续比较 */
      return { message: m, divider: null, title: null };
    }

    let divider: string | null = null;
    if (!lastDate) {
      /* 第一条有时间消息：作为时间线起点，总是显示 */
      divider = dividerText(date, now);
    } else {
      const crossDay = localDayKey(date) !== localDayKey(lastDate);
      const gapMin = (date.getTime() - lastDate.getTime()) / 60000;
      if (crossDay || gapMin >= GAP_MINUTES) divider = dividerText(date, now);
    }
    lastDate = date;
    return { message: m, divider, title: fullText(date) };
  });
}
