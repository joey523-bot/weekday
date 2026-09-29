import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
import worker from '../workers/salary-notifier/src/index.js';
import { processCycleAccount } from '../workers/salary-notifier/src/cycle.js';
import { cyclePushSuggestions, CYCLE_ACCOUNT_SELECT } from '../functions/_utils/cycle-push.js';
import { onRequestGet } from '../functions/api/push/cycle.js';
import { onRequestPut } from '../functions/api/account/sync.js';
const now=new Date('2026-09-29T04:00:00Z');
const rows=()=>['2026-07-11','2026-07-31','2026-08-20','2026-09-09'].map((d,i)=>({id:'r'+i,title:'测试周期',date:d,occurredOn:d,completed:true,completedAt:d+'T08:00:00Z'}));
function fixture(t){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare/d1-schema.sql',import.meta.url),'utf8'));t.after(()=>sql.close());
 let queue=Promise.resolve();const DB={prepare(query){let args=[];return{bind(...a){args=a;return this},first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}})}},batch(sts){const run=queue.then(async()=>{sql.exec('BEGIN');try{const result=[];for(const st of sts)result.push(await st.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}});queue=run.catch(()=>{});return run}};
 const snapshot={reminders:rows(),preferences:{cycle:{enabled:true,pushEnabled:true}}};
 for(const id of ['owner','other']){
  sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,'hash','salt','now','now');
  sql.prepare('INSERT INTO account_sync VALUES(?,?,?,?,?)').run(id,JSON.stringify(snapshot),1,'now','now');
  const token=(id==='owner'?'a':'b').repeat(43),hash=createHash('sha256').update(token).digest('base64url');
  sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run(id,id,hash,'now','2099-01-01','now');
  sql.prepare("INSERT INTO salary_push_subscriptions(installation_id,endpoint,p256dh,auth,user_id,permission,enabled,created_at,updated_at) VALUES(?,?,'key','auth',?,'granted',1,'now','now')").run(id+'device','https://example.test/'+id,id);
 }
 const sent=[];t.mock.method(webpush,'sendNotification',async(device,payload)=>sent.push({endpoint:device.endpoint,...JSON.parse(payload)}));
 const record=()=>DB.prepare(CYCLE_ACCOUNT_SELECT+' WHERE user_id=?').bind('owner').first();
 const update=patch=>{const old=JSON.parse(sql.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='owner'").get().snapshot_data);patch(old);sql.prepare("UPDATE account_sync SET snapshot_data=?,revision=revision+1 WHERE user_id='owner'").run(JSON.stringify(old))};
 const req=(id,user='owner')=>({env:{DB},request:new Request('https://example.test/api/push/cycle?id='+id,{headers:{cookie:'yoyuan_session='+(user==='owner'?'a':'b').repeat(43)}})});
 return{sql,DB,env:{DB,APP_URL:'https://example.test'},record,update,sent,req};
}
test('Shanghai midnight eligibility; explicit opt-in required',()=>{
 const record={reminders:rows(),cycle:{enabled:true,pushEnabled:true}};
 assert.equal(cyclePushSuggestions(record,new Date('2026-09-26T15:59:59Z')).length,0);
 assert.equal(cyclePushSuggestions(record,new Date('2026-09-26T16:00:00Z')).length,1);
 assert.equal(cyclePushSuggestions({...record,cycle:{}},now).length,0);
});
test('concurrent cron claims once per owner/device; duplicate and corrected date do not resend',async t=>{
 const f=fixture(t),record=await f.record();await Promise.all(Array.from({length:6},()=>processCycleAccount(record,f.env,now)));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].endpoint,'https://example.test/owner');assert.match(f.sent[0].url,/#cycle=/);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM cycle_suggestion_seen').get().n,4);
 f.update(s=>{s.reminders[3].occurredOn='2026-09-10'});await processCycleAccount(await f.record(),f.env,now);assert.equal(f.sent.length,1);
});
test('stale revision, disabled, handled, pending and no device all prevent push',async t=>{
 for(const patch of [s=>{s.preferences.cycle.handledTokens=s.reminders.map(r=>JSON.stringify([r.id,r.completedAt]))},s=>{s.preferences.cycle.pushEnabled=false},s=>{s.preferences.cycle.enabled=false},s=>{s.reminders.push({id:'todo',title:'测试周期',completed:false})}]){
  const f=fixture(t),stale=await f.record();f.update(patch);await processCycleAccount(stale,f.env,now);await processCycleAccount(await f.record(),f.env,now);assert.equal(f.sent.length,0);
 }
});
test('disabled device receives no cycle push',async t=>{const f=fixture(t);f.sql.prepare("UPDATE salary_push_subscriptions SET enabled=0 WHERE user_id='owner'").run();await processCycleAccount(await f.record(),f.env,now);assert.equal(f.sent.length,0);});
test('live switch change after reservation cancels external send',async t=>{
 const f=fixture(t),batch=f.DB.batch.bind(f.DB);let once=true;f.DB.batch=async stmts=>{const result=await batch(stmts);if(once){once=false;f.update(s=>{s.preferences.cycle.pushEnabled=false})}return result};
 await processCycleAccount(await f.record(),f.env,now);assert.equal(f.sent.length,0);assert.equal(f.sql.prepare('SELECT status FROM cycle_suggestion_deliveries').get().status,'cancelled');
});
test('explicit rejection retries, network uncertainty does not, expired endpoint disables',async t=>{
 for(const code of [429,undefined,410]){
  const f=fixture(t);let attempts=0;t.mock.method(webpush,'sendNotification',async()=>{attempts++;const e=new Error('provider');e.statusCode=code;throw e});
  const r=await f.record();await processCycleAccount(r,f.env,now);await processCycleAccount(r,f.env,now);
  assert.equal(attempts,code===429?2:1);
  if(code===410)assert.equal(f.sql.prepare("SELECT enabled FROM salary_push_subscriptions WHERE user_id='owner'").get().enabled,0);
 }
});
test('notification route authenticates owner and rechecks current eligibility without creating items',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now});await processCycleAccount(await f.record(),f.env,now);
 const id=f.sql.prepare('SELECT id FROM cycle_suggestion_deliveries').get().id;
 assert.equal((await onRequestGet(f.req(id))).status,200);assert.equal((await onRequestGet(f.req(id,'other'))).status,404);
 const unauth=f.req(id);unauth.request=new Request(unauth.request.url);assert.equal((await onRequestGet(unauth)).status,401);
 f.update(s=>{s.reminders.push({id:'pending',title:'测试周期',completed:false})});assert.equal((await onRequestGet(f.req(id))).status,410);
 assert.equal(JSON.parse(f.sql.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='owner'").get().snapshot_data).reminders.length,5);
});
test('old app cycle preferences without new flag preserve server opt-in; explicit false switches off',async t=>{
 const f=fixture(t),req=f.req('x');const put=cycle=>onRequestPut({env:f.env,request:new Request(req.request.url,{method:'PUT',headers:{cookie:req.request.headers.get('cookie'),'Content-Type':'application/json'},body:JSON.stringify({baseRevision:cycle.pushEnabled===false?2:1,snapshot:{reminders:rows(),preferences:{cycle}}})})});
 assert.equal((await put({enabled:true})).status,200);assert.equal(JSON.parse((await f.record()).cycle).pushEnabled,true);
 assert.equal((await put({enabled:true,pushEnabled:false})).status,200);assert.equal(JSON.parse((await f.record()).cycle).pushEnabled,false);
});
test('scheduled entry includes eligible cycle accounts without needing item reminder rules',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now});t.mock.method(webpush,'setVapidDetails',()=>{});let job;
 await worker.scheduled({},f.env,{waitUntil:p=>job=p});await job;assert.equal(f.sent.filter(x=>x.url?.includes('#cycle=')).length,2);
});
