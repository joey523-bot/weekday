import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
import {onRequestGet,onRequestPut} from '../functions/api/account/sync.js';
import {onRequestPost as register} from '../functions/api/push/register.js';
import {onRequestPost as unregister} from '../functions/api/push/unregister.js';
import worker, {processDailyCountdownEntry,processSalaryEntry} from '../workers/salary-notifier/src/index.js';
import {preserveNotificationPreferences,initializeNotificationPreferences} from '../functions/_utils/notification-sync.js';
const migration=readFileSync(new URL('../cloudflare/migrations/0010-account-notification-preferences.sql',import.meta.url),'utf8');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(readFileSync(new URL('../cloudflare/d1-schema.sql',import.meta.url),'utf8'));
 const DB = {
  prepare(sql) {
   let args=[];
   return {
    bind(...values) { args=values; return this; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return {results:db.prepare(sql).all(...args)}; },
    async run() { return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}; }
   };
  },
  async batch(statements) {
   db.exec('BEGIN');try { const results=[];for(const stmt of statements)results.push(await stmt.run());db.exec('COMMIT');return results; }
   catch(error){db.exec('ROLLBACK');throw error;}
  }
 };

 db.exec("INSERT INTO users VALUES('u','fixture','hash','salt','now','now');INSERT INTO users VALUES('other','other','hash','salt','now','now')");
 const token='a'.repeat(43),tokenHash=createHash('sha256').update(token).digest('base64url');
 db.prepare("INSERT INTO auth_sessions VALUES('session','u',?,'now','2099-01-01','now')").run(tokenHash);
 const snapshot={version:1,capabilities:{repeat:3},salary:{day:21,notification:{leadDays:0}},reminders:[],preferences:{cycle:{pushEnabled:false},clockout:{enabled:false}},updatedAt:'old'};
 db.prepare("INSERT INTO account_sync VALUES('u',?,1,'now','now')").run(JSON.stringify(snapshot));
 for(const [id,hour,updated,enabled] of [['a',17,'2026-10-20',true],['b',10,'2026-10-21',false]]){
  db.prepare(`INSERT INTO salary_push_subscriptions(installation_id,endpoint,p256dh,auth,salary_day,reminder_hour,user_id,permission,created_at,updated_at) VALUES(?,?,'key','auth',21,?,'u','granted','old',?)`).run(id,'https://example.test/'+id,hour,updated);
  db.prepare("INSERT INTO salary_daily_push_rules VALUES(?,?, 'previous-day','old','old')").run(id,enabled?1:0);
 }
 const env={DB,APP_URL:'https://example.test'};
 const req=(body,method='POST')=>new Request('https://example.test/api/account/sync',{method,headers:{Cookie:'yoyuan_session='+token,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 const snap=()=>JSON.parse(db.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='u'").get().snapshot_data);
 const revision=()=>db.prepare("SELECT revision FROM account_sync WHERE user_id='u'").get().revision;
 const entry=id=>db.prepare('SELECT s.*,r.enabled AS daily_enabled,r.last_sent_key AS daily_last_sent_key FROM salary_push_subscriptions s JOIN salary_daily_push_rules r USING(installation_id) WHERE installation_id=?').get(id);
 const sent=[];t.mock.method(webpush,'sendNotification',async(device,payload)=>{sent.push({endpoint:device.endpoint,...JSON.parse(payload)});return{statusCode:201}});
 return {db,DB,env,req,snap,revision,entry,sent};
}
test('migration chooses latest synced installation, preserves history and dedup, and is idempotent',t=>{
 const f=fixture(t),before=f.snap();f.db.exec(migration);assert.equal(f.snap().salary.notification.hour,10);assert.equal(f.snap().salary.notification.dailyCountdownEnabled,false);
 assert.deepEqual(f.snap().reminders,before.reminders);assert.deepEqual(f.snap().preferences,before.preferences);assert.equal(f.revision(),2);
 assert.equal(f.db.prepare("SELECT last_sent_key FROM salary_daily_push_rules WHERE installation_id='a'").get().last_sent_key,'previous-day');
 f.db.exec(migration);assert.equal(f.revision(),2);assert.equal(f.entry('a').enabled,1);
});
test('GET initializes old/new accounts once; new client saves shared preferences and rejects malformed values',async t=>{
 const f=fixture(t);let res=await(await onRequestGet({env:f.env,request:f.req(null,'GET')})).json();assert.equal(res.snapshot.salary.notification.hour,10);
 let s=res.snapshot;s.capabilities.notifications=1;s.salary.notification={leadDays:0,hour:15,dailyCountdownEnabled:true};
 let save=await onRequestPut({env:f.env,request:f.req({baseRevision:res.revision,snapshot:s},'PUT')});assert.equal(save.status,200);assert.equal(f.snap().salary.notification.hour,15);
 s.salary.notification.hour=24;save=await onRequestPut({env:f.env,request:f.req({baseRevision:f.revision(),snapshot:s},'PUT')});assert.equal(save.status,400);
 f.db.exec("UPDATE account_sync SET snapshot_data='{}',revision=1;DELETE FROM salary_push_subscriptions;DELETE FROM salary_daily_push_rules");
 await initializeNotificationPreferences(f.DB,'u');assert.equal(f.snap().salary.notification.hour,9);assert.equal(f.snap().salary.notification.dailyCountdownEnabled,false);
});
test('old client omission or stale local values cannot overwrite account preferences',async t=>{
 const f=fixture(t);f.db.exec(migration);const stored=f.snap();stored.salary.notification.dailyCountdownEnabled=true;
 const old={...structuredClone(stored),capabilities:{repeat:3}};delete old.salary.notification.hour;old.salary.notification.dailyCountdownEnabled=false;
 const preserved=preserveNotificationPreferences(old,stored);assert.equal(preserved.salary.notification.hour,10);assert.equal(preserved.salary.notification.dailyCountdownEnabled,true);
 const save=await onRequestPut({env:f.env,request:f.req({baseRevision:f.revision(),snapshot:old},'PUT')});assert.equal(save.status,200);assert.equal(f.snap().salary.notification.hour,10);assert.equal(f.snap().salary.notification.dailyCountdownEnabled,false);
 const body={installationId:'a',reminderHour:22,dailyCountdownEnabled:true,subscription:{endpoint:'https://example.test/new',keys:{p256dh:'key',auth:'auth'}}};
 const response=await register({env:f.env,request:f.req(body)});assert.equal(response.status,200);assert.equal(f.entry('a').reminder_hour,10);assert.equal(f.entry('a').daily_enabled,0);
});
test('account values apply to both devices without either device reopening; local disable stays local',async t=>{
 const f=fixture(t);f.db.exec(migration);let s=f.snap();s.capabilities.notifications=1;s.salary.notification.hour=10;s.salary.notification.dailyCountdownEnabled=true;
 await onRequestPut({env:f.env,request:f.req({baseRevision:f.revision(),snapshot:s},'PUT')});
 // Device a still has stale hour=17 and daily_enabled=0; Worker must read account.
 const now=new Date('2026-10-21T02:01:00Z');for(const id of ['a','b']){await processDailyCountdownEntry(f.entry(id),f.env,now);await processSalaryEntry(f.entry(id),f.env,now)}
 assert.equal(f.sent.length,4);assert.equal(new Set(f.sent.map(x=>x.endpoint)).size,2);
 await unregister({env:f.env,request:f.req({installationId:'a'})});assert.equal(f.entry('a').enabled,0);assert.equal(f.entry('b').enabled,1);assert.equal(f.snap().salary.notification.dailyCountdownEnabled,true);
 s=f.snap();s.capabilities.notifications=1;s.salary.notification.dailyCountdownEnabled=false;
 await onRequestPut({env:f.env,request:f.req({baseRevision:f.revision(),snapshot:s},'PUT')});
 await processDailyCountdownEntry({...f.entry('b'),daily_last_sent_key:''},f.env,now);assert.equal(f.sent.length,4);
});

test('scheduled dispatcher sees account-enabled countdown even while all per-device rules remain off',async t=>{
 const f=fixture(t);f.db.exec(migration);let s=f.snap();s.capabilities.notifications=1;s.salary.notification.dailyCountdownEnabled=true;
 await onRequestPut({env:f.env,request:f.req({baseRevision:f.revision(),snapshot:s},'PUT')});
 f.db.exec("UPDATE salary_push_subscriptions SET salary_day=22;UPDATE salary_daily_push_rules SET enabled=0");
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-21T02:01:00Z')});t.mock.method(webpush,'setVapidDetails',()=>{});
 let pending;await worker.scheduled({},f.env,{waitUntil(p){pending=p;}});await pending;
 assert.equal(f.sent.filter(p=>p.tag==='salary-daily-2026-10-21').length,2);
});
