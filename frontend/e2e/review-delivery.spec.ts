import { test, expect } from '@playwright/test';
import { questionnaires } from '../src/data/questionnaireData';

test.use({ baseURL: 'http://127.0.0.1:5178' });

test('真实两端：预览取消、发送、通知、确认收到、完成复查、工作人员复核', async ({ page, browser }, testInfo) => {
  await page.goto('/#/login?panel=admin');
  await page.getByRole('button', { name: /管理端 · 咨询师/ }).click();
  await page.getByRole('button', { name: '进入管理端', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日工作', exact: true })).toBeVisible();
  await page.goto('/#/admin/agent-workbench?scope=live&tab=tasks');
  await page.getByRole('button', { name: '确认并分配', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '确认并分配', exact: true });
  await editor.getByLabel('负责人', { exact: true }).fill('验收咨询师');
  await editor.getByRole('button', { name: '保存到后端' }).click();
  await expect(editor).not.toBeVisible();
  await page.goto('/#/admin/cases?case=CASE-FLOW');
  const delivery = page.getByRole('region', { name: '复查发送与反馈' });
  await delivery.getByLabel('已审核的跟进任务').selectOption({ label: '安排授权人员复核' });
  await delivery.getByLabel('发给个人的说明').fill('请按实际情况完成本次复查。');
  await delivery.getByLabel('复查计划日期').fill('2026-12-01');
  await delivery.getByRole('button', { name: '预览发送内容' }).click();
  await expect(delivery.getByText('将发送给：验收成员')).toBeVisible();
  await delivery.getByRole('button', { name: '取消发送', exact: true }).click();
  await expect(delivery.getByRole('button', { name: '确认发送给个人' })).toHaveCount(0);
  await delivery.getByRole('button', { name: '预览发送内容' }).click();
  await delivery.getByRole('button', { name: '确认发送给个人' }).dblclick();
  await expect(delivery.getByText('请完成一次复查问卷 · 待确认')).toBeVisible();

  const context = await browser.newContext();
  const personal = await context.newPage();
  try {
    await personal.goto('http://127.0.0.1:5178/#/login');
    await personal.getByPlaceholder('请输入用户名').fill('flow-user');
    await personal.getByPlaceholder('请输入密码', { exact: true }).fill('test123');
    await personal.getByRole('button', { name: '登录并进入系统', exact: true }).click();
    await expect(personal).toHaveURL(/personal/);
    await personal.goto('http://127.0.0.1:5178/#/personal/reviews');
    await expect(personal.getByText('请完成一次复查问卷', { exact: true })).toBeVisible();
    await personal.getByRole('button', { name: /站内通知/ }).click();
    await expect(personal.getByRole('region', { name: '站内通知列表' }).getByText(/你收到一项复查任务/)).toBeVisible();
    await personal.getByRole('button', { name: '关闭通知' }).click();
    await personal.getByRole('button', { name: '确认收到', exact: true }).dblclick();
    await expect(personal.getByText('已确认收到', { exact: true })).toBeVisible();
    await personal.reload();
    await expect(personal.getByText('已确认收到', { exact: true })).toBeVisible();
    await personal.getByRole('button', { name: '开始复查' }).click();
    const scale = questionnaires.find((item) => item.id === 'PHQ-9')!;
    for (const question of scale.questions) {
      await expect(personal.getByText(question.text, { exact: false })).toBeVisible();
      await personal.getByRole('button', { name: '完全不会', exact: true }).click();
    }
    await personal.getByRole('button', { name: '提交并查看结果' }).click();
    await expect(personal.getByText('已提交，待复核', { exact: true })).toBeVisible();
    await expect(personal.getByRole('button', { name: '开始复查' })).toHaveCount(0);
    await personal.screenshot({ path: testInfo.outputPath('personal-submitted.png'), fullPage: true });

    await delivery.getByRole('button', { name: '刷新复查状态', exact: true }).click();
    await expect(delivery.getByText('复查得分：0 / 27', { exact: false })).toBeVisible();
    await delivery.getByRole('button', { name: '记录复核', exact: true }).click();
    await delivery.getByLabel('内部处理记录').fill('仅内部可见的验收复核备注');
    await delivery.getByRole('button', { name: '放弃操作', exact: true }).click();
    await expect(delivery.getByLabel('内部处理记录')).toHaveCount(0);
    await delivery.getByRole('button', { name: '记录复核', exact: true }).click();
    await delivery.getByLabel('内部处理记录').fill('仅内部可见的验收复核备注');
    await delivery.getByRole('button', { name: '确认保存复核操作' }).dblclick();
    await expect(delivery.getByText('请完成一次复查问卷 · 已复核')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('staff-reviewed.png'), fullPage: true });
    await personal.reload();
    await expect(personal.getByText('已复核', { exact: true })).toBeVisible();
    await expect(personal.getByText('仅内部可见的验收复核备注', { exact: false })).toHaveCount(0);
    await personal.getByRole('button', { name: /站内通知/ }).click();
    const inbox = personal.getByRole('region', { name: '站内通知列表' });
    await expect(inbox.getByText('工作人员已查看你的复查结果。')).toBeVisible();
    await inbox.getByRole('button', { name: '标为已读', exact: true }).click();
    await expect(inbox.getByRole('button', { name: '标为已读', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
