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
let deviceSnapshot;
try {
 browser = await chromium.launch({headless:true, executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 const start = async(page,api,snapshot) => { if(snapshot)api.replace(snapshot);await page.goto(origin);await page.locator('[data-switch-view="compose"]').first().click(); };
 const options=page=>page.locator('#reminderCategoryInput option').allTextContents();
 const add=async(page,name)=>{await page.click('#addCategoryButton');await page.fill('#newCategoryInput',name);await page.click('#saveCategoryButton');};
 await scenario('defaults, validations, add and synchronized snapshot',async(page,api)=>{
  await start(page,api);assert.deepEqual(await options(page),['带东西','买东西','售后','其他']);assert.equal(await page.inputValue('#reminderCategoryInput'),'带东西');
  await add(page,'  ');assert.match(await page.textContent('#categoryState'),/请输入/);
  await page.fill('#newCategoryInput','其他');await page.click('#saveCategoryButton');assert.match(await page.textContent('#categoryState'),/已经/);
  await page.fill('#newCategoryInput','字'.repeat(21));await page.click('#saveCategoryButton');assert.match(await page.textContent('#categoryState'),/20/);
  await page.fill('#newCategoryInput',' 运动 ');await page.click('#saveCategoryButton');await page.getByText('分类已保存并同步。',{exact:true}).waitFor();
  assert.equal(await page.inputValue('#reminderCategoryInput'),'运动');assert.deepEqual(api.snapshot().preferences.customCategories,['运动']);deviceSnapshot=structuredClone(api.snapshot());
  await add(page,'运动');assert.match(await page.textContent('#categoryState'),/已经/);
  await page.click('#cancelCategoryButton');await page.screenshot({path:'/tmp/rem006-categories.png',animations:'disabled'});
 });
 await scenario('second device loads same account category',async(page,api)=>{
  await start(page,api,deviceSnapshot);assert.deepEqual(await options(page),['带东西','买东西','售后','其他','运动']);
 });
 await scenario('different account and failed hydration hide stale custom categories',async(page,api)=>{
  await page.addInitScript(snapshot=>localStorage.setItem('yoyuan-ledger:v2',JSON.stringify(snapshot)),deviceSnapshot);
  await start(page,api,{...structuredClone(DEFAULT_STATE),reminders:[]});assert.deepEqual(await options(page),['带东西','买东西','售后','其他']);
 });
 await scenario('load failure blocks adding to unknown account state',async(page,api)=>{
  await page.addInitScript(snapshot=>localStorage.setItem('yoyuan-ledger:v2',JSON.stringify(snapshot)),deviceSnapshot);api.failLoad(true);
  await start(page,api);assert.deepEqual(await options(page),['带东西','买东西','售后','其他']);await add(page,'旅行');assert.match(await page.textContent('#categoryState'),/尚未从账号加载/);
 });
 await scenario('legacy category survives edit save and does not enter new defaults',async(page,api)=>{
  api.replace({...structuredClone(DEFAULT_STATE),reminders:[{...reminder('r1','旧账单'),category:'账单'}]});
  await page.goto(`${origin}/#reminder=r1`);await page.locator('#reminderDetail[open]').waitFor();await page.click('#reminderDetailEdit');
  assert.equal(await page.inputValue('#reminderCategoryInput'),'账单');await page.fill('#reminderTitleInput','旧账单改文字');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/account/sync')&&r.request().method()==='PUT');await page.click('#reminderSubmitButton');await saved;
  assert.equal(api.snapshot().reminders[0].category,'账单');
  await page.locator('[data-switch-view="compose"]').first().click();assert.deepEqual(await options(page),['带东西','买东西','售后','其他']);
 });
 await scenario('sync failure is not reported as synchronized',async(page,api)=>{
  await start(page,api);api.failSave(true);await add(page,'旅行');await page.getByText(/分类已保存在本机，但尚未同步/).waitFor();assert.equal(api.snapshot().preferences.customCategories?.includes('旅行')||false,false);
 });
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
