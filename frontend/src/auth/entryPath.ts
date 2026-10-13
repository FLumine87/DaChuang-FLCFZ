/**
 * entryPath.ts
 * 登录成功后该去哪里。
 *
 * 个人账号**一律进首次引导的欢迎页**，不做"看过就不再出现"的判断。
 * 原因很实际：这个项目的定位是给评委看的作品，演示时只有一个账号，
 * 若按"看过就不再展示"，评委第二次打开就看不到首次引导了，
 * 而首次引导恰恰是要展示的流程。
 *
 * 商用版本应当改回按账号状态判断（services/firstRun.ts 里已经有现成的
 * needsFirstRunGuide()）：咨询师/用户各自登录一次之后就不再打扰。
 *
 * 另外这里**只**用于登录成功之后的跳转：带着会话打开 /login 不再自动放行——
 * 用户要求每次打开登录页都当作没登录过（输入框留空、正常走登录）。
 */

export function resolveEntryPath(role: 'admin' | 'user' | undefined): string {
  if (role === 'admin') return '/admin/dashboard';
  return '/personal/welcome';
}
