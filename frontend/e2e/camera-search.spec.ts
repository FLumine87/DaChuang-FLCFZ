import { test, expect } from '@playwright/test';

/**
 * 「现场拍照」链路回归（2026-10-14）：
 * 检索页图像线索此前只能从文件选择，现在支持摄像头现场拍照。
 * 假摄像头由 playwright.config 的 launchOptions 提供（fake device + 自动授权）。
 * 链路：图片按钮 → 菜单「现场拍照」→ 摄像头出流 → 拍照 → 预览确认
 *      → 与文件选择同一条 pickMedia → base64 → /api/personal/search
 */

function mockToken(username: string, role = 'user'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ username, role, exp: 9999999999 })}.sig`;
}

test('个人端检索页支持现场拍照作为图像查询', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(
    (t) => window.localStorage.setItem('psych_token_persistent', t as string),
    mockToken('xiaoyu'),
  );
  await page.goto('/#/personal/retrieval');
  await page.getByText('动态跨模态哈希检索').waitFor();

  // 图片按钮 → 菜单两项
  await page.getByTitle('上传一张面部图像，或现场拍照作为查询线索').click();
  await expect(page.getByText('从文件选择', { exact: true })).toBeVisible();
  await page.getByText('现场拍照', { exact: true }).click();

  // 摄像头面板（假设备出流）→ 拍照 → 预览 → 确认
  const dialog = page.getByRole('dialog', { name: '现场拍照' });
  await expect(dialog).toBeVisible();
  const takeBtn = dialog.getByRole('button', { name: '拍照', exact: true });
  await expect(takeBtn).toBeEnabled({ timeout: 20_000 });
  await takeBtn.click();
  await expect(dialog.getByRole('button', { name: '用这张检索' })).toBeVisible();
  await dialog.getByRole('button', { name: '用这张检索' }).click();

  // 与文件选择同一条 pickMedia 链路：查询图像预览出现
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('img[alt="查询图像"]')).toBeVisible();

  // 发起图像检索，正常返回结果
  await page.getByRole('button', { name: /开始检索/ }).click();
  await expect(page.locator('img[alt="查询图像"]').first()).toBeVisible();
  await expect(
    page.getByText(/检索完成|相似|命中/).first(),
  ).toBeVisible({ timeout: 90_000 });

  expect(errors).toEqual([]);
});
