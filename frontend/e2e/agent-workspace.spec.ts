import { test, expect } from '@playwright/test';

test('group assessment, individual evidence and persisted follow-up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/auth');
  await page.getByPlaceholder('请输入用户名').fill(process.env.AGENT_TEST_USERNAME || 'admin');
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(process.env.AGENT_TEST_PASSWORD || 'admin123');
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await page.getByRole('link', { name: 'Agent Workbench', exact: true }).click();
  await page.getByRole('button', { name: '启动群体研判', exact: true }).first().click();
  await expect(page.getByText('本次研判已保存，任务草案等待人工审核。')).toBeVisible();
  await expect(page.locator('.aw-metrics strong').first()).toHaveText('24');
  await page.screenshot({ path: '../docs/agent-v2-overview.png', fullPage: true });
  await page.getByRole('button', { name: '查看档案' }).first().click();
  const drawer = page.getByRole('dialog', { name: '个人研判档案' });
  await expect(drawer.getByRole('heading', { name: '演示案例 001', exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '运行个案研判', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '个案研判记录', exact: true })).toBeVisible();
  await expect(drawer.locator('audio')).toHaveAttribute('src', /diary\.wav/);
  const audioReady = await drawer.locator('audio').evaluate(async audio => {
    const element = audio as HTMLAudioElement;
    element.load();
    await new Promise<void>((resolve, reject) => {
      if (element.readyState >= 1) { resolve(); return; }
      element.addEventListener('loadedmetadata', () => resolve(), { once: true });
      element.addEventListener('error', () => reject(new Error('Audio failed')), { once: true });
    });
    return element.duration;
  });
  expect(audioReady).toBeGreaterThan(1);
  await expect(drawer.locator('img')).toBeVisible();
  await page.screenshot({ path: '../docs/agent-v2-case.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: /^随访处置/ }).click();
  const proposed = page.locator('.aw-task').filter({ has: page.getByRole('button', { name: '确认并分配', exact: true }) }).first();
  if (await proposed.count()) {
    await proposed.getByRole('button', { name: '确认并分配', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '确认并分配', exact: true });
    await modal.getByLabel('负责人', { exact: true }).fill('演示负责人');
    await modal.getByRole('button', { name: '保存到后端' }).click();
    await expect(modal).not.toBeVisible();
  }
  const assigned = page.locator('.aw-task').filter({ has: page.getByRole('button', { name: '记录随访', exact: true }) }).first();
  await assigned.getByRole('button', { name: '记录随访', exact: true }).click();
  const followup = page.getByRole('dialog', { name: '记录随访', exact: true });
  await followup.getByLabel('随访记录', { exact: true }).fill('浏览器验收：已联系演示案例，后续按计划复核。');
  await followup.getByLabel('下一次计划日期').fill('2026-10-25');
  await followup.getByRole('button', { name: '保存到后端' }).click();
  await expect(followup).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^随访处置/ }).click();
  await expect(page.getByText('计划日期：2026-10-25').first()).toBeVisible();
  const savedTask = page.locator('.aw-task').filter({ hasText: '计划日期：2026-10-25' }).first();
  await savedTask.locator('summary').click();
  await expect(savedTask.getByText('浏览器验收：已联系演示案例，后续按计划复核。', { exact: false })).toBeVisible();
  await page.screenshot({ path: '../docs/agent-v2-followup.png', fullPage: true });
  await page.getByRole('button', { name: '协作记录', exact: true }).click();
  await expect(page.locator('.aw-trace article')).toHaveCount(4);
  await page.screenshot({ path: '../docs/agent-v2-workflow.png', fullPage: true });
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.aw-heading')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBeFalsy();
  await page.screenshot({ path: '../docs/agent-v2-mobile.png', fullPage: true });
});
