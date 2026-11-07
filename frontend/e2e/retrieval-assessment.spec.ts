import { test, expect, type Page } from '@playwright/test';
import type { RetrievalAnalysisReport, RetrievalAssessment } from '../src/services/screeningAssessment';

const hint = '例如：最近入睡困难、白天无力、对课程提不起兴趣...';
const positive = '本次检索以积极情绪参考模式为主，暂未检出明显负性情绪匹配。';
const negative = '本次检索以负性情绪参考模式为主，提示需要关注情绪困扰线索。';
function assessment(kind = 'positive', token = 'snapshot-all', supplementId?: number): RetrievalAssessment {
  return { id: 'retrieval-result', analysisMode: 'retrieval', retrievalToken: token, supplementId,
    status: 'ready', level: kind === 'positive' ? 'green' : 'yellow', levelLabel: kind === 'positive' ? '积极情绪匹配' : '负性情绪线索 · 建议关注',
    conclusion: kind === 'positive' ? positive : negative,
    evidence: [{ id: 'sources', label: '采用的检索结果', value: '3个单元 / 2条来源记录', source: '本次实际命中，经来源去重' }],
    missingFields: [], questions: [], recommendedScales: [], nextAction: { type: 'finish', label: '保留本次初筛结果' },
    references: [{ id: 'unit-1', recordId: 'reference-1', modality: 'text', similarity: .85, usage: 'screening', matchedDimensions: [], reason: '用于形成初筛结论', questionIds: [] }],
    trace: [{ step: '筛选与去重', detail: '根据本次返回结果汇总', referenceIds: ['unit-1'] }],
    repeatedNegative: { days: [], count: 0, threshold: 3, windowDays: 14 }, safetyStatus: 'not_identified', ruleVersion: 'retrieval-v1', updatedAt: '2026-11-07' };
}

type RagResponse = { report: RetrievalAnalysisReport | null; mock: boolean };
async function setup(page: Page, history = false, ragResponse: (body: Record<string, unknown>) => Promise<RagResponse> = async () => ({ report: null, mock: true })) {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  await page.addInitScript((token) => localStorage.setItem('psych_token_persistent', token), `${b64({alg:'none'})}.${b64({username:'test',role:'user',exp:9999999999})}.sig`);
  const requests: {path: string; body: Record<string, unknown>}[] = [];
  let saved = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown> || {};
    requests.push({ path, body });
    let data: unknown = [];
    if (path === '/api/personal/search') {
      const kind = body.modality_filter === 'text' ? 'negative' : 'positive';
      const token = `snapshot-${body.modality_filter || 'all'}-${body.modality}`;
      data = { results: [{ id: 'unit-1', recordId:'reference-1', modality: body.modality || 'text', summary:'情绪参考模式', similarity:.85, tags:[], alertLevel:'unknown' }], assessment: assessment(kind, token), report: null };
    } else if (path === '/api/personal/supplements' && route.request().method() === 'POST') {
      saved++; data = { id:41, report:{ modality:'text', supplementId:41, assessment:assessment() } };
    } else if (path === '/api/personal/retrieval-screening') {
      const token = String(body.retrievalToken || 'snapshot-history');
      data = { assessment: assessment(token.includes('text-text') ? 'negative' : 'positive', token, body.supplementId as number | undefined) };
    } else if (path === '/api/personal/rag-report') data = await ragResponse(body);
    else if (path === '/api/personal/supplements' && history) data = [{ id:41,kind:'text',text:'开心',analysis:{level:'green',hits:[],assessment:assessment('positive','snapshot-history',41)}}];
    await route.fulfill({ json:{ code:0,data } });
  });
  await page.goto('/#/personal/retrieval');
  return { requests, saved:()=>saved };
}

test('检索结果直接形成置顶初筛结论，全程没有量表或追问入口', async ({page}) => {
  const calls = await setup(page);
  await page.getByPlaceholder(hint).fill('开心');
  await page.getByRole('button',{name:'开始检索'}).click();
  const card=page.getByTestId('retrieval-assessment');
  await expect(card.getByText(positive)).toBeVisible();
  await expect(card.getByTestId('retrieval-analysis')).toContainText('3个单元 / 2条来源记录');
  for (const name of ['1. 得出结论', '2. 参考依据', '3. 心理建议']) await expect(card.getByRole('heading', {name, exact:true})).toBeVisible();
  await expect(card.getByText('采用结果：unit-1')).toBeVisible();
  await expect(page.getByLabel('关联量表记录')).toHaveCount(0);
  await expect(page.getByText('可选扩展：量表自测')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'补充近况（可选）'})).toHaveCount(0);
  await expect.poll(()=>calls.saved()).toBe(1);
  expect(calls.requests.some(r=>r.path==='/api/personal/screenings')).toBe(false);
  await expect.poll(()=>calls.requests.some(r=>r.path==='/api/personal/rag-report' && r.body.analysisMode==='retrieval')).toBe(true);
  await expect(card.getByText('检索证据说明', {exact:true})).toBeVisible();
  await expect(card.getByRole('status')).toHaveCount(0);
  await expect(card.getByText(positive, {exact:true})).toHaveCount(1);
});

test('大模型生成状态及完成后的说明与建议都位于顶部筛查结论卡', async ({page}) => {
  const modelConclusion = '结合本次检索与本人描述，当前情绪呈积极倾向；仍应留意后续睡眠及生活状态的变化。';
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  await setup(page, false, async () => {
    await waiting;
    return {mock:false, report:{summary:modelConclusion, riskLevel:'积极情绪匹配', sections:[{title:'参考依据', content:'本次文本与语音参考呈积极倾向，图像仅作为匹配参考。'}], recommendations:['可记录后续情绪变化，便于比较不同时间的检索结果。']}};
  });
  try {
    await page.getByPlaceholder(hint).fill('开心');
    await page.getByRole('button',{name:'开始检索'}).click();
    const card = page.getByTestId('retrieval-assessment');
    await expect(card.getByRole('heading',{name:'多模态心理筛查结论',exact:true})).toBeVisible();
    await expect(card.getByText(positive,{exact:true})).toBeVisible();
    await expect(card.getByRole('status')).toContainText('大模型思考中');
    await expect(card.getByTestId('psychological-advice')).not.toContainText('保留本次初筛结果');
    await expect(card.getByText('本次文本与语音参考呈积极倾向，图像仅作为匹配参考。')).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'RAG 智能分析报告',exact:true})).toHaveCount(0);
    finish();
    await expect(card.getByText(modelConclusion,{exact:true})).toBeVisible();
    await expect(card.getByText('本次文本与语音参考呈积极倾向，图像仅作为匹配参考。')).toBeVisible();
    await expect(card.getByText('可记录后续情绪变化，便于比较不同时间的检索结果。')).toBeVisible();
    await expect(card.getByText('大模型综合分析',{exact:true})).toBeVisible();
    await expect(card.getByRole('status')).toHaveCount(0);
    await expect(card.getByText(positive,{exact:true})).not.toBeVisible();
  } finally { finish(); }
});

test('模型不可用时明确提示，心理建议不使用页面跳转文案且支持单独重试', async ({page}) => {
  let attempts = 0;
  const calls = await setup(page, false, async () => {
    attempts++;
    return attempts === 1
      ? {mock:true,report:{summary:positive,riskLevel:'low',sections:[{title:'参考依据',content:'采用本次检索单元。'}],recommendations:['查看专业复核建议']}}
      : {mock:false,report:{summary:'大模型重新生成的综合分析正文。',riskLevel:'low',sections:[{title:'参考依据',content:'依据本次已采用参考。'}],recommendations:['每天用几分钟记录情绪及睡眠变化。']}};
  });
  await page.getByPlaceholder(hint).fill('开心');
  await page.getByRole('button',{name:'开始检索'}).click();
  const card = page.getByTestId('retrieval-assessment');
  await expect(card.getByRole('alert')).toContainText('大模型分析未生成');
  await expect(card.getByTestId('psychological-advice')).toContainText('大模型尚未生成心理建议');
  await expect(card.getByTestId('psychological-advice')).not.toContainText('查看专业复核建议');
  await card.getByRole('button',{name:'重新生成报告',exact:true}).click();
  await expect(card.getByText('大模型重新生成的综合分析正文。',{exact:true})).toBeVisible();
  await expect(card.getByTestId('psychological-advice')).toContainText('每天用几分钟记录情绪及睡眠变化。');
  await expect(card.getByRole('alert')).toHaveCount(0);
  expect(calls.requests.filter(r=>r.path==='/api/personal/search')).toHaveLength(1);
  expect(calls.saved()).toBe(1);
});

test('再次检索后旧大模型报告不会覆盖当前结论卡', async ({page}) => {
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  let oldResponseReturned = false;
  await setup(page, false, async (body) => {
    const isNew = String(body.retrievalToken).includes('text-text');
    if (!isNew) { await waiting; oldResponseReturned = true; }
    return {mock:false,report:{summary:isNew ? negative : positive, riskLevel:'参考匹配',sections:[{title:'参考依据',content:isNew ? '当前文本检索的负性参考说明' : '过时的积极参考说明'}],recommendations:[]}};
  });
  try {
    await page.getByPlaceholder(hint).fill('开心');
    await page.getByRole('button',{name:'开始检索'}).click();
    const card = page.getByTestId('retrieval-assessment');
    await expect(card.getByRole('status')).toContainText('大模型思考中');
    await page.getByRole('button',{name:'仅文本',exact:true}).click();
    await expect(card.getByText('当前文本检索的负性参考说明')).toBeVisible();
    const oldResponse = page.waitForResponse(async response => response.url().includes('/api/personal/rag-report') && (await response.json()).data.report.summary === positive);
    finish();
    await oldResponse;
    expect(oldResponseReturned).toBe(true);
    await expect(card.getByText(negative,{exact:true})).toBeVisible();
    await expect(card.getByText('过时的积极参考说明')).toHaveCount(0);
  } finally { finish(); }
});

test('切换检索范围后，结论采用本次结果而非旧记录缓存', async ({page}) => {
  const calls=await setup(page);
  await page.getByPlaceholder(hint).fill('开心');
  await page.getByRole('button',{name:'开始检索'}).click();
  await expect(page.getByTestId('retrieval-assessment').getByText(positive)).toBeVisible();
  await page.getByRole('button',{name:'仅文本',exact:true}).click();
  await expect(page.getByTestId('retrieval-assessment').getByText(negative)).toBeVisible();
  expect(calls.requests.filter(r=>r.path==='/api/personal/retrieval-screening').at(-1)?.body.retrievalToken).toBe('snapshot-text-text');
  expect(calls.saved()).toBe(1);
});

test('只上传图片且不保存，也能基于同次检索结果生成结论', async ({page}) => {
  const calls=await setup(page);
  await page.getByRole('checkbox',{name:'送入检索数据',exact:true}).uncheck();
  await page.locator('input[type=file][accept^="image/"]').setInputFiles({name:'face.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2sAAAAASUVORK5CYII=','base64')});
  await page.getByRole('button',{name:'开始检索'}).click();
  await expect(page.getByTestId('retrieval-assessment').getByText(positive)).toBeVisible();
  expect(calls.saved()).toBe(0);
  await expect(page.getByTestId('retrieval-assessment').getByText('当前大模型不直接解读原始图片或语音，本次媒体线索依据检索结果分析。',{exact:true})).toBeVisible();
  expect(calls.requests.find(r=>r.path==='/api/personal/search')?.body.modality).toBe('image');
  expect(calls.requests.filter(r=>r.path==='/api/personal/retrieval-screening').at(-1)?.body.retrievalToken).toContain('image');
});

test('原始输入默认参与，关闭后只重新生成报告且过时的原文分析不再展示', async ({page}) => {
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  const withOriginal = '结合本人文字的旧综合结论';
  const withoutOriginal = '仅依据检索筛查结果形成的综合结论';
  const calls = await setup(page, false, async (body) => {
    const enabled = body.includeOriginalInput === true;
    if (enabled) await waiting;
    return {mock:false,report:{summary:enabled ? withOriginal : withoutOriginal,riskLevel:'积极情绪匹配',sections:[{title:'参考依据',content:'参考来自本次检索的已采用单元。'}],recommendations:['记录每日情绪变化。'],originalInput:{enabled,used:enabled,modality:'text',notice:enabled ? '已结合本次原始文字与检索筛查结果分析。' : '已关闭原始输入分析，仅依据检索筛查结果生成。'}}};
  });
  try {
    const toggle = page.getByRole('checkbox',{name:'结合本次原始输入分析',exact:true});
    await expect(toggle).toBeChecked();
    await page.getByPlaceholder(hint).fill('开心');
    await page.getByRole('button',{name:'开始检索'}).click();
    const card = page.getByTestId('retrieval-assessment');
    await expect(card.getByRole('status')).toContainText('大模型思考中');
    expect(calls.requests.find(r=>r.path==='/api/personal/rag-report')?.body).toMatchObject({includeOriginalInput:true,query:'开心'});
    await toggle.uncheck();
    await expect(card.getByText(withoutOriginal,{exact:true})).toBeVisible();
    await expect(card.getByText('已关闭原始输入分析，仅依据检索筛查结果生成。',{exact:true})).toBeVisible();
    expect(calls.requests.filter(r=>r.path==='/api/personal/rag-report').at(-1)?.body).toMatchObject({includeOriginalInput:false,query:''});
    expect(calls.requests.filter(r=>r.path==='/api/personal/search')).toHaveLength(1);
    expect(calls.saved()).toBe(1);
    const oldResponse = page.waitForResponse(async response => response.url().includes('/api/personal/rag-report') && (await response.json()).data.report.summary === withOriginal);
    finish(); await oldResponse;
    await expect(card.getByText(withoutOriginal,{exact:true})).toBeVisible();
    await expect(card.getByText(withOriginal,{exact:true})).toHaveCount(0);
    await card.getByText('查看检索到结论的依据链',{exact:true}).click();
    await expect(card.getByText(positive,{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('checkbox',{name:'结合本次原始输入分析',exact:true})).not.toBeChecked();
  } finally { finish(); }
});

test('历史记录恢复保存的检索证据，不读取旧量表', async ({page}) => {
  const calls=await setup(page,true);
  await page.getByRole('button',{name:/SUP-41.*我的检索记录/}).click();
  await expect(page.getByTestId('retrieval-assessment').getByText(positive)).toBeVisible();
  expect(calls.requests.some(r=>r.path==='/api/personal/search')).toBe(false);
  expect(calls.requests.some(r=>r.path==='/api/personal/screenings')).toBe(false);
  expect(calls.saved()).toBe(0);
});
