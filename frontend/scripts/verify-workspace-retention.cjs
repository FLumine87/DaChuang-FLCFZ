// Run against the development frontend. All API traffic is synthetic and intercepted.
const { chromium } = require('playwright');
const http = require('node:http');
const assert = require('node:assert/strict');
const app = process.env.TEST_APP_URL || 'http://127.0.0.1:38982';

(async () => {
  let finishStream;
  let streamRequests = 0;
  let chatFinished = false;
  let hasChat = false;
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (req.method === 'OPTIONS') { res.end(); return; }
    streamRequests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('data: {"delta":"这是生成到一半的回复"}\n\n');
    finishStream = () => res.end('data: {"delta":"，切页后继续生成完成。"}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const streamUrl = `http://127.0.0.1:${server.address().port}/stream`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.TEST_BROWSER_PATH ? { executablePath: process.env.TEST_BROWSER_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const username = '__workspace_retention_test';
  const token = 'e30.' + Buffer.from(JSON.stringify({ username, role: 'user', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.test';
  await page.addInitScript(({ token, username }) => {
    localStorage.setItem('psych_token_persistent', token);
    localStorage.setItem('psych_first_run:v1:' + username, JSON.stringify({ status: 'done', guideSeen: true }));
    sessionStorage.setItem('psych_first_run:draft:' + username,
      JSON.stringify({ scaleId: 'PHQ-9', recordId: 'retention-test', answers: {}, score: 0, maxScore: 27, level: 'green' }));
  }, { token, username });
  const assessment = {
    id: 'test', status: 'ready', level: 'green', levelLabel: '稳定', conclusion: '保留的检索初筛结果',
    evidence: [], questions: [], recommendedScales: [], references: [], trace: [], missingFields: [],
    nextAction: { type: 'none', label: '观察状态' }, repeatedNegative: { days: [], count: 0, threshold: 3, windowDays: 14 },
    safetyStatus: 'none', ruleVersion: 'test', updatedAt: '', retrievalToken: 'test-token',
  };
  let reportRoute;
  let reportRequests = 0;
  let searchRequests = 0;
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/steward/chat/runs') && route.request().method() === 'POST') {
      streamRequests++; hasChat=true; finishStream=()=>{ chatFinished=true; };
      return route.fulfill({json:{id:'test-retained-chat'}});
    }
    if (url.includes('/steward/chat/runs/')) return route.fulfill({json:{id:'test-retained-chat',reply:'这是生成到一半的回复'+(chatFinished?'，切页后继续生成完成。':''),status:chatFinished?'done':'running'}});
    if (url.includes('/steward/chat/history')) return route.fulfill({json:[]});
    if (url.includes('/steward/safety')) return route.fulfill({json:{crisis_hits:[]}});
    if (url.includes('/api/v1/steward')) return route.fulfill({json:{settings:{enabled:false,screening:true,chat:false,checkin:false,feedback:false,history:true},snapshot:{},status:'paused',version:0,updated_at:'',evidence_count:0,memories:[],suggestions:[],series:{}}});
    if (url.includes('/chat/companion/stream')) return route.continue({ url: streamUrl });
    if (url.includes('/personal/rag-report')) { reportRequests++; reportRoute = route; return; }
    let data = {};
    if (url.includes('/checkin/present')) data = { checkin: null };
    else if (url.includes('/api/account')) data = { account: { username, name: '', department: '', phone: '', email: '', role: 'user' } };
    else if (url.includes('/admin/review/stats')) data = { scope: {}, pending: 0, public: 0, private: 0, rejected: 0, queue: 0, train_version: 'test' };
    else if (url.includes('/admin/review/pending')) data = { items: [], total: 0, limit: 20, offset: 0 };
    else if (url.includes('/personal/search')) { searchRequests++; data = { results: [], assessment }; }
    else if (url.includes('/personal/retrieval-screening')) data = { assessment };
    else if (url.includes('/personal/supplements')) data = route.request().method() === 'GET' ? [] : { report: null };
    else if (url.includes('/kg/extract')) data = { triples: [], mock: false };
    else if (url.includes('/screenings')) data = [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const go = async path => {
    await page.evaluate(path => { window.location.hash = '#' + path; }, path);
    await page.waitForURL('**/#' + path);
    await page.locator(`[data-workspace-route="${path}"][data-workspace-active="true"]`).first().waitFor();
  };
  try {
    await page.goto(app + '/#/personal/me/chat');
    const composer = page.getByPlaceholder('聊聊您的状态、兴趣或烦恼…（Enter 发送，Shift+Enter 换行）');
    await composer.fill('尚未发送的聊天草稿');
    await go('/personal/screening');
    const screeningInput = page.getByPlaceholder('今天感觉……最近睡眠……人际上……');
    await page.getByRole('button', { name: '文本采集', exact: true }).waitFor();
    await screeningInput.fill('尚未保存的筛查输入');
    await go('/personal/me/chat');
    await assert.equal(await composer.inputValue(), '尚未发送的聊天草稿');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('这是生成到一半的回复', { exact: true }).waitFor();
    await go('/personal/screening');
    assert.equal(await screeningInput.inputValue(), '尚未保存的筛查输入');
    assert.equal(await page.locator('.app-content').evaluate(el => getComputedStyle(el).display), 'block', '隐藏的聊天页不能影响当前页面布局');
    assert.equal(await page.getByRole('button', { name: '拖动大肥鱼，也可以用方向键移动' }).count(), 0);
    finishStream();
    await page.waitForFunction(() => localStorage.getItem('psych_chat:v1:__workspace_retention_test')?.includes('切页后继续生成完成'));
    await page.getByRole('button', { name: '检索分析', exact: true }).click();
    const query = page.getByPlaceholder('例如：最近入睡困难、白天无力、对课程提不起兴趣...');
    await query.fill('需要保留的检索输入');
    await query.press('Enter');
    await page.getByText('大模型思考中', { exact: true }).waitFor();
    assert.ok(reportRoute);
    await go('/personal/me/chat');
    await page.getByText('这是生成到一半的回复，切页后继续生成完成。', { exact: true }).waitFor();
    await go('/personal/screening');
    await page.getByText('大模型思考中', { exact: true }).waitFor();
    await go('/personal/me/chat');
    await reportRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mock: false,
      report: { summary: '离开页面后完成的RAG报告', riskLevel: '稳定', sections: [], recommendations: ['保留的建议'], mock: false } }) });
    await page.waitForTimeout(200);
    assert.ok(page.url().endsWith('/personal/me/chat'), '后台任务不能将用户拉回筛查页');
    // 返回不带 tab 的侧栏地址，应恢复此前的检索分析标签。
    await go('/personal/screening');
    await query.waitFor();
    assert.equal(await query.inputValue(), '需要保留的检索输入');
    await page.getByText('离开页面后完成的RAG报告', { exact: true }).waitFor();
    await go('/personal/settings');
    const name = page.getByPlaceholder('您的姓名');
    await name.fill('未保存的个人信息');
    await go('/personal/first/supplement');
    const supplement = page.getByPlaceholder('可以写几句，也可以留空……');
    await supplement.fill('首次筛查里未提交的补充内容');
    await go('/personal/settings');
    assert.equal(await name.inputValue(), '未保存的个人信息');
    await go('/personal/first/supplement');
    assert.equal(await supplement.inputValue(), '首次筛查里未提交的补充内容');
    await go('/personal/screening');
    await page.getByText('离开页面后完成的RAG报告', { exact: true }).waitFor();
    await page.getByRole('button', { name: '文本采集', exact: true }).click();
    assert.equal(await screeningInput.inputValue(), '尚未保存的筛查输入');
    await page.getByRole('button', { name: '检索分析', exact: true }).click();
    await page.getByText('离开页面后完成的RAG报告', { exact: true }).waitFor();
    await page.getByRole('link', { name: '筛查记录', exact: true }).first().click();
    await page.getByRole('heading', { name: '筛查记录', exact: true }).first().waitFor();
    await go('/personal/screening');
    await page.getByText('离开页面后完成的RAG报告', { exact: true }).waitFor();
    assert.equal(streamRequests, 1, '聊天流不能重复请求');
    assert.equal(reportRequests, 1, 'RAG不能重复请求');
    assert.equal(searchRequests, 1, '返回页面不能重复检索');
    assert.deepEqual(errors, []);
    // 换账号后不能读到上一个账号的工作区。
    await page.evaluate(() => {
      localStorage.setItem('psych_token_persistent', 'e30.' + btoa(JSON.stringify({ username: '__other_account', role: 'user' })) + '.test');
      location.hash = '#/personal/me/chat';
    });
    await page.waitForURL('**/#/personal/me/chat');
    await page.getByText('这是生成到一半的回复，切页后继续生成完成。', { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByText('这是生成到一半的回复，切页后继续生成完成。', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('psych_chat:v1:__other_account')?.includes('切页后继续生成完成') ?? false), false, '后台重绘不得把旧聊天写入新账号');
    await page.evaluate(() => {
      localStorage.setItem('psych_token_persistent', 'e30.' + btoa(JSON.stringify({ username: '__admin_retention', role: 'admin' })) + '.test');
      location.hash = '#/admin/review';
    });
    const reviewNote = page.getByPlaceholder('审核意见（可选）');
    await reviewNote.fill('管理端还没有提交的审核意见');
    await go('/admin/settings');
    await page.getByPlaceholder('您的姓名').fill('管理员信息草稿');
    await go('/admin/review');
    assert.equal(await reviewNote.inputValue(), '管理端还没有提交的审核意见');
    await go('/admin/settings');
    assert.equal(await page.getByPlaceholder('您的姓名').inputValue(), '管理员信息草稿');
    assert.deepEqual(errors, []);
    assert.ok(hasChat);
    console.log('PASS: personal/admin drafts, first-run flow, screening tabs/results, background RAG, durable chat continuation, no duplicates, account isolation');
  } catch (error) {
    console.error('Page diagnostics:', page.url(), errors, (await page.locator('body').innerText()).slice(0, 2400));
    throw error;
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
