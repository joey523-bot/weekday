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
 browser = await chromium.launch({headless:true, executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 const start = async (page, api, reminders) => {
   api.replace({...structuredClone(DEFAULT_STATE),reminders});
   await page.goto(origin); await page.locator('[data-switch-view="compose"]').first().click();
 };
 const rows = ['甲','乙','丙','丁','戊','己'].map((title,i)=>({...reminder(String(i),title),createdAt:`2026-09-${10+i}T00:00:00Z`}));
 rows.push({...reminder('repeat','甲'),createdAt:'2026-09-01T00:00:00Z'});
 await scenario('five ranked choices; click fills text only, never saves', async(page,api)=>{
   await start(page,api,rows);
   assert.deepEqual(await page.locator('#reminderSuggestions button').allTextContents(),['甲','己','戊','丁','丙']);
   assert.equal(await page.inputValue('#reminderTitleInput'),'');
   await page.screenshot({path:'/tmp/rem003-suggestions.png'});
   await page.fill('#reminderDateInput','2026-10-03'); await page.selectOption('#reminderHourSelect','6');
   await page.getByRole('option',{name:'己',exact:true}).click();
   assert.equal(await page.inputValue('#reminderTitleInput'),'己');
   assert.equal(await page.inputValue('#reminderDateInput'),'2026-10-03');
   assert.equal(await page.inputValue('#reminderHourSelect'),'6'); assert.equal(api.snapshot().reminders.length,7);
 });
 await scenario('Enter accepts highlighted; arrows, Escape and IME are safe',async(page,api)=>{
   await start(page,api,rows); await page.focus('#reminderTitleInput');
   await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
   assert.equal(await page.inputValue('#reminderTitleInput'),'己'); assert.equal(api.snapshot().reminders.length,7);
   await page.fill('#reminderTitleInput','');
   await page.locator('#reminderTitleInput').dispatchEvent('keydown',{key:'Enter',isComposing:true});
   assert.equal(await page.inputValue('#reminderTitleInput'),'');
   await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
   assert.equal(await page.inputValue('#reminderTitleInput'),'');
 });
 await scenario('no history allows handwritten save and explicit example',async(page,api)=>{
   await start(page,api,[]); assert.equal(await page.locator('#reminderSuggestions').isVisible(),false);
   assert.match(await page.getAttribute('#reminderTitleInput','placeholder'),/^例如：/);
   await page.fill('#reminderTitleInput','全新事项'); await page.fill('#reminderDateInput','2026-10-03');
   const saved=page.waitForResponse(r=>r.url().endsWith('/api/account/sync')&&r.request().method()==='PUT');
   await page.click('#reminderSubmitButton'); await saved;
   assert.equal(api.snapshot().reminders[0].title,'全新事项');
 });
 await scenario('current account history excludes stale local account',async(page,api)=>{
   await page.addInitScript(state=>localStorage.setItem('yoyuan-ledger:v2',JSON.stringify(state)),{...structuredClone(DEFAULT_STATE),reminders:[reminder('old','旧账号秘密')]});
   await start(page,api,[reminder('new','当前账号')]);
   assert.deepEqual(await page.locator('#reminderSuggestions button').allTextContents(),['当前账号']);
 });
 await scenario('failed history load exposes no stale suggestions',async(page,api)=>{
   await page.addInitScript(state=>localStorage.setItem('yoyuan-ledger:v2',JSON.stringify(state)),{...structuredClone(DEFAULT_STATE),reminders:[reminder('old','旧账号秘密')]});
   api.failLoad(true); await start(page,api,[]);
   assert.equal(await page.locator('#reminderSuggestions').isVisible(),false);
 });
 await scenario('notification entry also supplies verified account suggestions',async(page,api)=>{
   api.replace({...structuredClone(DEFAULT_STATE),reminders:[reminder('r1','通知事项')]});
   await page.goto(`${origin}/#reminder=r1`); await page.locator('#reminderDetail[open]').waitFor();
   await page.click('#reminderDetailClose'); await page.locator('[data-switch-view="compose"]').first().click();
   assert.deepEqual(await page.locator('#reminderSuggestions button').allTextContents(),['通知事项']);
 });
 await scenario('accept suggestion retains REM005 next-day date and manual time',async(page,api)=>{
   await page.clock.install({time:new Date('2026-12-31T23:00:00+08:00')});
   await start(page,api,rows); await page.fill('#reminderDateInput','2026-12-31');
   await page.getByRole('option',{name:'甲',exact:true}).click();
   assert.equal(await page.inputValue('#reminderDateInput'),'2027-01-01');
   assert.equal(await page.inputValue('#reminderHourSelect'),'0');
   await page.selectOption('#reminderHourSelect','7'); await page.fill('#reminderTitleInput','');
   await page.keyboard.press('Enter');
   assert.equal(await page.inputValue('#reminderHourSelect'),'7');
   assert.equal(await page.inputValue('#reminderDateInput'),'2027-01-01');
 });
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
