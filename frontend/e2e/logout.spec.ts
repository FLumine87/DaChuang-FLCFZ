import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 退出登录链路实测：
 *   顶栏头像按钮（aria-label=用户菜单）→ 下拉「退出登录」→ 清会话 → 回登录页
 * 用 alg=none 的本地演示 token 注入会话，避免依赖真实后端登录。
 */

function mockToken(role: 'user' | 'admin', username: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ username, role, exp: 9999999999 })}.sig`;
}

async function loginAs(page: Page, role: 'user' | 'admin', username: string) {
  const token = mockToken(role, username);
  await page.addInitScript((t) => {
    window.localStorage.setItem('psych_token_persistent', t as string);
  }, token);
}

const APP = process.env.E2E_APP_URL || 'http://localhost:5173';

test.describe('退出登录', () => {
  test('个人端：头像下拉含退出登录，点击后清会话并回登录页', async ({ page }) => {
    await loginAs(page, 'user', 'fyx');
    await page.goto(`${APP}/#/personal/dashboard`);

    const avatar = page.getByRole('button', { name: '用户菜单' });
    await expect(avatar).toBeVisible();
    await avatar.click();

    const logoutBtn = page.getByRole('button', { name: '退出登录' });
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    await expect(page).toHaveURL(/#\/login$/);
    const token = await page.evaluate(() =>
      window.localStorage.getItem('psych_token_persistent'),
    );
    expect(token).toBeNull();
  });

  test('管理端：同样支持退出', async ({ page }) => {
    await loginAs(page, 'admin', 'adminer');
    await page.goto(`${APP}/#/admin/dashboard`);

    await page.getByRole('button', { name: '用户菜单' }).click();
    await page.getByRole('button', { name: '退出登录' }).click();

    await expect(page).toHaveURL(/#\/login$/);
  });
});
