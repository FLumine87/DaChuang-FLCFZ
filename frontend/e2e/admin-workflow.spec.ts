import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:5178' });

test('真实后端：登录提示、今日待办、统一档案和新增材料复核', async ({ page, request }, testInfo) => {
  await page.goto('/#/login?panel=admin');
  await page.getByRole('button', { name: /管理端 · 咨询师/ }).click();
  await expect(page.getByPlaceholder('请输入管理员账号')).toHaveValue('admin');
  await page.getByRole('button', { name: '进入管理端', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日工作', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('today-work.png'), fullPage: true });
  const work = page.getByRole('region', { name: '今日工作' });
  await work.getByRole('button', { name: /已逾期/ }).click();
  await expect(work.getByText('安排授权人员复核')).toBeVisible();
  await work.getByRole('link', { name: '查看案例 →' }).click();
  await expect(page.getByText('当前材料与最近个案研判一致。')).toBeVisible();
  await expect(page.getByText('ALT-FLOW', { exact: false }).first()).toBeVisible();
  await page.getByRole('textbox', { name: '案例备注' }).fill('未保存备注');
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '案例备注' })).toHaveValue('');

  const login = await request.post('http://127.0.0.1:8016/api/auth/login', { data: { username: 'flow-user', password: 'test123' } });
  const token = (await login.json()).data.token;
  const saved = await request.post('http://127.0.0.1:8016/api/personal/supplements', {
    headers: { Authorization: 'Bearer ' + token }, data: { kind: 'text', text: '验收新增材料' },
  });
  expect(saved.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText('上次研判后新增 1 条、修改 0 条、移除 0 条材料，请重新复核。')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('case-update.png'), fullPage: true });
  await page.getByText(/文本 ·/).first().click();
  await expect(page.getByText('验收新增材料')).toBeVisible();
  await page.getByRole('link', { name: '在 Agent 工作台复核 →' }).click();
  const drawer = page.getByRole('dialog', { name: '个人研判档案' });
  await expect(drawer.getByText(/这份研判后新增 1 条/)).toBeVisible();
  await expect(drawer.getByText('验收新增材料')).toBeVisible();
  await drawer.getByRole('button', { name: '运行个案研判', exact: true }).click();
  await expect(drawer.getByText(/这份研判后新增/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await page.goto('/#/admin/cases?case=CASE-FLOW');
  await expect(page.getByText('当前材料与最近个案研判一致。')).toBeVisible();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.getByText('选择一个案例查看筛查、预警和跟进时间线。')).toBeVisible();
});

test('真实后端：今日工作链接进入业务空间任务页', async ({ page }) => {
  await page.goto('/#/login?panel=admin');
  await page.getByRole('button', { name: /管理端 · 咨询师/ }).click();
  await page.getByRole('button', { name: '进入管理端', exact: true }).click();
  await page.getByRole('link', { name: '进入业务随访处置 →' }).click();
  await expect(page.getByText('业务空间：仅分析已完成筛查。', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '随访处置', exact: true })).toBeVisible();
});
