/**
 * 每日问询的「今天别打扰」标记。
 *
 * 从 DailyCheckinDialog 里抽出来单独放：组件文件只导出组件，
 * 否则 react-refresh 的 only-export-components 规则会报错；
 * 聊天页的对话流卡片也要读写同一套标记，不能各存一份。
 */

const todayStr = () => new Date().toISOString().slice(0, 10);

/** 用户今天主动说"待会再说"（稍后回复 / 关闭）——今天不再出现，但问询仍是 pending */
const dismissedKey = (user: string) => `psych_checkin_dismissed::${user}`;
/** 用户今天明确"不想回复"——今天不再出现，服务端也已置 declined */
const declinedKey = (user: string) => `psych_checkin_declined::${user}`;

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; /* 隐私模式下读不到，退化为"每次都会出现"，不影响正确性 */
  }
}

function writeFlag(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 写不进去也不影响正确性：服务端状态才是准的 */
  }
}

/** 今天是否已被用户明确"稍后回复"或"不想回复" */
export function isCheckinMutedToday(user: string): boolean {
  const today = todayStr();
  return readFlag(dismissedKey(user)) === today || readFlag(declinedKey(user)) === today;
}

/** 记下"今天稍后回复" */
export function markCheckinLater(user: string) {
  writeFlag(dismissedKey(user), todayStr());
}

/** 记下"今天不想回复"（调用方同时把服务端置 declined） */
export function markCheckinDeclined(user: string) {
  writeFlag(dismissedKey(user), todayStr());
  writeFlag(declinedKey(user), todayStr());
}
