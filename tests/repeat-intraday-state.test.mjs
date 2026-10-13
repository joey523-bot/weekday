import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFixedOccurrence, fixedDueOccurrences, fixedOccurrenceForDate } from '../scripts/utils/repeat.js';
const at = value => new Date(`${value}+08:00`);
const times = Array.from({length:14},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);
const payload = () => ({title:'活动提醒',date:'2026-10-12',category:'其他',notes:'本地测试',leadDays:0,notificationEnabled:true,
  repeat:{version:3,freq:'weekday',workday:'actual',startDate:'2026-10-12',time:'08:00',times}});
let serial=0;
async function setup() {
 const storage=new Map();let fail=false;
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(fail)throw new Error('quota');storage.set(key,value)}};
 globalThis.window={dispatchEvent(){}};globalThis.CustomEvent=class {};
 const load=()=>import(`../scripts/state.js?intraday=${++serial}`);
 return {...await load(),load,fail:value=>{fail=value}};
}
const current=s=>s.getState().reminders.find(r=>r.repeat?.status!=='history');
const create=s=>s.addReminder(payload(),[],{now:at('2026-10-12T07:30:00')});

test('one multi-time series persists and syncs cap3; clock changes never duplicate list records',async()=>{
 const s=await setup(),item=create(s);
 assert.equal(item.repeat.version,3);assert.deepEqual(item.repeat.times,times);
 assert.equal(s.getSyncSnapshot().capabilities.repeat,3);
 const before=JSON.stringify(s.getState().reminders);
 for(let h=8;h<21;h++)assert.equal(nextFixedOccurrence(current(s),at(`2026-10-12T${String(h).padStart(2,'0')}:01:00`)).occurrence.repeat.time,`${String(h+1).padStart(2,'0')}:00`);
 assert.equal(JSON.stringify(s.getState().reminders),before);
 assert.deepEqual((await s.load()).getState().reminders,s.getState().reminders);
});

test('daily completion leaves later reminders; skip cancels rest of day and keeps completion history',async()=>{
 const s=await setup(),item=create(s),now=at('2026-10-12T10:15:00');
 s.manageRepeat(item.id,'complete',{occurrenceDate:'2026-10-12',occurredOn:'2026-10-12',now});
 assert.equal(nextFixedOccurrence(current(s),now).occurrence.repeat.time,'11:00');
 assert.equal(fixedDueOccurrences(current(s),at('2026-10-12T11:00:00')).length,1);
 assert.throws(()=>s.manageRepeat(item.id,'complete',{occurrenceDate:'2026-10-12',occurredOn:'2026-10-12',now}),/重复/);
 s.manageRepeat(item.id,'skip',{occurrenceDate:'2026-10-12',now});
 assert.equal(fixedDueOccurrences(current(s),at('2026-10-12T11:00:00')).length,0);
 assert.equal(nextFixedOccurrence(current(s),now).occurrence.date,'2026-10-13');
 assert.equal(s.getState().reminders.filter(r=>r.repeat?.status==='history').length,2);
});

test('daily-only edits apply content and notification to all times but preserve tomorrow and reject schedule changes',async()=>{
 const s=await setup(),item=create(s),options={occurrenceDate:'2026-10-12',now:at('2026-10-12T10:15:00')};
 s.updateReminder(item.id,{title:'当天活动提醒',notificationEnabled:false},'once',options);
 assert.equal(fixedOccurrenceForDate(current(s),'2026-10-12','16:00').title,'当天活动提醒');
 assert.equal(fixedOccurrenceForDate(current(s),'2026-10-12','16:00').notificationEnabled,false);
 assert.equal(fixedOccurrenceForDate(current(s),'2026-10-13','16:00').title,'活动提醒');
 for(const patch of [{date:'2026-10-13'},{leadDays:1},{repeat:{...item.repeat,time:'08:30'}},{repeat:null},
   {repeat:{...item.repeat,times:times.slice(1)}}])assert.throws(()=>s.updateReminder(item.id,patch,'once',options),/当天|系列/);
});

test('single-to-multiple edit sets cutoff and clears incompatible date exceptions while preserving history',async()=>{
 const s=await setup(),p=payload();p.repeat={...p.repeat,version:2,times:[],time:'09:00'};
 const item=s.addReminder(p,[],{now:at('2026-10-12T07:30:00')});
 s.updateReminder(item.id,{date:'2026-10-14',repeat:{...item.repeat,time:'10:30'}},'once',{occurrenceDate:'2026-10-12',now:at('2026-10-12T08:00:00')});
 const edited=s.updateReminder(item.id,{repeat:payload().repeat,leadDays:0},'series',{now:at('2026-10-12T10:15:00')});
 assert.equal(edited.id,item.id);assert.equal(edited.repeat.version,3);assert.equal(edited.repeat.resumeAfter,at('2026-10-12T10:15:00').toISOString());
 assert.equal(fixedDueOccurrences(edited,at('2026-10-12T10:20:00')).length,0);
 assert.equal(nextFixedOccurrence(edited,at('2026-10-12T10:15:00')).occurrence.repeat.time,'11:00');
 assert.equal(Object.hasOwn(edited.repeat.overrides['2026-10-12']||{},'date'),false);
});

test('stopped edits stay stopped; preview then resume returns next future time without catch-up',async()=>{
 const s=await setup(),item=create(s),now=at('2026-10-12T10:15:00');
 s.manageRepeat(item.id,'pause',{now});
 s.updateReminder(item.id,{title:'新的活动提醒'},'series',{now});
 assert.equal(current(s).repeat.status,'paused');assert.equal(s.previewRepeatResume(item.id,{now}).time,'11:00');
 const resumed=s.manageRepeat(item.id,'resume',{now});
 assert.equal(resumed.id,item.id);assert.deepEqual(resumed.repeat.times,times);
 assert.equal(fixedDueOccurrences(resumed,at('2026-10-12T10:20:00')).length,0);
 assert.equal(fixedDueOccurrences(resumed,at('2026-10-12T11:00:00')).length,1);
});

test('time-window change does not backfill, switching back to single preserves version3 protection',async()=>{
 const s=await setup(),item=create(s),now=at('2026-10-12T10:15:00');
 const edited=s.updateReminder(item.id,{repeat:{...item.repeat,times:times.slice(1),time:'09:00'}},'series',{now});
 assert.equal(edited.repeat.resumeAfter,now.toISOString());assert.equal(fixedDueOccurrences(edited,at('2026-10-12T10:20:00')).length,0);
 const single=s.updateReminder(item.id,{repeat:{...edited.repeat,times:[],time:'18:30'}},'series',{now});
 assert.equal(single.repeat.version,3);assert.equal(nextFixedOccurrence(single,now).occurrence.repeat.time,'18:30');
 assert.equal(fixedDueOccurrences(single,at('2026-10-12T18:45:00')).length,1);
});

test('invalid lead-days and failed storage never partially modify series',async()=>{
 const s=await setup();assert.throws(()=>s.addReminder({...payload(),leadDays:1}),/当天/);assert.equal(s.getState().reminders.length,0);
 const item=create(s),before=JSON.stringify(s.getState().reminders);s.fail(true);
 assert.throws(()=>s.updateReminder(item.id,{title:'保存失败'},'series',{now:at('2026-10-12T10:15:00')}),/quota/);
 assert.equal(JSON.stringify(s.getState().reminders),before);
});


test('multi to after preserves version3 and after once cannot silently accept a multi schedule',async()=>{
 const s=await setup(),item=create(s),now=at('2026-10-12T10:15:00');
 const changed=s.updateReminder(item.id,{repeat:{freq:'custom',mode:'after',interval:2,unit:'day',startDate:'2026-10-12',time:'18:00',times:[]}},'series',{occurrenceDate:'2026-10-12',now});
 assert.equal(changed.repeat.mode,'after');assert.equal(changed.repeat.version,3);
 assert.throws(()=>s.updateReminder(item.id,{repeat:payload().repeat},'once',{now}),/整个系列/);
 assert.deepEqual(current(s),changed);
});
