import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:5176' });
const alert = { id: 'ALT-TEST', screeningId: 'SCR-TEST', name: '测试成员', level: 'orange',
  status: 'pending', trigger: '多模态采集', description: '人工复核', assignee: '未分配',
  createdAt: '2026-11-06', updatedAt: '2026-11-06', assigneeId: null, followUpNotes: '',
  score: null, maxScore: null, questionnaire: '', history: [] };

test.beforeEach(async ({ page }) => {
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from('{"username":"admin","role":"admin","exp":9999999999}').toString('base64url'), 'test'].join('.');
  await page.addInitScript((value) => localStorage.setItem('psych_token_persistent', value), token);
  await page.route('**/api/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/dashboard')) data = { stats: { totalScreenings: 1, monthlyScreenings: 1, openAlerts: 1, completionRate: 100, seedRecords: 0 },
      trendData: [], alertDistribution: [], alertRecords: [alert] };
    else if (path.endsWith('/alerts')) data = { items: [alert], total: 1, page: 1, pageSize: 50 };
    else if (path.endsWith('/ALT-TEST')) data = alert;
    else if (path.endsWith('/work-queue')) data = {date:'2026-11-09',tasks:[],unassignedAlerts:1,pendingReview:0,dueToday:0,overdue:0};
    else if (path.endsWith('/supplements')) data = { items: [{ id: 1, name: '测试成员', kind: 'audio', filename: 'sample.wav',
      createdAt: '2026-11-06', analysis: { levelLabel: '关注', conclusion: '实际保存的结论', alertId: 'ALT-TEST' } }],
      total: 1, page: 1, pageSize: 50 };
    await route.fulfill({ json: { code: 200, data } });
  });
});

test('首页预警直达详情，重复选择和返回正常', async ({ page }) => {
  await page.goto('/#/admin/dashboard');
  await page.getByRole('link', { name: '测试成员 · 查看详情 →' }).click();
  await expect(page.getByRole('heading', { name: 'ALT-TEST' })).toBeVisible();
  await page.getByRole('button', { name: '查看预警 ALT-TEST 的详情' }).dblclick();
  await expect(page.getByRole('heading', { name: 'ALT-TEST' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ALT-TEST' })).toBeVisible();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.getByText('选择一条预警查看详情并处理')).toBeVisible();
});

test('筛查管理能查看独立采集、分析和关联预警', async ({ page }) => {
  await page.goto('/#/admin/screening');
  await page.getByRole('button', { name: '多模态采集与分析' }).click();
  await expect(page.getByText('独立采集', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看采集 1' }).click();
  await expect(page.getByText('实际保存的结论')).toBeVisible();
  await page.getByRole('link', { name: '查看关联预警 →' }).click();
  await expect(page.getByRole('heading', { name: 'ALT-TEST' })).toBeVisible();
});

test('纯图片无需文字可查询，失败可重试，连点只提交一次', async ({ page }) => {
  await page.goto('/#/admin/retrieval');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAO0lEQVR4nO3RQREAMAjEwKOqq6SakFUJ4cMvK+CYCXVfZ9NZXY8HBvwBMhEyETIRMhEyETIRMhEyUcgH0D0CFoDS88QAAAAASUVORK5CYII=', 'base64');
  await page.locator('#admin-media-image').setInputFiles({ name: 'query.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('图像查询：query.png')).toBeVisible();
  let count = 0;
  await page.route('**/api/admin/search', async (route) => {
    count++;
    const body = route.request().postDataJSON();
    expect(body.query).toBe('');
    expect(body.modality).toBe('image');
    expect(body.media_base64).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (count === 1) await route.fulfill({ status: 503, json: { message: '测试服务暂不可用' } });
    else await route.fulfill({ json: { code: 200, data: { results: [], report: null } } });
  });
  await page.getByRole('button', { name: '检索', exact: true }).dblclick();
  await expect(page.getByRole('alert')).toContainText('测试服务暂不可用');
  expect(count).toBe(1);
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.getByText('没有找到相似案例。', { exact: false })).toBeVisible();
});

test('录音可取消并转为 WAV 发起无文字查询', async ({ page }) => {
  await page.goto('/#/admin/retrieval');
  await page.getByRole('button', { name: '录音查询', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消录音' })).toBeVisible();
  await page.getByRole('button', { name: '取消录音' }).click();
  await expect(page.getByText('语音查询：', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '录音查询', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '停止并使用录音' }).click();
  await expect(page.getByText('语音查询：recording.wav')).toBeVisible();
  await page.route('**/api/admin/search', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.modality).toBe('audio');
    expect(Buffer.from(body.media_base64, 'base64').subarray(0, 4).toString()).toBe('RIFF');
    await route.fulfill({ json: { code: 200, data: { results: [], report: null } } });
  });
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.getByText('没有找到相似案例。', { exact: false })).toBeVisible();
});
