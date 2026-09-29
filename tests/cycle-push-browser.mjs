import { cycleSuggestions } from '../scripts/utils/cycle.js';
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
    } else if (url.pathname === '/api/push/cycle') {
      const id=url.searchParams.get('id');
      const suggestion=cycleSuggestions(snapshot.reminders,snapshot.preferences.cycle)[0];
      if(id==='other'){status=404;payload={error:'不属于当前账号'};}
      else if(id==='expired'||!suggestion){status=410;payload={error:'该建议已过期或已处理'};}
      else payload={suggestion};
    } else if (url.pathname === '/api/push/public-key') payload={publicKey:'test'};
    else if (['/api/push/register','/api/push/reminders'].includes(url.pathname)) payload={ok:true};
    else { status = 503; payload = { error: '模拟环境未启用推送/天气' }; }
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
const settings=async page=>{await page.locator('[data-tab-button][data-switch-view="settings"]').first().click();await page.locator('#cycleSettings > summary').click();};
const saved=page=>page.waitForFunction(()=>document.querySelector('#cycleSettingsState').textContent==='周期建议设置已保存。');
const home=page=>page.locator('[data-switch-view="overview"]').first().click();
const enableFixture=async page=>page.addInitScript(()=>{
 const subscription={endpoint:'https://example.test/push',toJSON(){return{endpoint:this.endpoint,keys:{p256dh:'test',auth:'test'}}}};
 const reg={pushManager:{async getSubscription(){return subscription}},async update(){}};
 Object.defineProperty(navigator,'serviceWorker',{value:{ready:Promise.resolve(reg),async register(){return reg},addEventListener(){}}});
 Object.defineProperty(Notification,'permission',{get:()=> 'granted'});Notification.requestPermission=async()=> 'granted';
});
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 await scenario('push default off, explicit opt-in, reload and independent off',async(page,api)=>{
  setup(api);await enableFixture(page);await page.goto(origin);await settings(page);
  assert.equal(await page.isChecked('#cyclePushEnabled'),false);await page.check('#cyclePushEnabled');await saved(page);
  assert.equal(api.snapshot().preferences.cycle.pushEnabled,true);assert.equal(api.snapshot().reminders.length,4);
  await page.reload();await page.locator('[data-tab-button][data-switch-view="settings"]').first().click();assert.equal(await page.isChecked('#cyclePushEnabled'),true);
  await page.uncheck('#cyclePushEnabled');await saved(page);assert.equal(api.snapshot().preferences.cycle.pushEnabled,false);assert.equal(api.snapshot().preferences.cycle.enabled,true);
 });
 await scenario('cold notification route pre-fills without creating; save still explicit',async(page,api)=>{
  setup(api);const snapshot=api.snapshot();snapshot.preferences.cycle={enabled:true,pushEnabled:true};api.replace(snapshot);
  await page.goto(origin+'/#cycle=fixture');await page.locator('[data-view="compose"]:visible').waitFor();
  assert.equal(await page.inputValue('#reminderTitleInput'),'周期测试');assert.equal(api.snapshot().reminders.length,4);assert.equal(await page.isChecked('#reminderNotificationInput'),false);
  await page.locator('#reminderForm button[type="submit"]').click();await page.locator('[data-view="reminders"]:visible').waitFor();assert.equal(api.snapshot().reminders.length,5);
 });
 await scenario('warm route handles expired and foreign notification with no stale prefill',async(page,api)=>{
  setup(api);const s=api.snapshot();s.preferences.cycle={enabled:true,pushEnabled:true};api.replace(s);await page.goto(origin);
  for(const id of ['expired','other']){await page.evaluate(id=>location.hash='cycle='+id,id);await page.locator('#cycleFeedback').filter({hasText:/暂时无法打开建议/}).waitFor();assert.equal(api.snapshot().reminders.length,4);}
 });
 await scenario('login keeps cycle destination and disabled push invalidates notification',async(page,api)=>{
  setup(api);const s=api.snapshot();s.preferences.cycle={enabled:true,pushEnabled:true};api.replace(s);await page.goto(origin+'/#cycle=fixture');
  await page.fill('#accountPhoneInput','13800000000');await page.locator('#accountStartForm button[type="submit"]').click();await page.fill('#loginPassword','fixture-password');await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('[data-view="compose"]:visible').waitFor();assert.equal(api.snapshot().reminders.length,4);
  const next=api.snapshot();next.preferences.cycle.pushEnabled=false;api.replace(next);await page.goto(origin+'/#cycle=fixture');await page.locator('#cycleFeedback').filter({hasText:/不再满足条件/}).waitFor();
 },{loggedIn:false});
 console.log(`Passed ${count} cycle push scenarios`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
