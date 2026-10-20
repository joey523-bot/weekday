import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClockout,clockoutFor} from '../scripts/utils/clockout.js';
const now=new Date('2026-10-19T15:50:00+08:00'),date='2026-10-19';
const settings=()=>({...normalizeClockout(),enabled:true,records:{[date]:'09:06'}});
test('initial times, missing actual record, flex late and early, fixed',()=>{
 const c=settings();assert.equal(c.week[0].start,'09:00');assert.equal(c.week[0].end,'18:00');
 assert.equal(clockoutFor({...c,records:{}},date,now).status,'missing');
 assert.equal(clockoutFor(c,date,now).time,'18:06');assert.equal(clockoutFor(c,date,now).remaining,136);
 c.records[date]='08:50';assert.equal(clockoutFor(c,date,now).time,'18:00');c.records[date]='09:06';c.mode='fixed';assert.equal(clockoutFor(c,date,now).time,'18:00');
});
test('overtime and dated targets ignore lateness; date exception never leaks',()=>{
 const c=settings();c.records[date]='11:00';c.week[0]={kind:'overtime',start:'09:00',end:'20:30'};
 assert.equal(clockoutFor(c,date,now).time,'20:30');c.dates[date]={kind:'work',start:'09:00',end:'19:00'};assert.equal(clockoutFor(c,date,now).time,'19:00');
 c.records['2026-10-26']='11:00';assert.equal(clockoutFor(c,'2026-10-26',now).time,'20:30');
});
test('rest, makeup workday, calendar unavailable and same-day overflow',()=>{
 const c=settings();assert.equal(clockoutFor(c,'2026-10-18',now).status,'rest');assert.equal(clockoutFor(c,'2026-10-10',now).status,'missing');assert.equal(clockoutFor(c,'2027-01-04',now).status,'calendar_wait');
 c.records[date]='23:00';assert.equal(clockoutFor(c,date,now).status,'invalid');c.dates[date]={kind:'rest'};assert.equal(clockoutFor(c,date,now).status,'rest');
});
test('at target, state becomes due; invalid dates are rejected',()=>{
 assert.equal(clockoutFor(settings(),date,new Date('2026-10-19T18:06:00+08:00')).status,'due');assert.equal(clockoutFor(settings(),'2026-02-30',now).status,'invalid');
});

test('homepage countdown is always enabled including legacy disabled settings',()=>{assert.equal(normalizeClockout().enabled,true);assert.equal(normalizeClockout({enabled:false}).enabled,true);assert.equal(clockoutFor({enabled:false},date,now).status,'missing');});
