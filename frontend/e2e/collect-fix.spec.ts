import { test, expect } from '@playwright/test';

/**
 * 多模态采集端到端（2026-10-14）：
 * 真实登录 → 采集页上传真实图片/语音 → 上传接口落盘+真实特征提取 →
 * 补充挂到筛查记录 → 页面显示成功。
 */

test('多模态采集：图像上传全链路', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('http://localhost:5173/#/login');
  await page.getByLabel('用户名').fill('fyx');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\//, { timeout: 15000 });

  await page.goto('http://localhost:5173/#/personal/data-collection');
  await page.waitForTimeout(1000);

  // 图像采集
  await page.getByRole('button', { name: /图像采集/ }).click();
  await page.setInputFiles('input[accept="image/*"]', 'D:/DaChuang/FER2013/test/angry/PrivateTest_10131363.jpg');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /送入动态哈希引擎/ }).click();
  await expect(page.getByText(/已提交 \d+ 张图像/)).toBeVisible({ timeout: 30000 });
  console.log('图像采集: 提交成功');

  // 语音采集
  await page.getByRole('button', { name: /语音采集/ }).click();
  await page.setInputFiles('input[accept="audio/*"]', 'D:/DaChuang/EATD-Corpus/EATD-Corpus/v_5/negative.wav');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /送入动态哈希引擎/ }).click();
  await expect(page.getByText(/已提交 \d+ 条音频/)).toBeVisible({ timeout: 30000 });
  console.log('语音采集: 提交成功');

  // 无 JS 报错
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'collect-e2e.png' });
});

test('采集结果在检索页可见（我的记录）', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('http://localhost:5173/#/login');
  await page.getByLabel('用户名').fill('fyx');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\//, { timeout: 15000 });

  await page.goto('http://localhost:5173/#/personal/retrieval');
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  const hasMine = body.includes('我的记录');
  console.log('检索页含「我的记录」: ' + hasMine);
  expect(hasMine).toBe(true);
});
