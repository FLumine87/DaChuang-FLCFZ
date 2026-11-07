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
const PLACEHOLDER = '例如：最近入睡困难、白天无力、对课程提不起兴趣...';

test('检索页默认勾选「送入检索数据」，取消后不再写入', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await loginAs(page, 'xiaoyu');
  await page.goto(`${APP}/#/personal/retrieval`);
  await page.getByText('动态跨模态哈希检索').waitFor();

  const checkbox = page.getByRole('checkbox', {name: '送入检索数据', exact: true});
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();

  // 默认勾选：检索后要有一条"已存入"的反馈
  await page.getByPlaceholder(PLACEHOLDER).fill('最近总是失眠，压力很大，情绪低落');
  await page.getByRole('button', { name: /开始检索/ }).click();
  await expect(page.getByText(/找到 \d+ 个高相似模式/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/已作为一条记录存入系统/)).toBeVisible({ timeout: 20_000 });

  // 取消勾选：换一段内容再检索，不再写入
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await page.getByPlaceholder(PLACEHOLDER).fill('这段只是看看，不想留痕');
  await page.getByRole('button', { name: /开始检索/ }).click();
  await expect(page.getByText(/找到 \d+ 个高相似模式/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/已作为一条记录存入系统/)).toHaveCount(0);
  await expect(page.getByText(/正在送入系统/)).toHaveCount(0);

  console.log('pageerrors:', JSON.stringify(errors));
  expect(errors).toEqual([]);
});
