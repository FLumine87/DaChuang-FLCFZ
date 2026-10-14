import { test, expect } from '@playwright/test';

/**
 * 检索两阶段体验回归（2026-10-14 产品口径）：
 *   ① 检索结果秒出（哈希检索优势，不调大模型）
 *   ② 报告区先显示"大模型思考中"，RAG 深度报告异步回来后替换
 *      （大模型失败 / 离线模式 → 兜底显示规则分析并标注来源）
 * 大模型真实模式下报告要 20~30s，断言在 90s 内完成即可；
 * 无 Key 的环境下 mock=true 走规则报告，两种结局都必须正常渲染。
 */

/** 真实登录换 token：mock（alg=none）token 过不了主后端鉴权，接口会 401 */
async function realToken(username: string, password: string): Promise<string> {
  const resp = await fetch('http://localhost:5173/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await resp.json();
  if (!json?.data?.token) throw new Error(`登录失败: ${JSON.stringify(json).slice(0, 120)}`);
  return json.data.token as string;
}

test('检索结果秒出，报告异步替换', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const token = await realToken('xiaoyu', '123456');
  await page.addInitScript(
    (t) => window.localStorage.setItem('psych_token_persistent', t as string),
    token,
  );
  await page.goto('/#/personal/retrieval');
  await page.getByText('动态跨模态哈希检索').waitFor();
  await page.getByPlaceholder('例如：最近入睡困难、白天无力、对课程提不起兴趣...')
    .fill('最近总是失眠，压力很大，情绪低落');
  await page.getByRole('button', { name: /开始检索/ }).click();

  // ① 检索结果必须秒出（5 秒内，证明没被大模型拖住）
  await expect(page.getByText(/找到 \d+ 个高相似模式/)).toBeVisible({ timeout: 5_000 });

  // ② 报告区最终要有内容：大模型报告或兜底的规则报告，且标注来源
  await expect(
    page.getByText(/大模型分析|规则分析 · 依据检索命中/).first(),
  ).toBeVisible({ timeout: 90_000 });
  // 报告正文渲染出来
  await expect(page.getByText('RAG 智能分析报告')).toBeVisible();
  await expect(page.getByText(/综合分析|评估/).nth(1)).toBeVisible();

  expect(errors).toEqual([]);
});
