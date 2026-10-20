import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
import worker from '../workers/salary-notifier/src/index.js';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(readFileSync(new URL('../cloudflare/d1-schema.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../cloudflare/migrations/0009-push-diagnostic-runs.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO users VALUES('owner','owner','hash','salt','now','now')");
 const token='x'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
 db.prepare(`INSERT INTO push_diagnostic_runs(token_hash,user_id,installation_id,reminder_id,expires_at,created_at) VALUES(?,'owner','device','reminder',?,'now')`).run(hash,new Date(Date.now()+900000).toISOString());
 db.exec(`INSERT INTO salary_push_subscriptions(installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at) VALUES('device','https://example.test/push','key','auth','owner','granted','now','now')`);
 db.prepare(`INSERT INTO account_sync(user_id,snapshot_data,created_at,updated_at) VALUES('owner',?,'now','now')`).run(JSON.stringify({reminders:[{id:'reminder',title:'private',notificationEnabled:true,repeat:{version:2,status:'active',seriesId:'series',scheduledDate:'2026-10-21',times:[]}}]}));
 const DB = { prepare(sql) {
  let args = [];
  return {
   bind(...values) { args = values; return this; },
   async first() { return db.prepare(sql).get(...args); },
   async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; }
  };
 } };

 const sent=[];t.mock.method(webpush,'setVapidDetails',()=>{});t.mock.method(webpush,'sendNotification',async(d,p,o)=>{sent.push({device:d,payload:JSON.parse(p),options:o});return{statusCode:201,headers:{ttl:'300'}}});
 const req=(path='/__diagnostics/push',secret=token,method='POST')=>new Request('https://example.test'+path,{method,headers:{Authorization:'Bearer '+secret},body:method==='POST'?JSON.stringify({user_id:'other',title:'injection'}):undefined});
 return {db,sent,env:{DB,APP_URL:'https://example.test'},req};
}
test('invalid route/method/token and expired job send nothing',async t=>{
 const f=fixture(t);for(const r of[f.req('/'),f.req('/__diagnostics/push',''),f.req('/__diagnostics/push','z'.repeat(43)),f.req('/__diagnostics/push',undefined,'GET')])assert.equal((await worker.fetch(r,f.env)).status,404);
 f.db.exec("UPDATE push_diagnostic_runs SET expires_at='2000'");assert.equal((await worker.fetch(f.req(),f.env)).status,404);assert.equal(f.sent.length,0);
});
test('concurrent calls send exactly two to bound device; payload input ignored, TTLs retained',async t=>{
 const f=fixture(t),res=await Promise.all(Array.from({length:12},()=>worker.fetch(f.req(),f.env)));
 assert.equal(res.filter(r=>r.status===200).length,1);assert.equal(f.sent.length,2);assert.deepEqual(f.sent.map(x=>x.payload.title),['循环测试','工资测试']);
 assert.ok(f.sent.every(x=>x.device.endpoint==='https://example.test/push'));assert.equal(f.sent[0].options.TTL,300);assert.equal(f.sent[1].options.TTL,undefined);
 assert.notEqual(f.sent[0].payload.tag,f.sent[1].payload.tag);assert.equal(f.sent[0].payload.reminderId,'reminder');
 assert.equal(f.db.prepare('SELECT status FROM push_diagnostic_runs').get().status,'finished');assert.equal(f.db.prepare('SELECT count(*) AS n FROM recurring_reminder_deliveries').get().n,0);
 assert.equal((await worker.fetch(f.req(),f.env)).status,404);assert.equal(f.sent.length,2);
});
test('disabled or reassigned device or missing reminder aborts',async t=>{
 for(const change of["UPDATE salary_push_subscriptions SET enabled=0","UPDATE salary_push_subscriptions SET user_id='other'","UPDATE account_sync SET snapshot_data='{}'"]){const f=fixture(t);f.db.exec(change);assert.equal((await(await worker.fetch(f.req(),f.env)).json()).status,'aborted');assert.equal(f.sent.length,0);}
});
test('unknown provider outcome is recorded and cannot retry',async t=>{
 const f=fixture(t);t.mock.method(webpush,'sendNotification',async()=>{f.sent.push('attempt');throw Error('unknown')});const res=await(await worker.fetch(f.req(),f.env)).json();
 assert.equal(res.results.length,2);assert.ok(res.results.every(r=>r.status==='failed-or-unknown'));assert.equal((await worker.fetch(f.req(),f.env)).status,404);assert.equal(f.sent.length,2);
});
