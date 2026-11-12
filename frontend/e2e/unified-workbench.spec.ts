import { test, expect } from '@playwright/test';

const caseRecord = {
  subject: 'demo:001', ref: '演示案例 001', department: '测试院系',
  questionnaire: 'PHQ-9', score: 16, max_score: 27, alert_level: 'orange',
  date: '2026-10-11', delta: 2, media: [], reasons: ['已有橙色预警'],
  missing: [], evidence_ids: ['demo-1'], history: [], tasks: [], materials: [],
};

test.beforeEach(async ({ page }) => {
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from('{"username":"admin","role":"admin","exp":9999999999}').toString('base64url'), 'test'].join('.');
  await page.addInitScript((value) => localStorage.setItem('psych_token_persistent', value), token);
});

test('旧研判入口打开统一预警队列，并能查看该预警关联的业务个案', async ({ page }) => {
  const alert = { id: 'ALT-OLDER', screeningId: 'SCR-OLDER', name: '合成测试成员', level: 'orange',
    status: 'pending', history: [] };
  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    const data = url.pathname.endsWith('/alerts') ? { items: [], total: 0, page: 1, pageSize: 4 }
      : url.pathname.endsWith('/ALT-OLDER') ? alert : [];
    await route.fulfill({ json: { code: 200, data } });
  });
  await page.route(/\/api\/agent-workspace(?:[/?]|$)/, async (route) => {
    const url = new URL(route.request().url());
    const isCase = decodeURIComponent(url.pathname).endsWith('/cases/screening-code:SCR-OLDER');
    if (isCase) expect(url.searchParams.get('scope')).toBe('live');
    await route.fulfill({ json: { code: 200, data: isCase
      ? { ...caseRecord, subject: 'case:7', ref: '关联业务案例' }
      : { tasks: [], departments: [], latest_run: null } } });
  });
  await page.goto('/#/admin/judgement?alert=ALT-OLDER');
  await expect(page).toHaveURL(/agent-workbench.*alert=ALT-OLDER.*tab=alerts/);
  await expect(page.getByRole('button', { name: '预警队列' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: '预警研判与处置', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '查看个案研判' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '关联业务案例' })).toBeVisible();
});

test('合成个案显示 DeepSeek 草案和证据，重新打开档案可回看', async ({ page }) => {
  let generated = false;
  await page.route(/\/api\/agent-workspace(?:[/?]|$)/, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const isCase = pathname.includes('/cases/');
    if (isCase && route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ scope: 'demo' });
      generated = true;
    }
    const assessment = generated ? {
      id: 'test-assessment', created_at: '2026-11-12T00:00:00Z', summary: '规则研判',
      recommendation: '等待人工复核', limits: [], trace: [], evidence_ids: ['demo-1'],
      model_status: 'generated', model_draft: {
        summary: '同量表分数较上次增加 2 分。', review_points: ['核对原始作答。'],
        evidence_refs: ['demo-1'], model: 'deepseek-flash',
      },
    } : null;
    const data = isCase ? { ...caseRecord, assessment } : {
      tasks: [], departments: [], model_available: true, latest_run: {
        created_at: '2026-11-12T00:00:00Z', total: 1, records: 2, distribution: { orange: 1 },
        priority_count: 1, department: 'all', days: 30, subjects: [caseRecord],
      },
    };
    await route.fulfill({ json: { code: 200, data } });
  });
  await page.goto('/#/admin/agent-workbench');
  await page.getByRole('button', { name: '查看档案' }).click();
  const drawer = page.getByRole('dialog', { name: '个人研判档案' });
  await drawer.getByRole('button', { name: '运行个案研判' }).click();
  await expect(drawer.getByRole('heading', { name: 'DeepSeek 复核草案' })).toBeVisible();
  await expect(drawer.getByText(/引用筛查：demo-1/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '查看档案' }).click();
  await expect(drawer.getByText('核对原始作答。')).toBeVisible();
});
