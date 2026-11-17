/**
 * 每日问询的「今天别打扰」标记。
 *
 * 从 DailyCheckinDialog 里抽出来单独放：组件文件只导出组件，
 * 否则 react-refresh 的 only-export-components 规则会报错；
 * 聊天页的对话流卡片也要读写同一套标记，不能各存一份。
 */

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** 用户今天明确"不想回复"——今天不再出现，服务端也已置 declined */
const declinedKey = (user: string) => `psych_checkin_declined::${user}`;
const repliedKey = (user: string) => `psych_checkin_replied::${user}`;

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

/** 今天是否已回复或拒绝；稍后回复不再静音整天。 */
export function isCheckinMutedToday(user: string): boolean {
  const today = todayStr();
  return readFlag(repliedKey(user)) === today || readFlag(declinedKey(user)) === today;
}

export function markCheckinReplied(user: string) {
  writeFlag(repliedKey(user), todayStr());
}

/** 记下"今天不想回复"（调用方同时把服务端置 declined） */
export function markCheckinDeclined(user: string) {
  writeFlag(declinedKey(user), todayStr());
}
