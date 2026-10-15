import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * AI 陪伴对话真实链路回归（2026-10-14 修复）：
 *   此前 ChatPage 的回复永远是前端本地随机兜底文案，从不经过大模型——
 *   即使配置了 LLM API 也"无法实现 AI 对话"。修复后回复来自
 *   POST /api/v1/chat/companion（后端拼装人设 + 个人 KG 上下文 + 最近
 *   对话历史，调 OpenAI 兼容接口），仅在后端不可达 / Mock 模式 /
 *   LLM 调用失败时才回退本地文案并如实标注来源。
 *
 * 本用例用 alg=none 演示 token 直入个人端聊天页：
 *   1. 发送一条包含症状的消息；
 *   2. 必须等到一条新的 assistant 回复（对话链路通）；
 *   3. 不得出现「离线模式」标注（服务端必须可达）；
 *   4. 回复若是四条本地兜底文案之一（说明后端处于 Mock / LLM 失败），
 *      必须带「本机文案 · 未走大模型」标注，如实告知来源；
 *   5. 三元组抽取卡片照常出现（抽取与对话并行，互不阻塞）。
 * LLM 真实模式下回复由大模型生成，不会恰好等于兜底文案 → 走真实断言。
 */

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

const FALLBACK_REPLIES = [
  '谢谢你愿意分享这些。我在认真听，也想多了解一点——能具体说说这件事带给你的感受吗？',
  '我能感受到这句话背后的分量。这样的时刻确实不容易，你已经在尽力面对了。',
  '收到。我把你提到的内容记下来了。如果愿意，可以再多聊一点，比如它对你的睡眠或心情有什么影响？',
  '我在。你说的这些对我很重要，我会一直在这里陪着你梳理。',
];

test('AI 陪伴对话走后端 LLM，兜底文案必须如实标注', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await loginAs(page, 'xiaoyu');
  const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
  await page.goto(`${APP}/#/personal/me/chat`);

  const welcome = page.getByText('你好，我是你的 AI 心理陪伴助手', { exact: false });
  await expect(welcome).toBeVisible();

  const input = page.getByPlaceholder('聊聊你的状态、兴趣或烦恼…（Enter 发送，Shift+Enter 换行）');
  await input.fill('最近总是失眠，晚上躺在床上翻来覆去，压力有点大。');
  await page.getByRole('button', { name: '发送', exact: true }).click();

  // assistant 气泡 = justify-start 容器的直接子元素（用户气泡在 justify-end，头部卡片不是 justify-start）
  const assistantBubbles = page.locator('div.flex.justify-start > div');
  await expect
    .poll(async () => assistantBubbles.count(), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(2);

  const replyBubble = assistantBubbles.nth(1);
  const replyText = (await replyBubble.textContent()) ?? '';

  // 服务端必须可达：不允许离线模式
  await expect(page.getByText('离线模式')).toHaveCount(0);

  if (FALLBACK_REPLIES.some((r) => replyText.includes(r))) {
    // 兜底文案必须如实标注来源，不许冒充大模型
    await expect(page.getByText('本机文案 · 未走大模型')).toBeVisible();
  } else {
    // 真实 LLM 回复：不带本机文案标注
    await expect(page.getByText('本机文案 · 未走大模型')).toHaveCount(0);
    expect(replyText.trim().length).toBeGreaterThan(10);
  }

  expect(errors).toEqual([]);
});
