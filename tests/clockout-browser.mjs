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
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
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

 await scenario('clockout setup, persistence, compact home and calculation',async(page,fixture)=>{
  await page.goto(origin);
  await page.locator('[data-switch-view="settings"]').first().click();
  await page.locator('[data-open-dialog="clockoutSettings"]').click();
  assert.equal(await page.locator('[name="w0-start"]').inputValue(),'09:00');
  assert.equal(await page.locator('[name="w0-end"]').inputValue(),'18:00');
  await page.locator('[name="enabled"]').check();
  await page.locator('#clockoutSettings button[type=submit]').click();
  await page.locator('#clockoutSettings [data-clock-feedback]').filter({hasText:'已保存并同步'}).waitFor();
  await page.locator('#clockoutSettings [data-close-dialog]').click();
  await page.reload();
  await page.locator('#homeClockout').waitFor();
  assert.match(await page.locator('#homeClockout').innerText(),/还未记录/);
  assert.equal(await page.locator('#homeMoon').count(),1);
  assert.equal(await page.evaluate(()=>document.querySelector('.salary-snapshot').nextElementSibling.id),'homeClockout');
  assert.equal(await page.evaluate(()=>document.querySelector('#homeClockout').nextElementSibling.id),'homeMoon');
  await page.locator('#homeClockout').click();
  await page.locator('[name=record]').fill('09:06');
  await page.locator('[data-clock-form=record] button[type=submit]').click();
  await page.locator('#clockoutDetail [data-clock-status]').filter({hasText:'已保存并同步'}).waitFor();
  await page.locator('#clockoutDetail [data-close-dialog]').click();
  assert.match(await page.locator('#homeClockout').innerText(),/2小时16分钟/);
  await page.reload();
  await page.locator('#homeClockout').filter({hasText:'2小时16分钟'}).waitFor();
  assert.equal(fixture.snapshot().preferences.clockout.records['2026-10-19'],'09:06');
  await page.locator('#homeClockout').click();
  await page.locator('#clockoutDetail details summary').click();
  await page.locator('[name="d-end"]').fill('19:00');
  await page.locator('[data-clock-form=date] button[type=submit]').click();
  await page.locator('#clockoutDetail [data-clock-status]').filter({hasText:'已保存并同步'}).waitFor();
  assert.match(await page.locator('#clockoutDetail').innerText(),/19:00可下班/);
  await page.locator('#clockoutDetail details summary').click();
  await page.locator('[data-clock-restore]').click();
  await page.locator('#clockoutDetail').filter({hasText:'18:06可下班'}).waitFor();
  await page.locator('#clockoutDetail [data-close-dialog]').click();
  await page.waitForTimeout(500);
  await page.screenshot({path:'/tmp/weekday-clockout-home.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:320,height:740});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 },{fixedNow:'2026-10-19T15:50:00+08:00'});
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
