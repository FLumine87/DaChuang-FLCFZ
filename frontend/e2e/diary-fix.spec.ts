import { test, expect } from '@playwright/test';

/**
 * 文本日记 + 上传后挂靠 端到端（2026-10-14）：
 *   ① xiaoyu（无筛查记录）：日记保存 → 挂用户名下 → 首页与检索页可见
 *   ② fyx（有筛查记录）：日记保存 → 正常成功（挂到最近筛查记录）
 */

const DIARY_XIAOYU = '自动化验证：今天状态不错，晚上散步了半小时，睡得也踏实。';
const DIARY_FYX = '自动化验证：今日复盘，工作节奏平稳。';

test('xiaoyu 无筛查记录：日记保存后首页与检索页可见', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('http://localhost:5173/#/login');
  await page.getByLabel('用户名').fill('xiaoyu');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\//, { timeout: 15000 });

  // 保存日记
  await page.goto('http://localhost:5173/#/personal/data-collection');
  await page.waitForTimeout(800);
  await page.getByLabel('情绪日记内容').fill(DIARY_XIAOYU);
  await page.getByRole('button', { name: /保存到我的档案/ }).click();
  await expect(page.getByText(/日记已保存/)).toBeVisible({ timeout: 15000 });
  console.log('① 日记保存成功');

  // 检索页「我的记录」应出现（我的采集）
  await page.goto('http://localhost:5173/#/personal/retrieval');
  await page.waitForTimeout(2500);
  let body = await page.evaluate(() => document.body.innerText);
  console.log('② 检索页可见日记: ' + body.includes(DIARY_XIAOYU));
  expect(body.includes(DIARY_XIAOYU)).toBe(true);

  // 首页「最近一次输入」应出现
  await page.goto('http://localhost:5173/#/personal/dashboard');
  await page.waitForTimeout(2500);
  body = await page.evaluate(() => document.body.innerText);
  console.log('③ 首页可见日记: ' + body.includes(DIARY_XIAOYU));
  expect(body.includes(DIARY_XIAOYU)).toBe(true);

  expect(errors).toEqual([]);
});

test('fyx 有筛查记录：日记保存成功', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('http://localhost:5173/#/login');
  await page.getByLabel('用户名').fill('fyx');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\//, { timeout: 15000 });

  await page.goto('http://localhost:5173/#/personal/data-collection');
  await page.waitForTimeout(800);
  await page.getByLabel('情绪日记内容').fill(DIARY_FYX);
  await page.getByRole('button', { name: /保存到我的档案/ }).click();
  await expect(page.getByText(/日记已保存/)).toBeVisible({ timeout: 15000 });
  console.log('④ fyx 日记保存成功');

  // 首页最近一次输入应显示这篇（它挂到了最新筛查记录上）
  await page.goto('http://localhost:5173/#/personal/dashboard');
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  console.log('⑤ 首页可见 fyx 日记: ' + body.includes(DIARY_FYX));
  expect(body.includes(DIARY_FYX)).toBe(true);
});
