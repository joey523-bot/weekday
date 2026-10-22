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
const reminder = (id, title) => ({ id, title, date: '2026-10-03', category: '其他', notes: '本地模拟备注', leadDays: 0, hour: 9, notificationEnabled: true, completed: false, completedAt: '', createdAt: '2026-09-28T00:00:00Z' });
async function scenario(name, run, { loggedIn = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'allow' });
  let snapshot = { ...structuredClone(DEFAULT_STATE), reminders: [reminder('r1', '测试事项一'), reminder('r2', '测试事项二')] };
  let revision = 1, failSave = false, failLoad = false, conflict = false, incompleteLoad = false;
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
      else payload = incompleteLoad ? {} : { snapshot, revision };
    } else { status = 503; payload = { error: '模拟环境未启用推送/天气' }; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  try {
    await run(page, {
      snapshot: () => snapshot, incompleteLoad: value => { incompleteLoad = value; },
      failSave: value => { failSave = value; }, failLoad: value => { failLoad = value; }, conflict: value => { conflict = value; },
      replace: value => { snapshot = value; revision++; }
    });
    assert.deepEqual(errors, []);
    console.log(`PASS ${++count}: ${name}`);
  } finally { await context.close(); }
}
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 const board=async page=>{await page.goto(origin);await page.locator('[data-switch-view="reminders"]').first().click();};
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
 await scenario('list completion default, cancel, past date, reload and restore',async(page,api)=>{
  await board(page);const complete=()=>page.locator('#reminderList [data-action="complete"][data-id="r1"]').click();
  await complete();assert.equal(await page.inputValue('#occurrenceDate'),today());
  await page.click('#occurrenceCancel');assert.equal(api.snapshot().reminders[0].completed,false);
  await complete();await page.fill('#occurrenceDate','2099-01-01');await page.click('#occurrenceSubmit');
  assert.equal(await page.locator('#occurrenceDialog').isVisible(),true);assert.equal(api.snapshot().reminders[0].completed,false);
  await page.fill('#occurrenceDate','2026-07-20');await page.screenshot({path:'/tmp/rem004-date-confirm.png'});await page.click('#occurrenceSubmit');
  await page.waitForTimeout(1200);assert.equal(api.snapshot().reminders[0].occurredOn,'2026-07-20');
  await page.reload();await page.locator('[data-switch-view="reminders"]').first().click();await page.click('[data-filter="completed"]');
  assert.match(await page.locator('#reminderList').innerText(),/实际发生于/);
  assert.equal(api.snapshot().reminders[0].date,'2026-10-03');
  await page.locator('#reminderList [data-action="restore"][data-id="r1"]').click();await page.waitForTimeout(1200);
  assert.equal(api.snapshot().reminders[0].completed,false);assert.equal(api.snapshot().reminders[0].occurredOn,'');
 });
 await scenario('legacy backfill and correction preserve click time; second device loads confirmed date',async(page,api)=>{
  const saved=api.snapshot();saved.reminders[0].completed=true;saved.reminders[0].completedAt='2026-07-29T12:00:00Z';api.replace(saved);
  await board(page);await page.click('[data-filter="completed"]');assert.match(await page.locator('#reminderList').innerText(),/实际发生日期未确认/);
  await page.locator('[data-action="occurrence"][data-id="r1"]').click();await page.fill('#occurrenceDate','2026-07-22');await page.click('#occurrenceSubmit');
  await page.getByText('实际发生日期已保存。',{exact:true}).waitFor();assert.equal(api.snapshot().reminders[0].completedAt,'2026-07-29T12:00:00Z');
  await page.evaluate(()=>{location.hash='reminder=r1';});await page.locator('#reminderDetail[open]').waitFor();
  assert.match(await page.locator('#reminderDetailOccurrence').innerText(),/2026年7月22日/);
  await page.click('#reminderDetailOccurrenceEdit');await page.fill('#occurrenceDate','2026-07-21');await page.click('#occurrenceSubmit');
  await page.locator('#reminderDetailState').filter({hasText:'实际发生日期已保存。'}).waitFor();
  const second=await page.context().newPage();await second.goto(origin+'/#reminder=r1');await second.locator('#reminderDetail[open]').waitFor();
  assert.match(await second.locator('#reminderDetailOccurrence').innerText(),/2026年7月21日/);await second.close();
 });
 await scenario('detail completion requires confirmation; Escape is non-mutating',async(page,api)=>{
  await page.goto(origin+'/#reminder=r1');await page.locator('#reminderDetail[open]').waitFor();
  await page.click('#reminderDetailComplete');await page.keyboard.press('Escape');assert.equal(api.snapshot().reminders[0].completed,false);
  await page.click('#reminderDetailComplete');await page.fill('#occurrenceDate','2026-07-23');await page.click('#occurrenceSubmit');
  await page.waitForFunction(()=>!document.querySelector('#reminderDetail').open);assert.equal(api.snapshot().reminders[0].occurredOn,'2026-07-23');
  assert.equal(await page.locator('#snoozePanel').isVisible(),false);
 });
 await scenario('failed completion sync keeps detail open and retry closes it',async(page,api)=>{
  await page.goto(origin+'/#reminder=r1');await page.locator('#reminderDetail[open]').waitFor();
  api.failSave(true);await page.click('#reminderDetailComplete');await page.click('#occurrenceSubmit');
  await page.locator('#reminderDetailState').filter({hasText:'本次操作尚未同步'}).waitFor();
  assert.equal(await page.locator('#reminderDetail').isVisible(),true);
  api.failSave(false);await page.click('#reminderDetailComplete');
  await page.waitForFunction(()=>!document.querySelector('#reminderDetail').open);
  assert.equal(api.snapshot().reminders[0].completed,true);
 });
 await scenario('incomplete detail response preserves existing reminders',async(page,api)=>{
  await board(page);api.incompleteLoad(true);
  await page.locator('#reminderList [data-reminder-detail="r1"] .reminder-item__body').click();
  await page.locator('#reminderBoardState').filter({hasText:'账号同步响应不完整'}).waitFor();
  assert.match(await page.locator('#reminderList').innerText(),/测试事项一/);
  assert.equal(api.snapshot().reminders.length,2);
  api.incompleteLoad(false);
  await page.locator('#reminderList [data-reminder-detail="r1"] .reminder-item__body').click();
  await page.locator('#reminderDetail[open]').waitFor();
 });
 console.log(`Passed ${count} occurrence scenarios`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
