// Local UI integration test. All APIs are fixtures; no real accounts or push sends.
// Run with WEEKDAY_PLAYWRIGHT_PATH and optionally WEEKDAY_BROWSER_EXECUTABLE.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeSnoozePlan } from '../scripts/utils/snooze.js';
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  let snapshot = { ...structuredClone(DEFAULT_STATE), reminders: [reminder('r1', '测试事项一'), reminder('r2', '测试事项二')] };
  let rule = null, posts = [], failSnooze = false, clockNow = new Date('2026-09-28T12:00:00+08:00');
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
    else if (url.pathname === '/api/push/snooze') {
      if (failSnooze) { status = 503; payload = {error:'模拟补提醒保存失败'}; }
      else if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); posts.push(body);
        if (body.action === 'stop') rule = null;
        else { try { rule = makeSnoozePlan(body, clockNow); } catch(e) { status=400;payload={error:e.message}; } }
      } else payload={rule};
    }
    else if (url.pathname === '/api/account/sync') {
      if (route.request().method() === 'PUT') {
        if (failSave) { status = 503; payload = { error: '模拟保存失败' }; }
        else if (conflict) { status = 409; payload = { conflict: true, revision: revision + 1, snapshot }; }
        else { snapshot = route.request().postDataJSON().snapshot; if(snapshot.reminders.some(r=>r.completed)) rule=null; revision++; payload = { revision }; }
      } else if (failLoad) { status = 503; payload = { error: '模拟加载失败' }; }
      else payload = { snapshot, revision };
    } else { status = 503; payload = { error: '模拟环境未启用推送/天气' }; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  try {
    await run(page, {
      posts: () => posts, rule: () => rule, failSnooze: v => {failSnooze=v;}, clock: v => {clockNow=new Date(v);},
      snapshot: () => snapshot,
      failSave: value => { failSave = value; }, failLoad: value => { failLoad = value; }, conflict: value => { conflict = value; },
      replace: value => { snapshot = value; revision++; }
    });
    assert.deepEqual(errors, []);
    console.log(`PASS ${++count}: ${name}`);
  } finally { await context.close(); }
}
const open = async (page, id = 'r1') => { await page.goto(`${origin}/#reminder=${id}`); await page.locator('#reminderDetail[open]').waitFor(); };
const text = (page, selector) => page.locator(selector).textContent();
try {
 browser = await chromium.launch({headless:true, ...(process.env.WEEKDAY_BROWSER_EXECUTABLE ? {executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE} : {})});
 await scenario('collapsed panel and no default loop/action focus; 10/30/60 and custom single reminders', async(page,api)=>{
  await page.clock.install({time:new Date('2026-09-28T12:00:00+08:00')});await open(page);
  await page.getByText('尚未设置稍后提醒',{exact:true}).waitFor();
  assert.equal(api.posts().length,0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'reminderDetailTitle');
  assert.equal(await page.locator('#snoozePanel details').getAttribute('open'),null);
  await page.screenshot({path:'/tmp/rem002-snooze-collapsed.png',animations:'disabled'});
  await page.locator('#snoozePanel summary').click();
  assert.equal(await page.inputValue('#snoozeUntil'),'2026-09-28T22:00');
  const original=api.snapshot().reminders[0].date;
  for(const minutes of [10,30,60]){
   await page.click(`[data-snooze="${minutes}"]`);
   await page.getByText(/稍后提醒：/).waitFor();
   assert.equal(api.posts().at(-1).minutes,minutes);
  }
  await page.fill('#snoozeAt','2026-09-29T00:15');await page.click('[data-snooze="custom"]');
  await page.getByText('稍后提醒：2026-09-29 00:15',{exact:true}).waitFor();
  assert.equal(api.snapshot().reminders[0].date,original);
  assert.equal(await page.locator('#reminderDetail').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:'/tmp/rem002-snooze-expanded.png',fullPage:true,animations:'disabled'});
 });
 await scenario('explicit hourly loop, stop and completed item hides panel',async(page,api)=>{
  await page.clock.install({time:new Date('2026-09-28T12:00:00+08:00')});await open(page);
  await page.getByText('尚未设置稍后提醒',{exact:true}).waitFor();await page.locator('#snoozePanel summary').click();
  await page.click('[data-snooze="hourly"]');await page.getByText(/每小时提醒 · 下次/).waitFor();
  assert.equal(api.rule().mode,'hourly');
  await page.click('#snoozeStop');await page.getByText('尚未设置稍后提醒',{exact:true}).waitFor();assert.equal(api.rule(),null);
  await page.click('[data-snooze="hourly"]');await page.getByText(/每小时提醒 · 下次/).waitFor();
  await page.click('#reminderDetailComplete'); if (await page.locator('#occurrenceDialog').isVisible()) await page.click('#occurrenceSubmit');await page.getByText('事项已完成并同步。',{exact:true}).waitFor();
  assert.equal(await page.locator('#snoozePanel').isVisible(),false);assert.equal(api.rule(),null);
 });
 await scenario('after 22:00 no prefilled loop cutoff; require explicit future cutoff',async(page,api)=>{
  api.clock('2026-09-28T22:15:00+08:00');await page.clock.install({time:new Date('2026-09-28T22:15:00+08:00')});await open(page);
  await page.getByText('尚未设置稍后提醒',{exact:true}).waitFor();await page.locator('#snoozePanel summary').click();
  assert.equal(await page.inputValue('#snoozeUntil'),'');await page.click('[data-snooze="hourly"]');
  await page.getByText(/未保存：截止时间须晚于/).waitFor();assert.equal(api.rule(),null);
  await page.fill('#snoozeUntil','2026-09-29T01:00');await page.click('[data-snooze="hourly"]');
  await page.getByText(/每小时提醒 · 下次/).waitFor();assert.equal(api.rule().untilAt,'2026-09-28T17:00:00.000Z');
 });
 await scenario('save failure remains honest and retry works',async(page,api)=>{
  await open(page);await page.getByText('尚未设置稍后提醒',{exact:true}).waitFor();await page.locator('#snoozePanel summary').click();
  api.failSnooze(true);await page.click('[data-snooze="10"]');await page.getByText(/未保存：模拟补提醒保存失败/).waitFor();
  assert.equal(api.rule(),null);api.failSnooze(false);await page.click('[data-snooze="10"]');await page.getByText(/稍后提醒：/).waitFor();
 });
 await scenario('due items highlighted on home and list without hiding future items',async(page,api)=>{
  const snap=api.snapshot();snap.reminders[0].date='2026-09-28';snap.reminders[0].hour=11;api.replace(snap);
  await page.clock.install({time:new Date('2026-09-28T12:00:00+08:00')});await page.goto(origin);
  await page.locator('#overviewReminderList .reminder-item--due').waitFor();
  assert.match(await text(page,'#overviewReminderList'),/到点未完成/);
  assert.equal(await page.locator('#overviewReminderList .reminder-item--due').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  await page.screenshot({path:'/tmp/rem002-due-home.png',animations:'disabled'});
  await page.click('[data-tab-button][data-switch-view="reminders"]');
  await page.locator('#reminderList .reminder-item--due').waitFor();
  assert.equal(await page.locator('#reminderList .reminder-item').count(),2);
 });
 await scenario('new record defaults, save and reopen snooze and category survive together',async(page,api)=>{
  await page.clock.install({time:new Date('2026-09-28T12:00:00+08:00')});await page.goto(origin);
  await page.locator('[data-switch-view="compose"]').first().click();
  assert.equal(await page.inputValue('#reminderCategoryInput'),'带东西');
  assert.equal(await page.inputValue('#reminderHourSelect'),'13');
  await page.fill('#reminderTitleInput','新建补提醒验收');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/account/sync')&&r.request().method()==='PUT');
  await page.click('#reminderSubmitButton');await saved;
  const item=api.snapshot().reminders.find(r=>r.title==='新建补提醒验收');
  assert.equal(item.category,'带东西');assert.equal(item.hour,13);
  await page.goto(`${origin}/#reminder=${item.id}`);await page.locator('#reminderDetail[open]').waitFor();
  await page.getByText('尚未设置稍后提醒',{exact:true}).waitFor();await page.locator('#snoozePanel summary').click();
  assert.equal(await page.inputValue('#snoozeUntil'),'2026-09-28T22:00');
  await page.click('[data-snooze="hourly"]');await page.getByText(/每小时提醒 · 下次/).waitFor();
  await page.click('#reminderDetailClose');await page.goto(`${origin}/#reminder=${item.id}`);
  await page.getByText(/每小时提醒 · 下次/).waitFor();
  assert.equal(api.snapshot().reminders.find(r=>r.id===item.id).date,item.date);
  await page.click('#reminderDetailEdit');assert.equal(await page.inputValue('#reminderCategoryInput'),'带东西');assert.equal(await page.inputValue('#reminderHourSelect'),'13');
 });
 console.log(`${count} snooze browser scenarios passed; fixtures only.`);
} finally {await browser?.close();server.close();}
