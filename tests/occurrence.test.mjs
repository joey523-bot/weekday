import test from 'node:test';
import assert from 'node:assert/strict';
import { isOccurrenceDate, occurrenceSamples } from '../scripts/utils/occurrence.js';
import { preserveMissingOccurrences } from '../functions/_utils/occurrence-sync.js';

test('confirmed dates reject impossible, future and missing values', () => {
 const now=new Date('2026-09-29T12:00:00');
 for(const d of ['','2026-02-30','2026-09-30','2026-9-01','invalid'])assert.equal(isOccurrenceDate(d,now),false);
 for(const d of ['2024-02-29','2026-09-29','2026-07-20'])assert.equal(isOccurrenceDate(d,now),true);
});
test('sample preparation uses confirmed days only, deduplicates dates, and requires explicit aliases',()=>{
 const reminders=[{title:'A',date:'2026-01-01',completed:true,occurredOn:'2026-07-20'},
 {title:'A',completed:true,occurredOn:'2026-07-20'},{title:'B',completed:true,occurredOn:'2026-07-23'},
 {title:'A',completed:false,occurredOn:'2026-07-24'},{title:'A',completed:true,completedAt:'2026-07-25'},
 {title:'A',completed:true,occurredOn:'2026-02-30'}];
 assert.equal(occurrenceSamples(reminders).length,2);
 assert.deepEqual(occurrenceSamples(reminders,{B:'A'}),[{title:'A',dates:['2026-07-20','2026-07-23'],gaps:[3]}]);
 assert.equal(reminders.length,6);
});
test('old-client omissions preserve dates but restore, clear and deletion do not resurrect history',()=>{
 const stored={reminders:[{id:'r',completed:true,occurredOn:'2026-07-20'}]};
 const merge=item=>preserveMissingOccurrences({reminders:[item]},stored).reminders[0];
 assert.equal(merge({id:'r',completed:true}).occurredOn,'2026-07-20');
 assert.equal(merge({id:'r',completed:false}).occurredOn,'');
 assert.equal(merge({id:'r',completed:true,occurredOn:''}).occurredOn,'');
 assert.equal(merge({id:'new',completed:true}).occurredOn,'');
 assert.deepEqual(preserveMissingOccurrences({reminders:[]},stored).reminders,[]);
});
test('completion, correction, edit, reload, restore and legacy dates stay separate',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.window={dispatchEvent:()=>{}};globalThis.CustomEvent=class{};
 const s=await import('../scripts/state.js?occurrence-state');
 s.addReminder({title:'example',date:'2026-08-15',category:'其他'});const id=s.getState().reminders[0].id;
 assert.throws(()=>s.setReminderCompletion(id,true));
 s.setReminderCompletion(id,true,'2026-07-20');const clicked=s.getState().reminders[0].completedAt;
 s.setReminderCompletion(id,true,'2026-07-21');
 s.updateReminder(id,{date:'2026-08-16',occurredOn:'2026-07-22'});
 const reloaded=await import('../scripts/state.js?occurrence-reload');const item=reloaded.getState().reminders[0];
 assert.equal(item.occurredOn,'2026-07-21');assert.equal(item.completedAt,clicked);assert.equal(item.date,'2026-08-16');
 assert.equal(reloaded.getSyncSnapshot().reminders[0].occurredOn,'2026-07-21');
 reloaded.setReminderCompletion(id,false);assert.equal(reloaded.getState().reminders[0].occurredOn,'');assert.equal(occurrenceSamples(reloaded.getState().reminders).length,0);
 reloaded.replaceSyncedData({reminders:[{id:'legacy',completed:true,createdAt:'2026-07-20T00:00:00Z',date:'2026-07-21'}]});
 assert.equal(reloaded.getState().reminders[0].occurredOn,'');assert.equal(occurrenceSamples(reloaded.getState().reminders).length,0);
});
