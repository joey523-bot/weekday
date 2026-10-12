import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
import worker, { processReminderEntry } from '../workers/salary-notifier/src/index.js';
import { processRepeatAccount } from '../workers/salary-notifier/src/repeat.js';
import { processSnoozeEntry } from '../workers/salary-notifier/src/snooze.js';
import { REPEAT_ACCOUNT_SELECT, repeatPushCandidates } from '../functions/_utils/repeat-push.js';
import { validateRepeatSnapshot } from '../functions/_utils/repeat-sync.js';
import { onRequestPut } from '../functions/api/account/sync.js';
import { onRequestPost as syncRules } from '../functions/api/push/reminders.js';
import { onRequestPost as snooze } from '../functions/api/push/snooze.js';
const at = value => new Date(`${value}+08:00`);
const now = at('2026-10-12T09:17:00');
const reminder = () => ({ id:'r', title:'浇花', category:'其他', notes:'', date:'2026-10-12', leadDays:0,
  hour:9, notificationEnabled:true, completed:false, repeat:{version:1, seriesId:'series', freq:'day', mode:'fixed', interval:1,
    unit:'day', weekdays:[1], workday:'weekdays', startDate:'2026-10-12', endDate:'', time:'09:17', status:'active',
    scheduledDate:'2026-10-12', template:{title:'浇花',category:'其他',notes:'',leadDays:0,notificationEnabled:true,time:'09:17'} } });
function fixture(t) {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../cloudflare/d1-schema.sql',import.meta.url),'utf8'));
  t.after(() => sql.close()); let queue = Promise.resolve();
  const DB = { prepare(query) { let args=[]; return { bind(...a){args=a;return this},
    first:async()=>sql.prepare(query).get(...args)||null, all:async()=>({results:sql.prepare(query).all(...args)}),
    run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}}) }; },
    batch(stmts) { const run=queue.then(async()=>{sql.exec('BEGIN');try { const res=[];for(const st of stmts)res.push(await st.run());sql.exec('COMMIT');return res; }
      catch(error){sql.exec('ROLLBACK');throw error;} });queue=run.catch(()=>{});return run; } };
  for (const id of ['owner','other']) {
    sql.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,'hash','salt','now','now');
    sql.prepare('INSERT INTO account_sync VALUES (?,?,?,?,?)').run(id,JSON.stringify({capabilities:{repeat:1},reminders:[reminder()]}),1,'now','now');
    const token=(id==='owner'?'a':'b').repeat(43), hash=createHash('sha256').update(token).digest('base64url');
    sql.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)').run(id,id,hash,'now','2099-01-01','now');
    sql.prepare(`INSERT INTO salary_push_subscriptions (installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at)
      VALUES (?,?,'key','auth',?,'granted','now','now')`).run(id+'device','https://example.test/'+id,id);
  }
  const env={DB,APP_URL:'https://example.test'}, sent=[];
  t.mock.method(webpush,'sendNotification',async(device,payload)=>sent.push({endpoint:device.endpoint,...JSON.parse(payload)}));
  const record=(id='owner')=>DB.prepare(`${REPEAT_ACCOUNT_SELECT} WHERE user_id=?`).bind(id).first();
  const snapshot=()=>JSON.parse(sql.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='owner'").get().snapshot_data);
  const update=patch=>{const old=snapshot();patch(old);sql.prepare("UPDATE account_sync SET snapshot_data=?,revision=revision+1 WHERE user_id='owner'").run(JSON.stringify(old));};
  const request=(body,user='owner')=>new Request('https://example.test/api/account/sync',{method:'POST',
    headers:{cookie:`yoyuan_session=${(user==='owner'?'a':'b').repeat(43)}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const save=(body,user='owner')=>onRequestPut({env,request:request(body,user)});
  return {sql,DB,env,sent,record,update,snapshot,request,save};
}

test('minute precision and Shanghai midnight; each fixed slot has its own one-hour window',()=>{
  const item=reminder(), row={snapshot_data:{reminders:[item]}};
  for(const value of ['2026-10-12T09:16:59','2026-10-12T10:17:00']) assert.equal(repeatPushCandidates(row,at(value)).length,0);
  for(const value of ['2026-10-12T09:17:00','2026-10-12T09:20:00','2026-10-12T10:16:59']) assert.equal(repeatPushCandidates(row,at(value)).length,1);
  item.repeat.time='00:03';item.leadDays=1;
  assert.equal(repeatPushCandidates(row,at('2026-10-11T00:03:00'))[0].dueAt,'2026-10-10T16:03:00.000Z');
});

test('closed app needs no client rules: concurrent Cron sends once per account/device/occurrence',async t=>{
  const f=fixture(t), record=await f.record();
  await Promise.all(Array.from({length:8},()=>processRepeatAccount(record,f.env,now)));
  assert.equal(f.sent.length,1); assert.equal(f.sent[0].endpoint,'https://example.test/owner');
  assert.equal(f.sent[0].url,'https://example.test#reminder=r&occurrence=2026-10-12');assert.match(f.sent[0].tag,/repeat-series-2026-10-12/);
  await processRepeatAccount(record,f.env,at('2026-10-12T09:22:00'));assert.equal(f.sent.length,1);
  assert.equal(f.sql.prepare('SELECT status FROM recurring_reminder_deliveries').get().status,'sent');
});

test('two devices each receive once; changing current date/time does not re-send a delivered occurrence',async t=>{
  const f=fixture(t);
  f.sql.exec(`INSERT INTO salary_push_subscriptions(installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at)
    VALUES('second','https://example.test/second','key','auth','owner','granted','now','now')`);
  await processRepeatAccount(await f.record(),f.env,now);assert.equal(f.sent.length,2);
  f.update(s=>{s.reminders[0].repeat.time='09:30'});
  await processRepeatAccount(await f.record(),f.env,at('2026-10-12T09:30:00'));assert.equal(f.sent.length,2);
});

test('paused, ended, history, notification-off and stale revisions never send',async t=>{
  for(const change of [r=>{r.repeat.status='paused'},r=>{r.repeat.status='ended'},r=>{r.repeat.status='history'},
    r=>{r.notificationEnabled=false}]) {
    const f=fixture(t),stale=await f.record();f.update(s=>change(s.reminders[0]));
    await processRepeatAccount(stale,f.env,now);await processRepeatAccount(await f.record(),f.env,now);assert.equal(f.sent.length,0);
  }
});

test('edit or pause after claim is re-read before sending and permits a later valid occurrence',async t=>{
  for(const patch of [r=>{r.repeat.status='paused'},r=>{r.repeat.time='09:30'}]) {
    const f=fixture(t),prepare=f.DB.prepare.bind(f.DB);let once=true;
    f.DB.prepare=query=>{const stmt=prepare(query);if(query.startsWith('INSERT OR IGNORE INTO recurring_reminder_deliveries')) {
      const run=stmt.run;stmt.run=async()=>{const result=await run();if(once){once=false;f.update(s=>patch(s.reminders[0]));}return result;};
    }return stmt;};
    await processRepeatAccount(await f.record(),f.env,now);assert.equal(f.sent.length,0);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM recurring_reminder_deliveries').get().n,0);
    f.update(s=>{s.reminders[0].repeat.status='active';s.reminders[0].repeat.time='09:30'});
    await processRepeatAccount(await f.record(),f.env,at('2026-10-12T09:30:00'));assert.equal(f.sent.length,1);
  }
});

test('disabled or reassigned device is suppressed including changes after claim',async t=>{
  for(const statement of ["UPDATE salary_push_subscriptions SET enabled=0 WHERE installation_id='ownerdevice'",
    "UPDATE salary_push_subscriptions SET user_id='other' WHERE installation_id='ownerdevice'"]) {
    const f=fixture(t),prepare=f.DB.prepare.bind(f.DB);let once=true;
    f.DB.prepare=query=>{const stmt=prepare(query);if(query.startsWith('INSERT OR IGNORE INTO recurring_reminder_deliveries')) {
      const run=stmt.run;stmt.run=async()=>{const result=await run();if(once){once=false;f.sql.exec(statement);}return result;};
    }return stmt;};
    await processRepeatAccount(await f.record(),f.env,now);assert.equal(f.sent.length,0);
  }
});

test('provider rejection retries; ambiguous transport never blindly repeats; expired subscription is disabled',async t=>{
  for(const code of [429,undefined,410]) {
    const f=fixture(t);let attempts=0;t.mock.method(webpush,'sendNotification',async()=>{attempts++;throw Object.assign(new Error('provider'),{statusCode:code});});
    const r=await f.record();await processRepeatAccount(r,f.env,now);await processRepeatAccount(r,f.env,now);
    assert.equal(attempts,code===429?2:1);
    if(code===410)assert.equal(f.sql.prepare("SELECT enabled FROM salary_push_subscriptions WHERE installation_id='ownerdevice'").get().enabled,0);
  }
});

test('old-client saves cannot omit, complete or delete recurring data; ordinary-only accounts remain compatible',async t=>{
  const f=fixture(t),original=f.snapshot();
  for(const reminders of [[],[{...reminder(),repeat:undefined}],[{...reminder(),repeat:undefined,completed:true}]]) {
    const result=await f.save({baseRevision:1,snapshot:{reminders}});assert.equal(result.status,426);
    assert.deepEqual(f.snapshot(),original);
  }
  const next=f.snapshot();next.reminders[0].repeat.status='paused';
  assert.equal((await f.save({baseRevision:1,snapshot:next})).status,200);
  assert.equal(f.snapshot().reminders[0].repeat.status,'paused');
  assert.equal((await f.save({baseRevision:1,snapshot:next})).status,409);
  f.update(s=>{s.reminders=[];delete s.capabilities;});
  assert.equal((await f.save({baseRevision:3,snapshot:{reminders:[]}})).status,200);
});

test('malformed recurrence rejected; only one non-history current item per series; history survives',()=>{
  const current=reminder(), history={...reminder(),id:'past',completed:true,repeat:{...reminder().repeat,status:'history'}};
  assert.equal(validateRepeatSnapshot({capabilities:{repeat:1},reminders:[current,history]},null).reminders.length,2);
  assert.throws(()=>validateRepeatSnapshot({capabilities:{repeat:1},reminders:[current,{...current,id:'dup'}]},null));
  for(const patch of [{time:'25:00'},{seriesId:''},{scheduledDate:'2026-02-30'}]) {
    assert.throws(()=>validateRepeatSnapshot({capabilities:{repeat:1},reminders:[{...current,repeat:{...current.repeat,...patch}}]},null));
  }
});

test('server account excludes legacy push-rule payloads that omit repeat and removes stale ordinary rules',async t=>{
  const f=fixture(t),legacy={...reminder()};delete legacy.repeat;
  f.sql.exec(`INSERT INTO reminder_push_rules(installation_id,reminder_id,title,reminder_date,created_at,updated_at)
    VALUES('ownerdevice','r','浇花','2026-10-12','now','now')`);
  assert.equal((await syncRules({env:f.env,request:f.request({installationId:'ownerdevice',reminders:[legacy]})})).status,200);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM reminder_push_rules').get().n,0);
  assert.equal((await syncRules({env:f.env,request:f.request({installationId:'ownerdevice',reminders:[legacy]},'other')})).status,400);
  await processReminderEntry({user_id:'owner',reminder_id:'r',reminder_date:'2026-10-12',reminder_hour:9},f.env);
  assert.equal(f.sent.length,0);
});

test('pause cancels existing snooze; stopped/history/calendar-wait series cannot start snooze',async t=>{
  const f=fixture(t);t.mock.timers.enable({apis:['Date'],now});
  const post=()=>snooze({env:f.env,request:f.request({id:'r',mode:'once',minutes:10})});
  assert.equal((await post()).status,200);
  const stale=f.sql.prepare('SELECT * FROM reminder_snoozes').get();
  const next=f.snapshot();next.reminders[0].repeat.status='paused';
  assert.equal((await f.save({baseRevision:1,snapshot:next})).status,200);
  assert.equal(f.sql.prepare('SELECT active FROM reminder_snoozes').get().active,0);
  await processSnoozeEntry(stale,f.env,at('2026-10-12T09:27:00'));assert.equal(f.sent.length,0);
  for(const status of ['paused','ended','history','calendar_wait']) {
    f.update(s=>{s.reminders[0].repeat.status=status});assert.equal((await post()).status,400);
  }
});

test('scheduler dispatches recurring accounts and suppresses legacy ordinary duplicate with app closed',async t=>{
  const f=fixture(t);t.mock.timers.enable({apis:['Date'],now});t.mock.method(webpush,'setVapidDetails',()=>{});
  f.sql.exec(`INSERT INTO reminder_push_rules(installation_id,reminder_id,title,reminder_date,reminder_hour,created_at,updated_at)
    VALUES('ownerdevice','r','浇花','2026-10-12',9,'now','now')`);
  let pending;await worker.scheduled({},f.env,{waitUntil:job=>pending=job});await pending;
  assert.equal(f.sent.length,2);assert.ok(f.sent.every(item=>item.tag.startsWith('repeat-')));
});

test('next occurrence receives one independent notification; additive migration is idempotent',async t=>{
  const f=fixture(t);await processRepeatAccount(await f.record(),f.env,now);
  f.update(s=>{s.reminders[0].date='2026-10-13';s.reminders[0].repeat.scheduledDate='2026-10-13'});
  await processRepeatAccount(await f.record(),f.env,at('2026-10-13T09:17:00'));assert.equal(f.sent.length,2);
  f.sql.exec(readFileSync(new URL('../cloudflare/migrations/0007-recurring-reminders.sql',import.meta.url),'utf8'));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM recurring_reminder_deliveries').get().n,2);
});

test('deleted recurring item cannot be resurrected by stale ordinary-device push rules', async t => {
  const f=fixture(t);t.mock.timers.enable({apis:['Date'],now});t.mock.method(webpush,'setVapidDetails',()=>{});
  const stale=await f.record();f.update(s=>{s.reminders=[]});
  const legacy={...reminder()};delete legacy.repeat;
  assert.equal((await syncRules({env:f.env,request:f.request({installationId:'ownerdevice',reminders:[legacy]})})).status,200);
  await processRepeatAccount(stale,f.env,now);
  await processReminderEntry({user_id:'owner',reminder_id:'r',reminder_date:'2026-10-12',reminder_hour:9},f.env);
  let pending;await worker.scheduled({},f.env,{waitUntil:job=>pending=job});await pending;
  assert.equal(f.sent.filter(item=>item.endpoint==='https://example.test/owner').length,0);
});

test('unchanged fixed account sends consecutive days without opening app or completing',async t=>{
 const f=fixture(t),record=await f.record();
 for(const day of [12,13,14]) {
  const clock=at(`2026-10-${day}T09:20:00`);
  await Promise.all([processRepeatAccount(record,f.env,clock),processRepeatAccount(record,f.env,clock)]);
 }
 assert.equal(f.sent.length,3);
 assert.deepEqual(f.sent.map(item=>item.tag),['repeat-series-2026-10-12','repeat-series-2026-10-13','repeat-series-2026-10-14']);
 assert.equal(f.snapshot().reminders[0].date,'2026-10-12');
});

test('completion on active fixed series does not stop its current or future reminder',async t=>{
 const f=fixture(t);f.update(s=>{s.reminders[0].completed=true;});
 for(const day of [12,13])await processRepeatAccount(await f.record(),f.env,at(`2026-10-${day}T09:20:00`));
 assert.equal(f.sent.length,2);
});

test('v2 skip and individual notification override exclude only their slots',async t=>{
 const f=fixture(t);f.update(s=>{const r=s.reminders[0].repeat;r.version=2;r.skippedDates=['2026-10-12'];r.overrides={'2026-10-13':{notificationEnabled:false}};s.capabilities.repeat=2;});
 for(const day of [12,13,14])await processRepeatAccount(await f.record(),f.env,at(`2026-10-${day}T09:20:00`));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].tag,'repeat-series-2026-10-14');
});

test('two explicitly coincident slots keep distinct claims and occurrence routes',async t=>{
 const f=fixture(t);f.update(s=>{const r=s.reminders[0].repeat;r.version=2;r.overrides={'2026-10-14':{date:'2026-10-13'}};s.capabilities.repeat=2;});
 await processRepeatAccount(await f.record(),f.env,at('2026-10-13T09:20:00'));
 assert.equal(f.sent.length,2);assert.equal(new Set(f.sent.map(x=>x.tag)).size,2);
 assert.ok(f.sent.some(x=>x.url.endsWith('occurrence=2026-10-14')));
});

test('v2 data needs capability2 on both incoming and stored sides; v1 clients still save v1 data',async t=>{
 const f=fixture(t),v2=f.snapshot();v2.reminders[0].repeat.version=2;
 assert.equal((await f.save({baseRevision:1,snapshot:v2})).status,426);
 v2.capabilities.repeat=2;
 assert.equal((await f.save({baseRevision:1,snapshot:v2})).status,200);
 const old=f.snapshot();old.capabilities.repeat=1;old.reminders[0].repeat.version=1;
 assert.equal((await f.save({baseRevision:2,snapshot:old})).status,426);
 assert.equal(f.snapshot().reminders[0].repeat.version,2);
 const newer=f.snapshot();newer.reminders[0].repeat.overrides={'2026-10-13':{time:'12:45'}};
 assert.equal((await f.save({baseRevision:2,snapshot:newer})).status,200);
 assert.equal(f.snapshot().reminders[0].repeat.overrides['2026-10-13'].time,'12:45');
});

test('unknown future calendar preserves last known delayed reminder but never guesses next year',async t=>{
 const f=fixture(t);f.update(s=>{const item=s.reminders[0];item.date='2026-12-31';item.repeat={...item.repeat,version:2,freq:'weekday',workday:'actual',startDate:'2026-12-31',scheduledDate:'2026-12-31'};});
 await processRepeatAccount(await f.record(),f.env,at('2026-12-31T09:20:00'));
 await processRepeatAccount(await f.record(),f.env,at('2027-01-01T09:20:00'));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].tag,'repeat-series-2026-12-31');
});

test('after mode remains completion dependent and never projects later dates',async t=>{
 const f=fixture(t);f.update(s=>{s.reminders[0].repeat={...s.reminders[0].repeat,freq:'custom',mode:'after',unit:'day',interval:1};});
 await processRepeatAccount(await f.record(),f.env,at('2026-10-13T09:20:00'));assert.equal(f.sent.length,0);
 f.update(s=>{s.reminders[0].completed=true});
 await processRepeatAccount(await f.record(),f.env,now);assert.equal(f.sent.length,0);
});
