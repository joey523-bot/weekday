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
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const relative=n=>new Date(Date.parse(today)+n*86400000).toISOString().slice(0,10);
const sample=(title='周期测试')=>[-80,-60,-40,-20].map((n,i)=>({id:'c'+i,title,date:relative(n),completed:true,completedAt:relative(n)+'T08:00:00Z',occurredOn:relative(n),createdAt:relative(n)+'T07:00:00Z',category:'其他'}));
const setup=(api,rows=sample())=>{const snapshot=api.snapshot();snapshot.reminders=rows;api.replace(snapshot);};
const settings=async page=>{await page.locator('[data-switch-view="settings"]').first().click();await page.locator('#cycleSettings > summary').click();};
const saved=page=>page.waitForFunction(()=>document.querySelector('#cycleSettingsState').textContent==='周期建议设置已保存。');
const home=page=>page.locator('[data-switch-view="overview"]').first().click();
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 await scenario('explain, accept draft only, cancel, explicit save, deletion cannot resurrect suggestion',async(page,api)=>{
  setup(api);await page.goto(origin);await page.locator('#cycleSuggestions .cycle-card').waitFor();
  assert.match(await page.locator('#cycleSuggestions').innerText(),/4个发生日.*20天/);
  await page.locator('#cycleSuggestions summary').click();await page.locator('#cycleSuggestions').evaluate(el=>el.scrollIntoView({block:'start'}));await page.locator('#cycleSuggestions').screenshot({path:'/tmp/rem004-cycle-mobile.png'});
  assert.equal(await page.locator('#cycleSuggestions').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.click('[data-cycle-action="accept"]');assert.equal(api.snapshot().reminders.length,4);
  assert.equal(await page.inputValue('#reminderDateInput'),today);assert.equal(await page.isChecked('#reminderNotificationInput'),false);
  await home(page);assert.equal(await page.locator('#cycleSuggestions').isVisible(),true);
  await page.click('[data-cycle-action="accept"]');await page.locator('#reminderForm button[type="submit"]').click();
  await page.waitForTimeout(1200);assert.equal(api.snapshot().reminders.length,5);assert.equal(api.snapshot().preferences.cycle.handledTokens.length,4);
  assert.equal(api.snapshot().reminders.at(-1).notificationEnabled,false);
  const snapshot=api.snapshot();snapshot.reminders.pop();api.replace(snapshot);await page.reload();assert.equal(await page.locator('#cycleSuggestions').isVisible(),false);
 });
 await scenario('ignore persists across reload and simulated other page; new account snapshot is isolated',async(page,api)=>{
  setup(api);await page.goto(origin);await page.click('[data-cycle-action="ignore"]');await saved(page);assert.equal(api.snapshot().reminders.length,4);
  const second=await page.context().newPage();await second.goto(origin);assert.equal(await second.locator('#cycleSuggestions').isVisible(),false);await second.close();
  const snapshot=api.snapshot();delete snapshot.preferences.cycle;api.replace(snapshot);await page.reload();await page.locator('#cycleSuggestions .cycle-card').waitFor();
 });
 await scenario('explicit alias merge, disable/enable group, test exclusion and clear preserve original records',async(page,api)=>{
  const rows=sample();rows[2].title='另一个名字';rows[3].title='另一个名字';setup(api,rows);await page.goto(origin);
  assert.equal(await page.locator('#cycleSuggestions').isVisible(),false);await settings(page);
  await page.selectOption('#cycleFirst','周期测试');await page.selectOption('#cycleSecond','另一个名字');await page.click('[data-cycle-setting="merge"]');await saved(page);
  await home(page);await page.locator('#cycleSuggestions .cycle-card').waitFor();await page.click('[data-cycle-action="disable"]');await saved(page);
  await page.locator('[data-switch-view="settings"]').first().click();await page.locator('[data-cycle-setting="toggle"]').click();await saved(page);
  await page.locator('#cycleControls details summary').click();await page.locator('[data-cycle-exclude="c0"]').check();await saved(page);
  await home(page);assert.equal(await page.locator('#cycleSuggestions').isVisible(),false);
  await page.locator('[data-switch-view="settings"]').first().click();await page.locator('#cycleControls details summary').click();await page.locator('[data-cycle-exclude="c0"]').uncheck();await saved(page);
  page.once('dialog',d=>d.accept());await page.click('[data-cycle-setting="clear"]');await saved(page);
  assert.equal(api.snapshot().reminders.length,4);assert.equal(api.snapshot().preferences.cycle.clearedIds.length,4);assert.equal(api.snapshot().preferences.cycle.groups.length,0);
  await page.reload();assert.equal(await page.locator('#cycleSuggestions').isVisible(),false);
 });
 await scenario('global off syncs; save failure is honest and no production notification API is used',async(page,api)=>{
  setup(api);await page.goto(origin);await settings(page);await page.uncheck('#cycleEnabled');await saved(page);
  await page.reload();assert.equal(await page.locator('#cycleSuggestions').isVisible(),false);await page.locator('[data-switch-view="settings"]').first().click();assert.equal(await page.isChecked('#cycleEnabled'),false);
  api.failSave(true);await page.check('#cycleEnabled');await page.getByText(/尚未同步，请联网后重试/).waitFor();assert.equal(api.snapshot().preferences.cycle.enabled,false);
 });
 await scenario('insufficient, unstable, pending and expired histories are quiet',async(page,api)=>{
  for(const rows of [sample().slice(0,3),sample().map((r,i)=>i===2?{...r,occurredOn:relative(-30)}:r),[...sample(),{id:'todo',title:'周期测试',completed:false,date:today}],sample().map(r=>({...r,occurredOn:new Date(Date.parse(r.occurredOn)-3*86400000).toISOString().slice(0,10)}))]){
    setup(api,rows);await page.goto(origin);await page.locator('#todayLabel').waitFor();await page.waitForTimeout(200);assert.equal(await page.locator('#cycleSuggestions').isVisible(),false);
  }
 });
 console.log(`Passed ${count} cycle scenarios`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
