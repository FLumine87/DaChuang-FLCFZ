import { test, expect } from '@playwright/test';

/**
 * 登录修复端到端验证（2026-10-14）：
 *   1. 个人端演示账号 xiaoyu/123456 能登录，落入个人端欢迎页
 *   2. 管理端账号 adminer/admin 能登录，落入管理端工作台（不再是个人端）
 */

test('个人端演示账号登录', async ({ page }) => {
  await page.goto('http://localhost:5173/#/login');
  await page.getByRole('button', { name: /演示账号/ }).click();
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\/(welcome|dashboard)/, { timeout: 15000 });
  console.log('个人端演示账号 -> ' + page.url());
  // 登录成功：无错误提示，且落在个人端（首次引导欢迎页或工作台）
  await expect(page.getByRole('alert')).toHaveCount(0);
  const inPersonal = /#\/personal\/(welcome|dashboard)/.test(page.url());
  expect(inPersonal).toBe(true);
});

test('管理端账号登录落入管理端', async ({ page }) => {
  await page.goto('http://localhost:5173/#/login?panel=admin');
  await page.getByRole('button', { name: /管理端 · 咨询师/ }).click();
  await page.getByRole('button', { name: /进入管理端/ }).click();
  await page.waitForURL(/#\/admin\/dashboard/, { timeout: 15000 });
  console.log('管理端账号 -> ' + page.url());
  await expect(page.getByText('数据概览').first()).toBeVisible();
});
