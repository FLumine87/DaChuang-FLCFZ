import { test } from '@playwright/test';

const ADMIN_ROUTES = [
  '/admin/dashboard',
  '/admin/screening',
  '/admin/data-collection',
  '/admin/retrieval',
  '/admin/alerts',
  '/admin/cases',
  '/admin/judgement',
  '/admin/agent-workbench',
];

test('管理端全页面巡检：无白屏无崩溃', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${err.message}`));

  await page.goto('http://localhost:5173/#/login?panel=admin');
  await page.getByLabel('管理员账号').fill('adminer');
  await page.getByLabel('密码', { exact: true }).fill('admin');
  await page.getByRole('button', { name: /进入管理端/ }).click();
  await page.waitForURL(/#\/admin\/dashboard/, { timeout: 15000 });

  const report: string[] = [];
  for (const route of ADMIN_ROUTES) {
    errors.length = 0;
    await page.goto(`http://localhost:5173/#${route}`);
    await page.waitForTimeout(2500);
    const len = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1);
    const status = len > 500 && errors.length === 0 ? 'OK' : len <= 500 ? '白屏!' : '报错!';
    report.push(`${status}  ${route}  (root=${len}${errors.length ? ', 错误: ' + errors[0].slice(0, 80) : ''})`);
  }
  console.log('--- 巡检结果 ---');
  for (const line of report) console.log(line);

  // 未分配预警指标：库里有 45 条未分配，应显示 45 而非 0
  await page.goto('http://localhost:5173/#/admin/dashboard');
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(/未分配预警[\s\S]{0,60}/);
  console.log('未分配预警指标: ' + (m ? m[0].replace(/\n/g, ' ') : '未找到'));
  await page.screenshot({ path: 'admin-dashboard-ok.png', fullPage: true });
});
