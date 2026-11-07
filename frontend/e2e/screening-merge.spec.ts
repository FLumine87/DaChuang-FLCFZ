import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

function mockToken(role: 'user' | 'admin', username: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ username, role, exp: 9999999999 })}.sig`;
}

async function loginAs(page: Page, username: string) {
  await page.addInitScript(
    (t) => window.localStorage.setItem('psych_token_persistent', t as string),
    mockToken('user', username),
  );
}

const APP = 'http://localhost:5173';

test('心理筛查页合并：侧栏一项、四个标签页、文本页不再带量表入口', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await loginAs(page, 'xiaoyu');
  await page.goto(`${APP}/#/personal/screening`);

  const nav = page.locator('aside nav');
  await expect(nav.getByText('心理筛查', { exact: true })).toBeVisible();
  await expect(nav.getByText('多模态采集', { exact: true })).toHaveCount(0);

  for (const label of ['文本采集', '语音采集', '图像采集', '量表填写']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  // 文本采集 tab：纯粹日记，不再出现量表选择
  await expect(page.getByText('开放式情绪日记')).toBeVisible();
  await expect(page.getByText('选择量表开始作答')).toHaveCount(0);

  // 量表填写 tab
  await page.getByRole('button', { name: '量表填写', exact: true }).click();
  await expect(page).toHaveURL(/tab=scale/);
  await expect(page.getByRole('heading', { name: '选一个量表开始' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '我的筛查记录' })).toBeVisible();
  await expect(page.getByText('选择量表开始作答')).toHaveCount(0);

  // 作答表单能打开，URL 带 paper 且保留 tab
  await page.getByRole('button', { name: '开始 PHQ-9' }).click();
  await expect(page).toHaveURL(/paper=PHQ-9/);
  await expect(page).toHaveURL(/tab=scale/);

  console.log('pageerrors:', JSON.stringify(errors));
  expect(errors).toEqual([]);
});

test('旧地址与记录链接都落到量表页', async ({ page }) => {
  await loginAs(page, 'xiaoyu');

  await page.goto(`${APP}/#/personal/data-collection`);
  await expect(page).toHaveURL(/\/personal\/screening/);

  // 带 record 的详情链接必须直接落在量表 tab
  await page.goto(`${APP}/#/personal/screening?record=NOT-EXIST`);
  await expect(page.getByText('未找到该筛查记录，请返回列表重试。')).toBeVisible();
  const activeTab = page.getByRole('button', { name: '量表填写', exact: true });
  await expect(activeTab).toHaveClass(/bg-primary-500/);

  // 从详情点返回：仍停量表页，不能被踢回文本采集
  await page.getByRole('button', { name: '返回筛查记录' }).click();
  await expect(page.getByRole('heading', { name: '选一个量表开始' })).toBeVisible();
  await expect(activeTab).toHaveClass(/bg-primary-500/);
});
