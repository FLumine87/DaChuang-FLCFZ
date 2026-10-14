import { test, expect } from '@playwright/test';

/**
 * feature/home-cta-enter 合并验证（2026-10-14）：
 *   ① 首页首屏「立即体验」按钮 → 跳转登录页
 *   ② 首次引导欢迎页只在账号首次使用时出现（点过「先进入主页」后不再弹）
 */

test('首页「立即体验」按钮跳转登录页', async ({ page }) => {
  await page.goto('http://localhost:5173/#/');
  const cta = page.getByRole('button', { name: /立即体验/ });
  await expect(cta).toBeVisible({ timeout: 10000 });
  await cta.click();
  await page.waitForURL(/#\/login/, { timeout: 10000 });
  console.log('① 立即体验 → 登录页 ✓');
});

test('首次引导欢迎页只在首次登录出现', async ({ page }) => {
  test.setTimeout(120000);

  // 全新浏览器上下文：第一次登录 → 欢迎页
  await page.goto('http://localhost:5173/#/login');
  await page.getByLabel('用户名').fill('xiaoyu');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\/welcome/, { timeout: 15000 });
  console.log('② 首次登录进欢迎页 ✓');

  // 点「先进入主页，稍后再做」→ 主页
  await page.getByRole('button', { name: /先进入主页/ }).click();
  await page.waitForURL(/#\/personal\/dashboard/, { timeout: 10000 });
  console.log('③ 跳过引导 → 主页 ✓');

  // 重新登录 → 不再出现欢迎页，直接进主页
  await page.goto('http://localhost:5173/#/login');
  await page.getByLabel('用户名').fill('xiaoyu');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\/dashboard/, { timeout: 15000 });
  console.log('④ 二次登录直接进主页（欢迎页不再弹）✓');
});
