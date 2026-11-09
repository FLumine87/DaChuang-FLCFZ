/** 临时探针：量图谱页各区块高度与视口的关系，判断"要不要滚、滚多少" */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pwPath = require.resolve('playwright-core', { paths: [path.join(repoRoot, 'frontend')] });
const pwMod = await import(pathToFileURL(pwPath).href);
const chromium = (pwMod.default ?? pwMod).chromium;

const VP = { width: 1440, height: 900 };
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--disable-proxy-config'],
});
const page = await (await browser.newContext({ viewport: VP })).newPage();
await page.goto('http://localhost:5173/#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const inputs = page.locator('input');
await inputs.nth(0).fill('xiaoyu');
await inputs.nth(1).fill('123456');
await page.getByRole('button', { name: /登录|进入/ }).first().click();
await page.waitForTimeout(2500);
await page.goto('http://localhost:5173/#/personal/me/kg', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const m = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
  const card = svg?.parentElement;
  const root = document.querySelector('.page-body > div');
  const pick = (el) => (el ? { h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) } : null);
  const kids = root ? [...root.children].map((c) => ({ cls: c.className.slice(0, 46), ...pick(c) })) : [];
  return {
    viewport: { w: innerWidth, h: innerHeight },
    topbar: pick(document.querySelector('header')),
    appContentPad: getComputedStyle(document.querySelector('.app-content') ?? document.body).paddingTop,
    pageBodyH: Math.round((document.querySelector('.page-body')?.getBoundingClientRect().height ?? 0)),
    rootScrollH: root?.scrollHeight ?? 0,
    docScrollH: document.documentElement.scrollHeight,
    needScroll: document.documentElement.scrollHeight - innerHeight,
    svgBox: pick(svg),
    svgRatio: svg ? +(svg.getBoundingClientRect().width / svg.getBoundingClientRect().height).toFixed(3) : null,
    children: kids,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: 'personal-backend/scripts/_shots/lay_before.png', fullPage: true });
await browser.close();
