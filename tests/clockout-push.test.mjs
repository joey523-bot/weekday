import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
import {clockoutCandidate,processClockoutAccount} from '../workers/salary-notifier/src/clockout.js';
import {normalizeClockout} from '../scripts/utils/clockout.js';
const record=()=>({user_id:'test',revision:1,clockout:{...normalizeClockout(),enabled:true,records:{'2026-10-19':'09:06'}}});
test('push follows actual target, enabled flags and one-hour catchup boundary',()=>{
 const r=record();assert.equal(clockoutCandidate(r,new Date('2026-10-19T18:05:00+08:00')),null);
 assert.equal(clockoutCandidate(r,new Date('2026-10-19T18:06:00+08:00')).time,'18:06');
 assert.equal(clockoutCandidate(r,new Date('2026-10-19T19:06:00+08:00')),null);
 r.clockout.pushEnabled=false;assert.equal(clockoutCandidate(r,new Date('2026-10-19T18:06:00+08:00')),null);
});
test('per-day device reservation prevents duplicate sends; live edits cancel delivery',async()=>{
 const old=webpush.sendNotification;let sends=0,claimed=false,changed=false;const r=record(),now=new Date('2026-10-19T18:10:00+08:00'),device={installation_id:'device',endpoint:'fixture',p256dh:'fixture',auth:'fixture'};
 const env={DB:{prepare(sql){return {bind(){return this;},async all(){return {results:[device]};},async first(){return sql.includes('FROM account_sync')?(changed?{...r,clockout:{...r.clockout,pushEnabled:false}}:r):device;},async run(){if(sql.startsWith('INSERT')){const changes=claimed?0:1;claimed=true;return {meta:{changes}};}if(sql.startsWith('DELETE'))claimed=false;return {meta:{changes:1}};}};}}};
 webpush.sendNotification=async()=>{sends++;};
 try {await processClockoutAccount(r,env,now);await processClockoutAccount(r,env,now);assert.equal(sends,1);claimed=false;changed=true;await processClockoutAccount(r,env,now);assert.equal(sends,1);assert.equal(claimed,false);}finally{webpush.sendNotification=old;}
});
