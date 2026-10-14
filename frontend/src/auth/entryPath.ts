/**
 * entryPath.ts
 * 登录成功后该去哪里。
 *
 * 个人账号**只有「还没处理过引导」的才先进欢迎页**：看过欢迎页、点过
 * "先进入主页，稍后再做"、或已经做过一次首次筛查之后，一律直接进工作台，
 * 不再反复冒出来。
 *
 * 判据是账号的引导状态（services/firstRun.ts 的 needsFirstRunGuide），
 * 与"有没有筛查记录"无关——跳过引导的人本来就没有记录，用记录判的话他
 * 每次登录都会被再拦一次。
 *
 * 演示时需要重新展示引导页，在浏览器控制台执行
 *   localStorage.removeItem('psych_first_run:v1:<用户名>')
 * 把该账号的状态清回全新即可（等价于 firstRun.ts 里的 resetFirstRun）。
 *
 * 另外这里**只**用于登录成功之后的跳转：带着会话打开 /login 不再自动放行——
 * 用户要求每次打开登录页都当作没登录过（输入框留空、正常走登录）。
 */

import { needsFirstRunGuide } from '../services/firstRun';

export function resolveEntryPath(role: 'admin' | 'user' | undefined): string {
  if (role === 'admin') return '/admin/dashboard';
  return needsFirstRunGuide() ? '/personal/welcome' : '/personal/dashboard';
}
