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
async function scenario(name, run, { loggedIn = true, timezoneId = 'Asia/Shanghai', fixedNow = null } = {}) {
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
  if (fixedNow) await page.clock.setFixedTime(new Date(fixedNow));
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
 const board=async page=>{await page.goto(origin);await page.locator('[data-switch-view="reminders"]').first().click();};
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
 const rule = (changes={}) => ({version:1, seriesId:'series-one',freq:'day',mode:'fixed',interval:1,unit:'day',weekdays:[1],workday:'actual',startDate:'2026-10-01',endDate:'',time:'09:15',status:'active',scheduledDate:'2026-10-03',template:{title:'循环测试',category:'其他',notes:'原系列备注',leadDays:0,notificationEnabled:false,time:'09:15'},...changes});
 const recurring = (changes={}) => ({...reminder('r1','循环测试'),repeat:rule(changes)});
 const fixture = (api, changes={}) => {const s=api.snapshot();s.reminders[0]=recurring(changes);api.replace(s);};
 const settle=page=>page.waitForTimeout(800);
 await scenario('new weekly settings, close without applying, minute time, save/reopen and mobile width',async(page,api)=>{
  await board(page);assert.equal(await page.locator('#reminderList .repeat-badge').count(),0);
  await page.locator('[data-switch-view="compose"]').first().click();
  assert.equal(await page.locator('#reminderRepeatSummary').innerText(),'不重复');
  await page.fill('#reminderTitleInput','每周运动');await page.locator('.reminder-switch').click();
  await page.click('#reminderRepeatButton');await page.selectOption('#repeatFrequency','week');
  await page.click('#repeatClose');assert.equal(await page.locator('#reminderRepeatSummary').innerText(),'不重复');
  await page.click('#reminderRepeatButton');await page.selectOption('#repeatFrequency','week');
  for(const box of await page.locator('#repeatWeek input').all()) await box.uncheck();
  await page.check('#repeatWeek input[value="1"]');await page.check('#repeatWeek input[value="3"]');
  await page.fill('#repeatStart','2026-10-12');await page.fill('#repeatTime','09:35');
  await page.screenshot({path:'/tmp/weekday-rem007-weekly.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
  const geometry=await page.locator('#repeatDialog').boundingBox();assert.ok(geometry.x>=0 && geometry.x+geometry.width<=390);
  await page.locator('#repeatForm button[type="submit"]').click();
  assert.match(await page.locator('#reminderRepeatSummary').innerText(),/每周一、三/);
  assert.equal(await page.inputValue('#reminderRepeatTime'),'09:35');assert.equal(await page.locator('#reminderHourSelect').isVisible(),false);assert.equal(await page.locator('#reminderDateInput').isDisabled(),true);
  await page.click('#reminderSubmitButton');await settle(page);
  const saved=api.snapshot().reminders.find(item=>item.title==='每周运动');assert.ok(saved?.repeat);assert.equal(saved.repeat.time,'09:35');assert.deepEqual(saved.repeat.weekdays,[1,3]);
  assert.equal(await page.locator(`#reminderList [data-reminder-detail="${saved.id}"] .repeat-badge`).count(),1);await page.screenshot({path:'/tmp/weekday-rem007-list.png'});
  await page.reload();await page.locator('[data-switch-view="reminders"]').first().click();
  await page.locator(`#reminderList [data-reminder-detail="${saved.id}"] .reminder-item__body`).click();await page.click('#reminderDetailEdit');await page.click('[data-repeat-scope="series"]');await page.locator('#reminderFormHeading').filter({hasText:'编辑事项'}).waitFor();
  assert.match(await page.locator('#reminderRepeatSummary').innerText(),/每周一、三/);assert.equal(await page.inputValue('#reminderRepeatTime'),'09:35');
 });
 await scenario('once vs series editing preserve template and historic rule',async(page,api)=>{
  fixture(api);await board(page);
  assert.equal(await page.evaluate(async()=>{const {reminderDaysUntil}=await import('/scripts/views/render.js');return reminderDaysUntil({date:'2026-10-13',repeat:{}},new Date('2026-10-12T16:30:00Z'));}),0);
  await page.locator('#reminderList [data-reminder-detail="r1"] .reminder-item__body').click();await page.click('#reminderDetailEdit');await page.click('[data-repeat-scope="once"]');await page.locator('#reminderFormHeading').filter({hasText:'编辑事项'}).waitFor();
  assert.equal(await page.locator('#reminderRepeatButton').isDisabled(),true);
  await page.fill('#reminderTitleInput','仅本次改名');await page.fill('#reminderRepeatTime','10:25');await page.click('#reminderSubmitButton');await settle(page);
  let saved=api.snapshot().reminders.find(item=>item.id==='r1');assert.equal(saved.title,'仅本次改名');assert.equal(saved.repeat.time,'10:25');assert.equal(saved.repeat.template.title,'循环测试');assert.equal(saved.repeat.template.time,'09:15');
  await page.locator('#reminderList [data-reminder-detail="r1"] .reminder-item__body').click();await page.click('#reminderDetailEdit');await page.click('[data-repeat-scope="series"]');await page.locator('#reminderFormHeading').filter({hasText:'编辑事项'}).waitFor();
  await page.fill('#reminderTitleInput','系列改名');await page.click('#reminderRepeatButton');await page.selectOption('#repeatFrequency','custom');await page.selectOption('#repeatMode','after');await page.fill('#repeatInterval','20');await page.selectOption('#repeatUnit','day');
  await page.locator('#repeatForm button[type="submit"]').click();await page.click('#reminderSubmitButton');await settle(page);
  saved=api.snapshot().reminders.find(item=>item.id==='r1');assert.equal(saved.repeat.template.title,'系列改名');assert.equal(saved.repeat.mode,'after');assert.equal(saved.repeat.interval,20);
 });
 await scenario('detail completion generates exactly one next occurrence and locks history',async(page,api)=>{
  fixture(api);await page.goto(origin+'/#reminder=r1');await page.locator('#reminderDetail[open]').waitFor();
  assert.match(await page.locator('#reminderDetailRepeat').innerText(),/09:15 北京时间/);
  await page.click('#reminderDetailComplete');await page.fill('#occurrenceDate',today());await page.click('#occurrenceSubmit');
  await page.locator('#reminderDetailState').filter({hasText:'本次已完成并同步'}).waitFor();
  const series=api.snapshot().reminders.filter(item=>item.repeat);assert.equal(series.length,2);assert.equal(series.filter(item=>!item.completed).length,1);
  assert.equal(await page.locator('#reminderDetailComplete').isDisabled(),true);assert.equal(await page.locator('#reminderDetailEdit').isVisible(),false);assert.equal(await page.locator('#snoozePanel').isVisible(),false);assert.equal(await page.locator('#reminderDetailOccurrenceEdit').isVisible(),false);
  await page.click('#reminderDetailClose');await page.click('[data-filter="completed"]');assert.equal(await page.locator('[data-action="restore"][data-id="r1"]').count(),0);
 });
 await scenario('pause/resume, skip after mode, ended detail and calendar wait controls',async(page,api)=>{
  fixture(api,{freq:'custom',mode:'after',interval:20,unit:'day'});page.on('dialog',d=>d.accept());
  await page.goto(origin+'/#reminder=r1');await page.locator('#reminderDetail[open]').waitFor();
  await page.click('[data-repeat-action="pause"]');await settle(page);assert.equal(api.snapshot().reminders[0].repeat.status,'paused');assert.equal(await page.locator('#snoozePanel').isVisible(),false);assert.equal(await page.locator('[data-repeat-action="skip"]').isVisible(),false);
  await page.click('[data-repeat-action="resume"]');await settle(page);assert.equal(api.snapshot().reminders[0].repeat.status,'active');assert.equal(api.snapshot().reminders[0].date,'2026-10-03');
  await page.click('[data-repeat-action="skip"]');await settle(page);let history=api.snapshot().reminders.find(item=>item.id==='r1');assert.equal(history.repeatOutcome,'skipped');assert.equal(history.occurredOn,'');assert.match(await page.locator('#reminderDetailOccurrence').innerText(),/不记作完成/);
  let next=api.snapshot().reminders.find(item=>item.repeat && !item.completed);await page.click('#reminderDetailClose');await page.evaluate(id=>location.hash='reminder='+id,next.id);await page.locator('#reminderDetail[open]').waitFor();
  await page.click('[data-repeat-action="end"]');await settle(page);assert.equal(api.snapshot().reminders.find(item=>item.id===next.id).repeat.status,'ended');assert.equal(await page.locator('#reminderDetailEdit').isVisible(),false);assert.equal(await page.locator('[data-repeat-action="resume"]').isVisible(),false);
  await page.click('#reminderDetailClose');const s=api.snapshot();s.reminders.push({...reminder('wait','等待日历'),repeat:rule({seriesId:'waiting',freq:'weekday',startDate:'2030-01-01',status:'calendar_wait'})});api.replace(s);
  await page.evaluate(()=>location.hash='reminder=wait');await page.locator('#reminderDetail[open]').waitFor();assert.match(await page.locator('#repeatDetailNote').innerText(),/日历待更新/);assert.equal(await page.locator('#reminderDetailComplete').isDisabled(),true);assert.equal(await page.locator('#snoozePanel').isVisible(),false);
 });
 await scenario('Beijing date grouping and completion stay correct in Los Angeles after Beijing midnight',async(page,api)=>{
  const s=api.snapshot();s.reminders[0]={...recurring({scheduledDate:'2026-10-13'}),date:'2026-10-13'};api.replace(s);
  await board(page);
  assert.equal(await page.evaluate(()=>new Intl.DateTimeFormat('sv-SE').format(new Date())),'2026-10-12');
  const group=page.locator('#reminderList .reminder-time-group').filter({has:page.locator('[data-reminder-detail="r1"]')});
  assert.equal(await group.locator(':scope > h3').innerText(),'今天');
  const card=page.locator('#reminderList [data-reminder-detail="r1"]');
  assert.equal(await card.locator('.countdown').innerText(),'今天');
  await card.locator('.reminder-item__body').click();await page.click('#reminderDetailComplete');
  await page.locator('#occurrenceDialog[open]').waitFor();
  assert.equal(await page.inputValue('#occurrenceDate'),'2026-10-13');
  assert.equal(await page.locator('#occurrenceDate').getAttribute('max'),'2026-10-13');
  await page.click('#occurrenceSubmit');
  await page.locator('#reminderDetailState').filter({hasText:'本次已完成并同步'}).waitFor();
  const history=api.snapshot().reminders.find(item=>item.id==='r1');
  assert.equal(history.occurredOn,'2026-10-13');assert.equal(history.repeat.status,'history');
  const next=api.snapshot().reminders.find(item=>item.repeat && !item.completed);
  assert.equal(next.date,'2026-10-14');
 },{timezoneId:'America/Los_Angeles',fixedNow:'2026-10-12T16:30:00Z'});
 console.log(`Passed ${count} recurring UI scenarios`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
