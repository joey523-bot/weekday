// Local UI integration test. All APIs are fixtures; no real accounts or push sends.
// Run with WEEKDAY_PLAYWRIGHT_PATH and optionally WEEKDAY_BROWSER_EXECUTABLE.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STATE } from '../scripts/config.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WEEKDAY_PLAYWRIGHT_PATH || 'playwright');
const root = process.env.WEEKDAY_TEST_ROOT || resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let count = 0;
const reminder = (id, title) => ({ id, title, date: '2026-10-03', category: '其他', notes: '本地模拟备注', leadDays: 0, hour: 9, notificationEnabled: false, completed: false, completedAt: '', createdAt: '2026-09-28T00:00:00Z' });
async function scenario(name, run, { loggedIn = true, timezoneId = 'Asia/Shanghai', fixedNow = null, advancingClock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId, serviceWorkers: 'allow' });
  let snapshot = { ...structuredClone(DEFAULT_STATE), reminders: [reminder('r1', '测试事项一'), reminder('r2', '测试事项二')] };
  let revision = 1, failSave = false, failLoad = false, conflict = false;
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let status = 200, payload = {};
    if (url.pathname === '/api/auth/session') { status = loggedIn ? 200 : 401; payload = { user: { id: 'fixture-user', phone: '10000000000' } }; }
    else if (url.pathname === '/api/auth/identify') payload = { exists: true };
    else if (url.pathname === '/api/auth/login') { loggedIn = true; payload = { user: { id: 'fixture-user', phone: '10000000000' } }; }
    else if (url.pathname === '/api/account/sync') {
      if (route.request().method() === 'PUT') {
        if (failSave) { status = 503; payload = { error: '模拟保存失败' }; }
        else if (conflict) { status = 409; payload = { conflict: true, revision: revision + 1, snapshot }; }
        else { snapshot = route.request().postDataJSON().snapshot; revision++; payload = { revision }; }
      } else if (failLoad) { status = 503; payload = { error: '模拟加载失败' }; }
      else payload = { snapshot, revision };
    } else { status = 503; payload = { error: '模拟环境未启用推送/天气' }; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  if (fixedNow) { if (advancingClock) await page.clock.install({time:new Date(fixedNow)}); else await page.clock.setFixedTime(new Date(fixedNow)); }
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  try {
    await run(page, {
      snapshot: () => snapshot,
      failSave: value => { failSave = value; }, failLoad: value => { failLoad = value; }, conflict: value => { conflict = value; },
      replace: value => { snapshot = value; revision++; }
    });
    assert.deepEqual(errors, []);
    console.log(`PASS ${++count}: ${name}`);
  } finally { await context.close(); }
}
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 await scenario('repeated controller changes keep page, draft and stored data',async(page)=>{
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.goto(origin);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForTimeout(800);
  await page.locator('[data-switch-view="compose"]').first().click();
  await page.fill('#reminderTitleInput','尚未保存的内容');
  const before=await page.evaluate(()=>JSON.stringify(localStorage));
  for(let i=0;i<5;i++) {await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));await page.waitForTimeout(200);}
  assert.equal(navigations,2,'controller changes must never reload');
  assert.equal(await page.inputValue('#reminderTitleInput'),'尚未保存的内容');
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),before);
  assert(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)));
 });
 await scenario('explicit resource refresh remains usable and keeps account data',async(page)=>{
  await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.locator('[data-switch-view="settings"]').first().click();
  await page.click('[data-open-dialog="settingsHelp"]');
  const button=page.locator('#clearAppCacheButton');await button.waitFor();
  await Promise.all([page.waitForURL('**/?refresh=*'),button.click()]);
  await page.locator('[data-switch-view="reminders"]').first().click();
  assert.match(await page.locator('#reminderList').innerText(),/测试事项一/);
  assert(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)));
 });
 console.log(`Passed ${count} update stability scenarios`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
