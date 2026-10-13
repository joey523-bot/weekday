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

const times = Array.from({length:14}, (_, i) => `${String(i+8).padStart(2,'0')}:00`);
const recurring = (changes={}) => ({...reminder('r1','喝水'),date:'2026-10-13',hour:8,notificationEnabled:true,
  repeat:{version:3,seriesId:'hourly-series',freq:'weekday',mode:'fixed',interval:1,unit:'day',weekdays:[1],workday:'actual',startDate:'2026-10-10',endDate:'',time:'08:00',times,status:'active',scheduledDate:'2026-10-13',template:{title:'喝水',category:'其他',notes:'每个工作日补水',leadDays:0,notificationEnabled:true,time:'08:00'},...changes}});
const fixture = (api, value=recurring()) => {const s=api.snapshot();s.reminders=[value];api.replace(s);};
const board = async page => {await page.goto(origin);await page.locator('[data-switch-view="reminders"]').first().click();};
const card = page => page.locator('#reminderList [data-reminder-detail="r1"]');
const detail = async page => {await card(page).locator('.reminder-item__body').click();await page.locator('#reminderDetail[open]').waitFor();};
const edit = async (page,scope) => {await page.click('#reminderDetailEdit');await page.click(`[data-repeat-scope="${scope}"]`);await page.locator('#reminderFormHeading').filter({hasText:'编辑事项'}).waitFor();};
const settle = page => page.waitForTimeout(850);
const chooseHourly = async page => {await page.click('#reminderRepeatButton');await page.selectOption('#repeatDailyPattern','hourly');};
const saveRule = page => page.locator('#repeatForm button[type="submit"]').click();
const save = async page => {await page.click('#reminderSubmitButton');await settle(page);};

try {
 browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 await scenario('new hourly workdays keep chosen date, inclusive 14 slots, lead zero and reload',async(page,api)=>{
  await board(page);await page.locator('[data-switch-view="compose"]').first().click();
  await page.fill('#reminderTitleInput','工作日喝水');await page.fill('#reminderDateInput','2026-10-13');
  await page.selectOption('#reminderLeadDaysInput','1');await page.click('#reminderRepeatButton');
  await page.selectOption('#repeatFrequency','weekday');await page.selectOption('#repeatDailyPattern','hourly');
  assert.equal(await page.inputValue('#repeatStart'),'2026-10-13');assert.equal(await page.inputValue('#repeatHourStart'),'8');assert.equal(await page.inputValue('#repeatHourEnd'),'21');
  assert.match(await page.locator('#repeatHourlyPreview').innerText(),/含开始和结束时刻，共14次/);
  assert.equal(await page.inputValue('#repeatWorkday'),'actual');
  await page.screenshot({path:'/tmp/weekday-rem007-intraday-settings.png',animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await saveRule(page);assert.equal(await page.inputValue('#reminderLeadDaysInput'),'0');assert.equal(await page.locator('#reminderLeadDaysInput').isDisabled(),true);
  assert.equal(await page.locator('#reminderRepeatTime').isVisible(),false);assert.equal(await page.locator('#reminderRepeatTime').isDisabled(),true);
  assert.match(await page.locator('#reminderHourlyNote').innerText(),/仅在事项当天提醒，不提前/);await save(page);
  const saved=api.snapshot().reminders.find(item=>item.title==='工作日喝水');assert.ok(saved,await page.locator('#reminderSaveState').innerText());
  assert.deepEqual(saved.repeat.times,times);assert.equal(saved.repeat.version,3);assert.equal(saved.repeat.time,'08:00');assert.equal(saved.repeat.startDate,'2026-10-13');assert.equal(saved.leadDays,0);
  await page.reload();await page.locator('[data-switch-view="reminders"]').first().click();
  const row=page.locator(`#reminderList [data-reminder-detail="${saved.id}"]`);assert.equal(await row.count(),1);assert.match(await row.innerText(),/下次提醒 10月13日 09:00 北京时间/);
  await row.locator('.reminder-item__body').click();await page.locator('#reminderDetail[open]').waitFor();await edit(page,'series');await page.click('#reminderRepeatButton');
  assert.equal(await page.inputValue('#repeatDailyPattern'),'hourly');assert.equal(await page.inputValue('#repeatStart'),'2026-10-13');assert.equal(await page.inputValue('#repeatHourEnd'),'21');
 },{fixedNow:'2026-10-13T00:30:00Z'});

 await scenario('range rejects one hour and midnight, after mode retains single minute time',async(page)=>{
  await board(page);await page.locator('[data-switch-view="compose"]').first().click();await page.click('#reminderRepeatButton');
  await page.selectOption('#repeatFrequency','day');await page.selectOption('#repeatDailyPattern','hourly');await page.selectOption('#repeatHourEnd','8');await saveRule(page);
  assert.match(await page.locator('#repeatError').innerText(),/结束时间须晚于/);await page.selectOption('#repeatHourStart','21');await page.selectOption('#repeatHourEnd','8');await saveRule(page);assert.equal(await page.locator('#repeatDialog').evaluate(el=>el.open),true);
  await page.selectOption('#repeatFrequency','custom');await page.selectOption('#repeatMode','after');
  assert.equal(await page.inputValue('#repeatDailyPattern'),'once');assert.equal(await page.locator('#repeatDailyPattern option[value="hourly"]').evaluate(el=>el.disabled),true);
  await page.fill('#repeatTime','09:35');await saveRule(page);assert.equal(await page.inputValue('#reminderRepeatTime'),'09:35');assert.equal(await page.locator('#reminderLeadDaysInput').isDisabled(),false);
 },{fixedNow:'2026-10-13T00:30:00Z'});

 await scenario('one series advances within day and after last hour, reload preserves next point',async(page,api)=>{
  fixture(api);await board(page);assert.equal(await card(page).count(),1);assert.match(await card(page).innerText(),/下次提醒 10月13日 09:00 北京时间/);
  await detail(page);await page.clock.fastForward(120000);await page.locator('#reminderDetailNext').filter({hasText:'下次提醒 10月13日 10:00 北京时间'}).waitFor();
  await page.click('#reminderDetailClose');assert.match(await card(page).innerText(),/10月13日 10:00/);assert.equal(api.snapshot().reminders.length,1);
  await page.screenshot({path:'/tmp/weekday-rem007-intraday-list.png',animations:'disabled'});
  await page.reload();await page.locator('[data-switch-view="reminders"]').first().click();assert.match(await card(page).innerText(),/10月13日 10:00/);
  await page.clock.fastForward(12*3600000);await card(page).locator('.reminder-item__notification').filter({hasText:'下次提醒 10月14日 08:00 北京时间'}).waitFor();assert.equal(await card(page).count(),1);
 },{fixedNow:'2026-10-13T00:59:00Z',advancingClock:true});

 await scenario('notification slot stays exact after day completion; skip cancels whole day with completed history kept',async(page,api)=>{
  fixture(api);page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/#reminder=r1&occurrence=2026-10-13&slot=09%3A00');await page.locator('#reminderDetail[open]').waitFor();
  assert.match(await page.locator('#reminderDetailMeta').innerText(),/本条提醒 09:00 北京时间/);assert.equal(await page.locator('#reminderDetailComplete').innerText(),'完成当天');assert.equal(await page.locator('[data-repeat-action="skip"]').innerText(),'跳过当天');
  const next=await page.locator('#reminderDetailNext').innerText();assert.equal(next,'下次提醒 10月13日 15:00 北京时间');
  await page.click('#reminderDetailComplete');assert.match(await page.locator('#occurrenceTitle').innerText(),/当天事项日期.*只记录一天/);await page.click('#occurrenceSubmit');
  await page.locator('#reminderDetailState').filter({hasText:'当天已完成并同步'}).waitFor();
  assert.equal(api.snapshot().reminders.filter(item=>item.repeat?.status==='history').length,1);assert.equal(api.snapshot().reminders.find(item=>item.id==='r1').repeat.status,'active');assert.equal(await page.locator('#reminderDetailNext').innerText(),next);
  assert.match(await page.locator('#reminderDetailMeta').innerText(),/本条提醒 09:00/);assert.equal(await page.locator('#reminderDetailComplete').isDisabled(),true);assert.equal(await page.locator('[data-repeat-action="skip"]').isVisible(),true);
  await page.click('#reminderDetailClose');await page.evaluate(()=>location.hash='reminder=r1&occurrence=2026-10-13&slot=12%3A00');await page.locator('#reminderDetail[open]').waitFor();
  assert.match(await page.locator('#reminderDetailMeta').innerText(),/本条提醒 12:00/);assert.equal(await page.locator('#reminderDetailEdit').isVisible(),true);assert.equal(await page.locator('#reminderDetailComplete').isDisabled(),true);
  await page.click('[data-repeat-action="skip"]');await settle(page);
  const histories=api.snapshot().reminders.filter(item=>item.repeat?.status==='history');assert.equal(histories.filter(item=>item.repeatOutcome==='completed').length,1);assert.equal(histories.filter(item=>item.repeatOutcome==='skipped').length,1);
  assert.deepEqual(api.snapshot().reminders.find(item=>item.id==='r1').repeat.skippedDates,['2026-10-13']);assert.match(await page.locator('#reminderDetailOccurrence').innerText(),/当天已跳过/);
  assert.equal(await page.locator('#reminderDetailNext').innerText(),'下次提醒 10月14日 08:00 北京时间');await page.click('#reminderDetailClose');assert.match(await card(page).innerText(),/10月14日 08:00/);
 },{fixedNow:'2026-10-13T06:15:00Z'});

 await scenario('day-only edits freeze date and timing, change all daily contents but preserve future template',async(page,api)=>{
  fixture(api);await board(page);await detail(page);await page.click('#reminderDetailEdit');assert.equal(await page.locator('[data-repeat-scope="once"]').innerText(),'仅当天');assert.match(await page.locator('#repeatScopeOnceNote').innerText(),/日期和提醒时段须通过整个系列/);await page.click('[data-repeat-scope="once"]');await page.locator('#reminderFormHeading').filter({hasText:'编辑事项'}).waitFor();
  assert.equal(await page.locator('#reminderDateInput').isDisabled(),true);assert.equal(await page.locator('#reminderRepeatButton').isDisabled(),true);assert.equal(await page.locator('#reminderLeadDaysInput').isDisabled(),true);assert.equal(await page.locator('#reminderRepeatTime').isDisabled(),true);
  await page.fill('#reminderTitleInput','今天喝温水');await page.fill('#reminderNotesInput','当天备注');await page.locator('.reminder-switch').click();await page.clock.fastForward(120000);await save(page);
  const saved=api.snapshot().reminders.find(item=>item.id==='r1');assert.equal(saved.repeat.template.title,'喝水');assert.equal(saved.repeat.overrides['2026-10-13'].title,'今天喝温水');assert.equal(saved.repeat.overrides['2026-10-13'].notificationEnabled,false);assert.equal(saved.repeat.overrides['2026-10-13'].time,undefined);assert.deepEqual(saved.repeat.times,times);
  assert.match(await card(page).innerText(),/下次计划 10月13日 10:00 北京时间/);
  await detail(page);await edit(page,'series');await chooseHourly(page);await page.selectOption('#repeatHourStart','10');await page.selectOption('#repeatHourEnd','18');await saveRule(page);await save(page);
  const edited=api.snapshot().reminders.find(item=>item.id==='r1');assert.equal(edited.repeat.time,'10:00');assert.equal(edited.repeat.times.length,9);assert.equal(edited.repeat.template.leadDays,0);
 },{fixedNow:'2026-10-13T00:59:00Z',advancingClock:true});

 await scenario('single with advance notice and moved exception converts to hourly without hidden schedule residue',async(page,api)=>{
  const value=recurring({version:2,times:[],time:'09:15',template:{title:'喝水',category:'其他',notes:'原安排',leadDays:1,notificationEnabled:true,time:'09:15'},overrides:{'2026-10-13':{title:'当天改名',date:'2026-10-14',time:'11:35',leadDays:1}}});value.leadDays=1;value.hour=9;fixture(api,value);
  await board(page);await detail(page);await edit(page,'series');await chooseHourly(page);await saveRule(page);
  assert.equal(await page.locator('#repeatDialog').evaluate(el=>el.open),false,await page.locator('#repeatError').innerText());assert.equal(await page.inputValue('#reminderLeadDaysInput'),'0');await save(page);
  const saved=api.snapshot().reminders.find(item=>item.id==='r1');assert.equal(saved.repeat.version,3);assert.deepEqual(saved.repeat.times,times);assert.equal(saved.leadDays,0);assert.equal(saved.repeat.template.leadDays,0);assert.equal(saved.repeat.time,'08:00');
  for(const patch of Object.values(saved.repeat.overrides)) {assert.equal(patch.date,undefined);assert.equal(patch.time,undefined);assert.equal(patch.leadDays,undefined);}
 },{fixedNow:'2026-10-13T00:30:00Z'});

 await scenario('hourly series stops as one item, edits while stopped and resumes to next slot',async(page,api)=>{
  fixture(api);page.on('dialog',dialog=>dialog.accept());await board(page);await detail(page);await page.click('[data-repeat-action="pause"]');await settle(page);await page.click('#reminderDetailClose');assert.equal(await card(page).count(),0);
  await page.click('[data-filter="inactive"]');assert.equal(await card(page).count(),1);assert.doesNotMatch(await card(page).innerText(),/下次提醒|明天|今天/);
  await card(page).locator('[data-action="edit"]').click();await page.locator('#reminderFormHeading').filter({hasText:'编辑事项'}).waitFor();await page.fill('#reminderTitleInput','喝水新名称');await save(page);assert.equal(api.snapshot().reminders.find(item=>item.id==='r1').repeat.status,'paused');
  await page.click('[data-filter="inactive"]');await card(page).locator('[data-action="repeat-resume"]').click();await page.locator('#repeatResumeDialog[open]').waitFor();assert.match(await page.locator('#repeatResumePreview').innerText(),/10月13日 15:00/);await page.click('#repeatResumeConfirm');await page.locator('#repeatResumeDialog').waitFor({state:'hidden'});
  assert.equal(api.snapshot().reminders.length,1);assert.equal(api.snapshot().reminders[0].repeat.status,'active');assert.deepEqual(api.snapshot().reminders[0].repeat.times,times);assert.match(await card(page).innerText(),/10月13日 15:00/);
 },{fixedNow:'2026-10-13T06:15:00Z'});

 console.log(`${count} intraday recurring browser scenarios passed.`);
} finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
