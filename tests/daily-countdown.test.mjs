import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { processDailyCountdownEntry } from '../workers/salary-notifier/src/index.js';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
import { onRequestPost } from '../functions/api/push/register.js';
import { normalizePushPayload } from '../functions/_utils/push.js';

const schema = readFileSync(new URL('../cloudflare/d1-schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../cloudflare/migrations/0004-salary-daily-countdown.sql', import.meta.url), 'utf8');
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  t.after(() => sqlite.close());
  const DB = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let args=[];
    return {
      bind(...values) { args=values; return this; },
      async all() { return { results:statement.all(...args) }; },
      async first() { return statement.get(...args) || null; },
      async run() { return { meta:{ changes:Number(statement.run(...args).changes) } }; }
    };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const values=[];for (const st of statements) values.push(await st.run());sqlite.exec('COMMIT');return values; }
    catch (err) { sqlite.exec('ROLLBACK');throw err; }
  } };
  sqlite.exec(`INSERT INTO salary_push_subscriptions
    (installation_id, endpoint, p256dh, auth, salary_day, created_at, updated_at)
    VALUES ('device','https://example.test/push','test','test',5,'now','now');`);
  sqlite.exec("INSERT INTO salary_daily_push_rules (installation_id,enabled,updated_at) VALUES ('device',1,'now')");
  const entry=()=>sqlite.prepare(`SELECT subscriptions.*, rules.enabled AS daily_enabled,
    rules.last_sent_key AS daily_last_sent_key FROM salary_push_subscriptions subscriptions
    JOIN salary_daily_push_rules rules USING (installation_id)`).get();
  const sent=[];
  t.mock.method(webpush,'sendNotification',async (_s,p)=>sent.push(JSON.parse(p)));
  return {sqlite, env:{DB,APP_URL:'https://example.test'},entry,sent};
}
const at=(date,hour='10:00:00')=>new Date(`${date}T${hour}+08:00`);

for (const [day,count] of [['2026-09-28',2],['2026-09-29',1],['2026-09-30',0],['2026-10-08',28],['2026-10-10',26],['2026-09-20',10],['2026-04-30',0]]) {
  test(`daily countdown on ${day}, including cross-month/payday/makeup dates`,async t=>{
    const f=fixture(t);await processDailyCountdownEntry(f.entry(),f.env,at(day));
    assert.equal(f.sent.length,1);assert.equal(f.sent[0].title,count===0?'今天发工资':`距离发工资还有${count}天`);
    assert.equal(f.sent[0].tag,`salary-daily-${day}`);
    assert.equal(f.entry().last_sent_key,''); // existing advance reminder key unchanged
    assert.equal(f.entry().daily_last_sent_key,day);
  });
}
test('no holiday/weekend/unknown-year/off-hour delivery; fixed Shanghai timezone',async t=>{
  const f=fixture(t);t.mock.method(console,'warn',()=>{});
  for (const day of ['2026-09-19','2026-09-25','2026-10-01','2026-10-05','2027-01-05','2026-12-07'])
    await processDailyCountdownEntry(f.entry(),f.env,at(day));
  for (const h of ['09:59:59','11:00:00','18:00:00']) await processDailyCountdownEntry(f.entry(),f.env,at('2026-09-28',h));
  assert.equal(f.sent.length,0);assert.equal(f.entry().daily_last_sent_key,'');
  await processDailyCountdownEntry({...f.entry(),timezone:'America/New_York'},f.env,at('2026-09-28','10:55:00'));
  assert.equal(f.sent.length,1);
});
test('atomic claim prevents concurrent and repeated sends, next day still sends',async t=>{
  const f=fixture(t),stale=f.entry();
  await Promise.all(Array.from({length:8},()=>processDailyCountdownEntry(stale,f.env,at('2026-09-28'))));
  await processDailyCountdownEntry(stale,f.env,at('2026-09-28','10:55:00'));
  assert.equal(f.sent.length,1);
  await processDailyCountdownEntry(f.entry(),f.env,at('2026-09-29'));assert.equal(f.sent.length,2);
});
test('live switches suppress stale jobs; turning off/on same day does not repeat',async t=>{
  const f=fixture(t),stale=f.entry();
  f.sqlite.exec('UPDATE salary_daily_push_rules SET enabled=0');
  await processDailyCountdownEntry(stale,f.env,at('2026-09-28'));assert.equal(f.sent.length,0);
  f.sqlite.exec('UPDATE salary_daily_push_rules SET enabled=1; UPDATE salary_push_subscriptions SET enabled=0');
  await processDailyCountdownEntry(stale,f.env,at('2026-09-28'));assert.equal(f.sent.length,0);
  f.sqlite.exec('UPDATE salary_push_subscriptions SET enabled=1');
  await processDailyCountdownEntry(f.entry(),f.env,at('2026-09-28'));
  f.sqlite.exec('UPDATE salary_daily_push_rules SET enabled=0; UPDATE salary_daily_push_rules SET enabled=1');
  await processDailyCountdownEntry(f.entry(),f.env,at('2026-09-28'));assert.equal(f.sent.length,1);
});
test('explicit rejection can retry; ambiguous transport error does not double-send',async t=>{
  const f=fixture(t);
  t.mock.method(webpush,'sendNotification',async()=>{throw Object.assign(new Error('busy'),{statusCode:429});});
  await processDailyCountdownEntry(f.entry(),f.env,at('2026-09-28'));assert.equal(f.entry().daily_last_sent_key,'');
  t.mock.method(webpush,'sendNotification',async()=>{throw new Error('transport timeout');});
  await processDailyCountdownEntry(f.entry(),f.env,at('2026-09-28'));assert.equal(f.entry().daily_last_sent_key,'2026-09-28');
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM push_delivery_attempts WHERE event_type='salary_daily' AND status='failed'").get().n,2);
});
test('gone subscription is disabled',async t=>{
  const f=fixture(t);t.mock.method(webpush,'sendNotification',async()=>{throw Object.assign(new Error('gone'),{statusCode:410});});
  await processDailyCountdownEntry(f.entry(),f.env,at('2026-09-28'));assert.equal(f.entry().enabled,0);
});
test('migration is additive/idempotent and old users have no daily opt-in',async t=>{
  const f=fixture(t);f.sqlite.exec('DROP TABLE salary_daily_push_rules');
  f.sqlite.exec(migration);f.sqlite.exec(migration);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM salary_daily_push_rules').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM salary_push_subscriptions').get().enabled,1);
  assert.equal(normalizePushPayload({}).dailyCountdownEnabled,undefined);
  assert.equal(normalizePushPayload({dailyCountdownEnabled:'true'}).dailyCountdownEnabled,undefined);
  assert.equal(normalizePushPayload({dailyCountdownEnabled:false}).dailyCountdownEnabled,false);
});
test('registration API persists independent setting atomically; legacy registration preserves it',async t=>{
  const f=fixture(t), token='a'.repeat(43),hash=createHash('sha256').update(token).digest('base64url');
  f.sqlite.exec("INSERT INTO users VALUES ('u','test','test','test','now','now')");
  f.sqlite.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)').run('s','u',hash,'now','2099-01-01','now');
  const request=flag=>new Request('https://example.test/api/push/register',{method:'POST',headers:{cookie:`yoyuan_session=${token}`,'Content-Type':'application/json'},body:JSON.stringify({installationId:'device',subscription:{endpoint:'https://example.test/push',keys:{p256dh:'test',auth:'test'}},dailyCountdownEnabled:flag})});
  for (const flag of [false,true,undefined,false]) {
    const result=await onRequestPost({env:f.env,request:request(flag)});assert.equal(result.status,200);
    assert.equal(f.entry().daily_enabled,flag===false?0:1);
    assert.equal(f.entry().enabled,1);
  }
});
test('scheduler independently runs daily, advance salary and ordinary reminders',async t=>{
  const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:at('2026-09-30')});t.mock.method(webpush,'setVapidDetails',()=>{});
  f.sqlite.exec("UPDATE salary_push_subscriptions SET reminder_hour=10; INSERT INTO reminder_push_rules (installation_id,reminder_id,title,reminder_date,reminder_hour,created_at,updated_at) VALUES ('device','r','事项','2026-09-30',10,'now','now')");
  let pending;await worker.scheduled({},f.env,{waitUntil(p){pending=p;}});await pending;
  assert.deepEqual(f.sent.map(p=>p.tag).sort(),['reminder-r-2026-09-30','salary-2026-09-30','salary-daily-2026-09-30'].sort());
});

test('daily switch off leaves scheduled salary and ordinary reminders active',async t=>{
  const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:at('2026-09-30')});t.mock.method(webpush,'setVapidDetails',()=>{});
  f.sqlite.exec("UPDATE salary_daily_push_rules SET enabled=0; UPDATE salary_push_subscriptions SET reminder_hour=10; INSERT INTO reminder_push_rules (installation_id,reminder_id,title,reminder_date,reminder_hour,created_at,updated_at) VALUES ('device','r','事项','2026-09-30',10,'now','now')");
  let pending;await worker.scheduled({},f.env,{waitUntil(p){pending=p;}});await pending;
  assert.deepEqual(f.sent.map(p=>p.tag).sort(),['reminder-r-2026-09-30','salary-2026-09-30'].sort());
});
test('daily preference follows account sync, defaults off and survives reload',async t=>{
  const storage=new Map();
  globalThis.localStorage = {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  globalThis.window = {dispatchEvent(){}};
  globalThis.CustomEvent = class {constructor(type){this.type=type;}};
  const state=await import(`../scripts/state.js?daily=${Date.now()}`);
  assert.equal(state.getState().salary.notification.dailyCountdownEnabled,false);
  state.updateSalary({notification:{...state.getState().salary.notification,dailyCountdownEnabled:true}});
  state.replaceSyncedData({salary:{notification:{leadDays:2,dailyCountdownEnabled:false}}});
  assert.equal(state.getState().salary.notification.dailyCountdownEnabled,false);
  assert.equal(state.getSyncSnapshot().salary.notification.dailyCountdownEnabled,false);
  const reload=await import(`../scripts/state.js?daily-reload=${Date.now()}`);
  assert.equal(reload.getState().salary.notification.dailyCountdownEnabled,false);
  reload.clearAccountData();assert.equal(reload.getState().salary.notification.dailyCountdownEnabled,false);
});
