import { test, expect } from '@playwright/test';

/**
 * 采集 → 哈希检索报告 → 挂载 端到端（2026-10-14）：
 *   ① 提交日记后，采集页底部显示检索报告（等级/结论/命中记录）
 *   ② 达到预警级别时报告卡带预警回执，并出现在预警中心
 *   ③ 首页「最近一次输入」显示分析结论
 */

const DISTRESS_TEXT = '最近总是睡不着，情绪很低落，对什么都提不起兴趣，觉得活着没意思。';

test('采集页检索报告 + 预警挂载全链路', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('http://localhost:5173/#/login');
  await page.getByLabel('用户名').fill('xiaoyu');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: /登录并进入系统/ }).click();
  await page.waitForURL(/#\/personal\//, { timeout: 15000 });

  // ① 提交日记
  await page.goto('http://localhost:5173/#/personal/data-collection');
  await page.waitForTimeout(800);
  await page.getByLabel('情绪日记内容').fill(DISTRESS_TEXT);
  await page.getByRole('button', { name: /保存到我的档案/ }).click();
  await expect(page.getByText(/日记已保存/)).toBeVisible({ timeout: 30000 });
  console.log('① 日记保存成功');

  // ② 底部出现检索报告（等级 + 结论 + 命中记录）
  await expect(page.getByText('检索报告').last()).toBeVisible({ timeout: 15000 });
  const body = await page.evaluate(() => document.body.innerText);
  const hasConclusion = body.includes('在真实跨模态语料库中检索到');
  const hasHits = body.includes('最相似的语料记录');
  console.log('② 报告结论可见: ' + hasConclusion + '；命中列表可见: ' + hasHits);
  expect(hasConclusion).toBe(true);
  expect(hasHits).toBe(true);

  // ③ 若达到预警级别：报告卡带回执 + 预警中心可见
  const alertMatch = body.match(/已生成预警（(ALT-[A-F0-9]+)）/);
  if (alertMatch) {
    console.log('③ 达到预警级别，预警ID: ' + alertMatch[1]);
    await page.goto('http://localhost:5173/#/personal/alerts');
    await page.waitForTimeout(2500);
    const alertsBody = await page.evaluate(() => document.body.innerText);
    console.log('   预警中心可见采集预警: ' + alertsBody.includes('多模态采集'));
    expect(alertsBody.includes('多模态采集')).toBe(true);
  } else {
    console.log('③ 本次未达预警级别（等级为关注/稳定）');
  }

  // ④ 首页「最近一次输入」带结论
  await page.goto('http://localhost:5173/#/personal/dashboard');
  await page.waitForTimeout(2500);
  const dashBody = await page.evaluate(() => document.body.innerText);
  console.log('④ 首页显示分析结论: ' + dashBody.includes('在真实跨模态语料库中检索到'));
  expect(dashBody.includes('在真实跨模态语料库中检索到')).toBe(true);

  await page.screenshot({ path: 'report-e2e.png', fullPage: true });
  expect(errors).toEqual([]);
});
