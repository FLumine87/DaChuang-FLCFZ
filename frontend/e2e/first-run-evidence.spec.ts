import { expect, test, type Page } from '@playwright/test';

function graphReport() {
  return {
    user_id: 'first-run-audit', risk_level: 'unknown', risk_label: '图谱参考，待标准筛查',
    reference_only: true, source: 'knowledge_graph', overall_score: 2,
    crisis: false, factors: ['图谱线索'], summary: '本次为图谱参考，不决定本人风险。',
    matched_disorders: [{ name: '图谱独立参考', matched_symptoms: ['睡眠困难'], matched_triggers: [], score: 2, coverage: 0.5 }],
    recommendations: [], disclaimer: '参考结果', alert_created: false, created_at: '2026-11-06T10:00:00',
  };
}

async function mockServices(page: Page, failSync = false) {
  const graphCalls: string[] = [];
  let searches = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/health') {
      await route.fulfill({ json: { status: 'ok', mock_mode: false, neo4j_connected: true } });
    } else if (path === '/api/v1/kg/scale') {
      graphCalls.push('scale');
      if (failSync) await route.fulfill({ status: 503, json: { detail: '量表同步失败' } });
      else await route.fulfill({ json: { written: 1, neo4j_connected: true, inference_triggered: false } });
    } else if (path === '/api/v1/kg/extract') {
      graphCalls.push('extract');
      await route.fulfill({ json: { triples: [{ subject: '本人', relation: 'SHOWS_SYMPTOM', object: '睡眠困难' }], written: 1, neo4j_connected: true } });
    } else if (path === '/api/v1/inference/run') {
      graphCalls.push('inference');
      await route.fulfill({ json: { report: graphReport(), content_feed: [] } });
    } else if (path === '/api/personal/search') {
      searches++;
      await route.fulfill({ json: { code: 0, data: { results: [{ id: 'HASH-UI-1', summary: '真实哈希接口返回的参考', similarity: 0.79, modality: 'text', tags: ['睡眠困难'], alertLevel: 'unknown', date: '2026-11-06' }], query: '最近睡不好', report: null } } });
    } else {
      await route.fulfill({ json: { code: 0, data: [] } });
    }
  });
  return { graphCalls, searches: () => searches };
}

async function seedUser(page: Page, recordId?: string) {
  const token = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ username: 'first-run-audit', role: 'user', exp: 9999999999 })).toString('base64url')}.sig`;
  await page.addInitScript(({ token, recordId }) => {
    localStorage.setItem('psych_token_persistent', token);
    localStorage.setItem('psych_first_run:v1:first-run-audit', JSON.stringify({ status: 'done', guideSeen: true }));
    if (recordId) sessionStorage.setItem('psych_first_run:draft', JSON.stringify({ scaleId: 'PHQ-9', recordId, score: 5, maxScore: 27, level: 'yellow' }));
  }, { token, recordId });
}

test('首次结果分别展示哈希与图谱来源，并在同步和抽取完成后推理', async ({ page }) => {
  const token = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ username: 'first-run-audit', role: 'user', exp: 9999999999 })).toString('base64url')}.sig`;
  await page.addInitScript(value => {
    localStorage.setItem('psych_token_persistent', value);
    localStorage.setItem('psych_first_run:v1:first-run-audit', JSON.stringify({ status: 'done', guideSeen: true }));
    sessionStorage.setItem('psych_first_run:draft', JSON.stringify({
      scaleId: 'PHQ-9', recordId: 'SCR-FIRST-1', score: 5, maxScore: 27, level: 'yellow',
      questionnaireVersion: '2026-11-standard-v1', answers: { '9': 0 },
      supplement: { kind: 'text', text: '最近睡不好，影响上课' },
    }));
  }, token);
  const calls = await mockServices(page);
  await page.goto('/#/personal/first/result');
  const hashSection = page.getByRole('heading', { name: '动态跨模态哈希检索', exact: true }).locator('xpath=ancestor::section[1]');
  await expect(hashSection.getByText('参考 HASH-UI-1', { exact: true })).toBeVisible();
  await expect(hashSection.getByText('图谱独立参考')).toHaveCount(0);
  const graphSection = page.getByRole('heading', { name: '图谱参考与解释', exact: true }).locator('xpath=ancestor::section[1]');
  await expect(graphSection.getByText(/图谱独立参考/)).toBeVisible();
  expect(calls.graphCalls).toEqual(['scale', 'extract', 'inference']);
  expect(calls.searches()).toBe(1);
});

test('本次量表同步失败时不读取旧图谱生成报告，哈希仍可独立返回', async ({ page }) => {
  const calls = await mockServices(page, true);
  await page.goto('/#/login');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/services/firstRunRetrieval.ts';
    const { loadFirstRunEvidence } = await import(modulePath);
    return loadFirstRunEvidence('first-run-audit', '最近睡不好', { recordId: 'SCR-SYNC-FAIL', scaleId: 'PHQ-9', score: 5 });
  });
  expect(calls.graphCalls).toEqual(['scale', 'extract']);
  expect(result.inferenceOk).toBe(false);
  expect(result.scaleSyncError).toBeTruthy();
  expect(result.hashResults[0].id).toBe('HASH-UI-1');
});

test('保存补充中的模拟哈希结果如实标记演示，不受图谱连接状态影响', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#/login');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/services/firstRunRetrieval.ts';
    const { loadFirstRunEvidence } = await import(modulePath);
    return loadFirstRunEvidence('first-run-audit', undefined, {
      recordId: 'SCR-MOCK-HASH',
      savedAnalysis: { index: { mode: 'mock', source: 'mock' }, hits: [{ id: 'MOCK-HASH-1', similarity: 0.7, summary: '模板候选' }] },
    });
  });
  expect(result.hashMode).toBe('mock');
  expect(result.mode).toBe('live');
  expect(result.hashResults[0].id).toBe('MOCK-HASH-1');
});

test('PSS-10以原始选项计分，四个正向题反向且无临床风险截断', async ({ page }) => {
  await page.goto('/#/login');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/data/questionnaireData.ts';
    const { calculateQuestionnaireScore, questionnaires, QUESTIONNAIRE_VERSION } = await import(modulePath);
    const positive = new Set([4, 5, 7, 8]);
    const low = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), positive.has(i + 1) ? 4 : 0]));
    const high = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), positive.has(i + 1) ? 0 : 4]));
    const pss = questionnaires.find((item: { id: string }) => item.id === 'PSS-10');
    return {
      low: calculateQuestionnaireScore('PSS-10', low), high: calculateQuestionnaireScore('PSS-10', high),
      version: QUESTIONNAIRE_VERSION, bands: pss.introduction.scoreBands,
      lowLevel: pss.scoring(0).level, highLevel: pss.scoring(40).level,
      rawOptionValues: pss.questions.map((q: { options: { value: number }[] }) => q.options.map(o => o.value)),
    };
  });
  expect(result.low).toBe(0);
  expect(result.high).toBe(40);
  expect(result.lowLevel).toBe('yellow');
  expect(result.highLevel).toBe('yellow');
  expect(result.bands).toHaveLength(1);
  expect(result.version).toBe('2026-11-standard-v1');
  expect(result.rawOptionValues.every((values: number[]) => values.join(',') === '0,1,2,3,4')).toBe(true);
});

test('首次补充完成保存后才进入结果页，不重复触发保存', async ({ page }) => {
  await seedUser(page, 'SCR-WAIT');
  await mockServices(page);
  let releaseSave: () => void = () => {};
  let saves = 0;
  const savePending = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route('**/api/personal/screenings/SCR-WAIT/supplement', async route => {
    saves++;
    await savePending;
    await route.fulfill({ json: { code: 0, data: { id: 88, report: { supplementId: 88, modality: 'text', level: 'unknown', levelLabel: '待补充', isAlert: false, reason: '', conclusion: '尚需补充本人信息', hits: [] } } } });
  });
  await page.goto('/#/personal/first/supplement');
  await page.locator('#supplement-text').fill('最近睡不好');
  await page.getByRole('button', { name: '提交补充并查看结果', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在保存补充…', exact: true })).toBeDisabled();
  expect(page.url()).toContain('/personal/first/supplement');
  releaseSave();
  await expect(page).toHaveURL(/\/personal\/first\/result/);
  await expect(page.getByText('本次复核建议：待补充', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看本次参考用途与下一步', exact: true })).toHaveAttribute('href', /assessmentSupplementId=88/);
  expect(saves).toBe(1);
});

test('从检索推荐完成量表后，携同一补充记录返回本次评估', async ({ page }) => {
  await seedUser(page);
  await mockServices(page);
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/personal/screenings', async route => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: { code: 0, data: [] } });
      return;
    }
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { code: 0, data: { id: 'SCR-NEW-77', status: 'success', riskLevel: 'green', score: 0, maxScore: 27 } } });
  });
  await page.goto('/#/personal/screening?tab=scale&paper=PHQ-9&assessmentSupplementId=41&assessmentQuery=sleep-query');
  const questions = [
    '做事时提不起劲或没有兴趣', '感到心情低落、沮丧或绝望', '入睡困难、睡不安稳或睡眠过多',
    '感觉疲倦或没有精力', '食欲不振或吃太多', '觉得自己很糟——或觉得自己很失败，或让自己或家人失望',
    '对事物专注困难，例如看报纸或看电视时', '行动或说话速度慢到让人注意到？或者刚好相反——坐立不安，动来动去',
    '有不如死掉或用某种方式伤害自己的念头',
  ];
  for (const question of questions) {
    await expect(page.getByText(question)).toBeVisible();
    await page.getByRole('button', { name: '完全不会', exact: true }).click();
  }
  await page.getByRole('button', { name: '提交并查看结果', exact: true }).click();
  await expect(page).toHaveURL(/\/personal\/retrieval\?/);
  const params = new URLSearchParams(page.url().split('?')[1]);
  expect(params.get('assessmentSupplementId')).toBe('41');
  expect(params.get('screeningId')).toBe('SCR-NEW-77');
  expect(params.get('q')).toBe('sleep-query');
  expect(submitted).toMatchObject({ questionnaire: 'PHQ-9', questionnaireVersion: '2026-11-standard-v1', answerEncoding: 'option-index' });
});
