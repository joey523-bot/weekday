import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeSnoozePlan, defaultSnoozeCutoff, snoozeOccurrence, isReminderDue, parseChinaInput } from '../scripts/utils/snooze.js';
import { onRequestPost, onRequestGet } from '../functions/api/push/snooze.js';
import { onRequestPut } from '../functions/api/account/sync.js';
import { onRequestPost as syncRules } from '../functions/api/push/reminders.js';
import { processSnoozeEntry } from '../workers/salary-notifier/src/snooze.js';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
const at=s=>new Date(`${s}+08:00`);
const base=at('2026-09-28T12:00:00');
function fixture(t) {
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../cloudflare/d1-schema.sql',import.meta.url),'utf8'));t.after(()=>sqlite.close());
 const DB={prepare(sql){const st=sqlite.prepare(sql);let args=[];return{bind(...a){args=a;return this;},async first(){return st.get(...args)||null;},async all(){return{results:st.all(...args)};},async run(){return{meta:{changes:Number(st.run(...args).changes)}};}};},async batch(sts){sqlite.exec('BEGIN');try{const results=[];for(const st of sts) results.push(await st.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const reminder={id:'r',title:'带钥匙',date:'2026-09-28',hour:10,notificationEnabled:true,completed:false};
 for(const user of ['u','other']){
  sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user,user,'hash','salt','now','now');
  sqlite.prepare('INSERT INTO account_sync VALUES (?,?,?,?,?)').run(user,JSON.stringify({reminders:[reminder]}),1,'now','now');
  const token=user==='u'?'a'.repeat(43):'b'.repeat(43), hash=createHash('sha256').update(token).digest('base64url');
  sqlite.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)').run(user,user,hash,'now','2099-01-01','now');
  sqlite.prepare(`INSERT INTO salary_push_subscriptions (installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at)
   VALUES (?,?, 'key','auth',?,'granted','now','now')`).run(user+'device','https://example.test/'+user,user);
 }
 const sent=[];t.mock.method(webpush,'sendNotification',async(s,p)=>sent.push({endpoint:s.endpoint,...JSON.parse(p)}));
 const request=(body,user='u',method='POST')=>new Request('https://example.test/api/push/snooze?id=r',{method,headers:{cookie:`yoyuan_session=${(user==='u'?'a':'b').repeat(43)}`,'Content-Type':'application/json'},...(method!=='GET'?{body:JSON.stringify(body)}:{})});
 const env={DB,APP_URL:'https://example.test'};
 const post=(body,user)=>onRequestPost({env,request:request({id:'r',...body},user)});
 const rule=(user='u')=>sqlite.prepare('SELECT * FROM reminder_snoozes WHERE user_id=?').get(user);
 const save=(completed,revision=1)=>onRequestPut({env,request:request({baseRevision:revision,snapshot:{reminders:[{...reminder,completed}]}})});
 return{sqlite,env,sent,request,post,rule,save,reminder};
}
test('10/30/60 minutes preserve minute precision; custom time uses Shanghai and validates dates',()=>{
 for(const minutes of [10,30,60])assert.equal(Date.parse(makeSnoozePlan({mode:'once',minutes},base).nextAt)-base,minutes*60000);
 assert.equal(makeSnoozePlan({mode:'once',at:'2026-09-29T00:03'},base).nextAt,'2026-09-28T16:03:00.000Z');
 for(const value of ['2026-02-30T12:00','2026-09-28T12:00','garbage'])assert.throws(()=>makeSnoozePlan({mode:'once',at:value},base));
 assert.ok(Number.isNaN(parseChinaInput('2026-09-28T25:00')));
});
test('22:00 defaults, explicit late/cross-day choice, cutoff is exclusive',()=>{
 assert.equal(defaultSnoozeCutoff(base),'2026-09-28T22:00');
 assert.equal(defaultSnoozeCutoff(at('2026-09-28T22:00:00')),'');
 assert.throws(()=>makeSnoozePlan({mode:'hourly',until:''},base));
 assert.throws(()=>makeSnoozePlan({mode:'hourly',until:'2026-09-28T13:00'},base));
 const plan=makeSnoozePlan({mode:'hourly',until:'2026-09-29T02:00'},at('2026-09-28T22:30:00'));
 const rule={active:1,mode:plan.mode,next_at:plan.nextAt,until_at:plan.untilAt};
 assert.equal(snoozeOccurrence(rule,at('2026-09-29T00:35:00')),'2026-09-28T16:30:00.000Z');
 assert.equal(snoozeOccurrence(rule,at('2026-09-29T02:00:00')),null);
});
test('due badges use Shanghai actual item time and exclude completed/future',()=>{
 assert.equal(isReminderDue({date:'2026-09-28',hour:12},base),true);
 assert.equal(isReminderDue({date:'2026-09-28',hour:13},base),false);
 assert.equal(isReminderDue({date:'2026-09-27',hour:12,completed:true},base),false);
});
test('API persists separate state; no original date changes; account isolation and missing subscription',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});
 assert.equal((await f.post({mode:'once',minutes:10})).status,200);
 assert.equal(f.rule().next_at,'2026-09-28T04:10:00.000Z');assert.equal(f.rule('other'),undefined);
 assert.equal(JSON.parse(f.sqlite.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='u'").get().snapshot_data).reminders[0].date,'2026-09-28');
 assert.equal((await onRequestGet({env:f.env,request:f.request(null,'other','GET')})).status,200);
 assert.equal((await (await onRequestGet({env:f.env,request:f.request(null,'other','GET')})).json()).rule,null);
 await f.post({action:'stop'},'other');assert.equal(f.rule().active,1);
 assert.equal((await f.post({id:'missing',mode:'once',minutes:10})).status,400);
 f.sqlite.exec("UPDATE salary_push_subscriptions SET enabled=0 WHERE user_id='u'");
 assert.equal((await f.post({mode:'once',minutes:10})).status,400);
});
test('single reminder is sent once across duplicate/concurrent Cron and to owner only',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'once',minutes:10});const rule=f.rule();
 await processSnoozeEntry(rule,f.env,at('2026-09-28T12:09:59'));assert.equal(f.sent.length,0);
 await Promise.all(Array.from({length:6},()=>processSnoozeEntry(rule,f.env,at('2026-09-28T12:10:00'))));
 await processSnoozeEntry(rule,f.env,at('2026-09-28T12:15:00'));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].endpoint,'https://example.test/u');assert.equal(f.sent[0].url,'https://example.test#reminder=r');
});
test('hourly skips missed backlog and stops at cutoff, each slot once per device',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'hourly',until:'2026-09-28T22:00'});const r=f.rule();
 for(const hour of ['13:00','13:05','16:20','16:25','21:59','22:00'])await processSnoozeEntry(r,f.env,at(`2026-09-28T${hour}:00`));
 assert.equal(f.sent.length,3);
});
test('complete then restore never rearms loop; stale worker job suppressed',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'hourly',until:'2026-09-28T22:00'});const r=f.rule();
 assert.equal((await f.save(true)).status,200);assert.equal(f.rule().active,0);
 assert.equal((await f.save(false,2)).status,200);
 await processSnoozeEntry(r,f.env,at('2026-09-28T13:00:00'));assert.equal(f.sent.length,0);
});
test('stop or replace rejects stale job; stop is idempotent',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'once',minutes:10});const old=f.rule();
 await f.post({mode:'once',minutes:30});await processSnoozeEntry(old,f.env,at('2026-09-28T12:10:00'));assert.equal(f.sent.length,0);
 const r=f.rule();await f.post({action:'stop'});await f.post({action:'stop'});await processSnoozeEntry(r,f.env,at('2026-09-28T12:30:00'));assert.equal(f.sent.length,0);
});
test('deleted/foreign/completed item and disabled subscription block stale job',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'once',minutes:10});const r=f.rule();
 f.sqlite.exec("UPDATE account_sync SET snapshot_data='{\"reminders\":[]}' WHERE user_id='u'");
 await processSnoozeEntry(r,f.env,at('2026-09-28T12:10:00'));assert.equal(f.sent.length,0);
});
test('explicit rejection may retry, ambiguous transport preserves claim',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'once',minutes:10});const r=f.rule();let attempts=0;
 t.mock.method(webpush,'sendNotification',async()=>{attempts++;throw Object.assign(new Error('busy'),{statusCode:429});});
 await processSnoozeEntry(r,f.env,at('2026-09-28T12:10:00'));
 t.mock.method(webpush,'sendNotification',async()=>{attempts++;throw new Error('timeout');});
 await processSnoozeEntry(r,f.env,at('2026-09-28T12:15:00'));await processSnoozeEntry(r,f.env,at('2026-09-28T12:20:00'));assert.equal(attempts,2);
});
test('ordinary reminder sync retains delivery key, removes stopped rules, rejects another owner',async t=>{
 const f=fixture(t);
 const call=async(user='u',reminders=[f.reminder])=>syncRules({env:f.env,request:f.request({installationId:'udevice',reminders},user)});
 assert.equal((await call()).status,200);
 f.sqlite.exec("UPDATE reminder_push_rules SET last_sent_key='r:2026-09-28'");
 await call();assert.equal(f.sqlite.prepare('SELECT last_sent_key FROM reminder_push_rules').get().last_sent_key,'r:2026-09-28');
 assert.equal((await call('other')).status,400);
 await call('u',[]);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM reminder_push_rules').get().n,0);
});
test('migration additive/idempotent with no auto-created snoozes',t=>{
 const f=fixture(t);f.sqlite.exec(readFileSync(new URL('../cloudflare/migrations/0005-reminder-snoozes.sql',import.meta.url),'utf8'));
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM reminder_snoozes').get().n,0);
});
test('two owner devices get one each, settled one-shot never revives on a new device',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});
 f.sqlite.exec(`INSERT INTO salary_push_subscriptions (installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at) VALUES ('second','https://example.test/second','key','auth','u','granted','now','now')`);
 await f.post({mode:'once',minutes:10});const r=f.rule();
 await Promise.all([processSnoozeEntry(r,f.env,at('2026-09-28T12:10:00')),processSnoozeEntry(r,f.env,at('2026-09-28T12:10:00'))]);
 assert.equal(f.sent.length,2);assert.equal(f.rule().active,0);
 f.sqlite.exec(`INSERT INTO salary_push_subscriptions (installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at) VALUES ('third','https://example.test/third','key','auth','u','granted','now','now')`);
 await processSnoozeEntry(r,f.env,at('2026-09-28T13:10:00'));assert.equal(f.sent.length,2);
});
test('disabled or reassigned device cannot receive a pending snooze',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'once',minutes:10});const r=f.rule();
 f.sqlite.exec("UPDATE salary_push_subscriptions SET enabled=0 WHERE user_id='u'");
 await processSnoozeEntry(r,f.env,at('2026-09-28T12:10:00'));assert.equal(f.sent.length,0);
 f.sqlite.exec("UPDATE salary_push_subscriptions SET enabled=1,user_id='other' WHERE installation_id='udevice'");
 await processSnoozeEntry(r,f.env,at('2026-09-28T12:15:00'));assert.equal(f.sent.length,0);
});
test('delete sync disables permanently; conflicted save does not cancel live pending item',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'hourly',until:'2026-09-28T22:00'});
 assert.equal((await f.save(true,99)).status,409);assert.equal(f.rule().active,1);
 const res=await onRequestPut({env:f.env,request:f.request({baseRevision:1,snapshot:{reminders:[]}})});
 assert.equal(res.status,200);assert.equal(f.rule().active,0);
});
test('expired provider endpoint disables device and does not repeatedly attempt it',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'once',minutes:10});let sends=0;
 t.mock.method(webpush,'sendNotification',async()=>{sends++;throw Object.assign(new Error('gone'),{statusCode:410});});
 await processSnoozeEntry(f.rule(),f.env,at('2026-09-28T12:10:00'));
 assert.equal(f.sqlite.prepare("SELECT enabled FROM salary_push_subscriptions WHERE installation_id='udevice'").get().enabled,0);assert.equal(sends,1);
});
test('unauthenticated snooze reads and writes are rejected',async t=>{
 const f=fixture(t);
 for(const [method,handler] of [['GET',onRequestGet],['POST',onRequestPost]]) {
  const response=await handler({env:f.env,request:new Request('https://example.test/api/push/snooze?id=r',{method})});assert.equal(response.status,401);
 }
});
test('scheduled worker dispatches snooze and existing ordinary reminder independently',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});await f.post({mode:'once',minutes:10});
 t.mock.timers.setTime(at('2026-09-28T12:10:00').getTime());
 f.sqlite.exec(`INSERT INTO reminder_push_rules (installation_id,reminder_id,title,reminder_date,reminder_hour,created_at,updated_at) VALUES ('udevice','r','带钥匙','2026-09-28',12,'now','now')`);
 t.mock.method(webpush,'setVapidDetails',()=>{});
 const {default:worker}=await import('../workers/salary-notifier/src/index.js');let pending;
 await worker.scheduled({},f.env,{waitUntil(p){pending=p;}});await pending;
 assert.equal(f.sent.length,2);assert.ok(f.sent.some(p=>p.tag.startsWith('snooze-')));assert.ok(f.sent.some(p=>p.tag==='reminder-r-2026-09-28'));
});
test('integration: old-client completion retains account custom categories and migrated item labels',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:base});
 const stored={preferences:{customCategories:['旅行']},reminders:[{...f.reminder,category:'带东西'}]};
 f.sqlite.prepare('UPDATE account_sync SET snapshot_data=? WHERE user_id=?').run(JSON.stringify(stored),'u');
 await f.post({mode:'hourly',until:'2026-09-28T22:00'});
 const response=await onRequestPut({env:f.env,request:f.request({baseRevision:1,snapshot:{reminders:[{...stored.reminders[0],completed:true}]}})});
 assert.equal(response.status,200);assert.equal(f.rule().active,0);
 const saved=JSON.parse(f.sqlite.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='u'").get().snapshot_data);
 assert.deepEqual(saved.preferences.customCategories,['旅行']);assert.equal(saved.reminders[0].category,'带东西');
});

test('old-client account saves retain confirmed occurrence, stay isolated and restore clears sample', async t => {
 const f=fixture(t);
 const stored={preferences:{customCategories:['自定义']},reminders:[{...f.reminder,completed:true,completedAt:'2026-07-29T12:00:00Z',occurredOn:'2026-07-20'}]};
 f.sqlite.prepare("UPDATE account_sync SET snapshot_data=? WHERE user_id='u'").run(JSON.stringify(stored));
 assert.equal((await f.save(true)).status,200);
 const snapshot=()=>JSON.parse(f.sqlite.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='u'").get().snapshot_data);
 assert.equal(snapshot().reminders[0].occurredOn,'2026-07-20');
 assert.deepEqual(snapshot().preferences.customCategories,['自定义']);
 assert.equal(JSON.parse(f.sqlite.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='other'").get().snapshot_data).reminders[0].occurredOn,undefined);
 assert.equal((await f.save(false,1)).status,409);
 assert.equal(snapshot().reminders[0].occurredOn,'2026-07-20');
 assert.equal((await f.save(false,2)).status,200);assert.equal(snapshot().reminders[0].occurredOn,'');
 assert.equal((await f.save(true,3)).status,200);assert.equal(snapshot().reminders[0].occurredOn,'');
});
