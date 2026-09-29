import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleSuggestions as suggest, normalizeCycle, mergeCycleGroups, eventToken } from '../scripts/utils/cycle.js';
const day=(n)=>new Date(Date.UTC(2026,0,1+n)).toISOString().slice(0,10);
const now=n=>new Date(day(n)+'T12:00:00');
const records=(days,title='A')=>days.map((n,i)=>({id:`${title}${i}`,title,completed:true,occurredOn:day(n),completedAt:day(n)+'T08:00:00Z'}));
test('requires four distinct confirmed days, not creation/plan/unchecked/future/test dates',()=>{
 assert.equal(suggest(records([0,20,40]),{},now(58)).length,0);
 const four=records([0,20,40,60]);assert.equal(suggest(four,{},now(78)).length,1);
 assert.equal(suggest([...records([0,20,40]),{...four[3],occurredOn:day(40)}],{},now(58)).length,0);
 for(const patch of [{occurredOn:''},{completed:false},{occurredOn:day(100)}])assert.equal(suggest(four.map((r,i)=>i===3?{...r,...patch}:r),{},now(78)).length,0);
 assert.equal(suggest(four,{excludedIds:['A0']},now(78)).length,0);
 assert.equal(suggest(four,{clearedIds:['A0']},now(78)).length,0);
});
test('all recent intervals must satisfy 25 percent; no silent outlier deletion',()=>{
 assert.equal(suggest(records([0,15,35,60]),{},now(78)).length,1);
 assert.equal(suggest(records([0,14,34,60]),{},now(78)).length,0);
 assert.equal(suggest(records([0,20,40,90]),{},now(108)).length,0);
 const six=suggest(records([0,1,21,41,61,81,101]),{},now(119))[0];assert.equal(six.dates.length,6);assert.equal(six.median,20);
 const half=suggest(records([0,20,41,61,82]),{},now(101))[0];assert.equal(half.median,20.5);assert.equal(half.expected,day(103));
});
test('window begins two days early and expires after two days; daily cycle starts next day',()=>{
 const rows=records([0,20,40,60]);
 for(const n of [77,83])assert.equal(suggest(rows,{},now(n)).length,0);
 for(const n of [78,80,82])assert.equal(suggest(rows,{},now(n)).length,1);
 assert.equal(suggest(records([0,1,2,3]),{},now(3)).length,0);
 assert.equal(suggest(records([0,1,2,3]),{},now(4)).length,1);
});
test('exact titles only, explicit merge and pending alias suppression',()=>{
 const rows=[...records([0,20],'A'),...records([40,60],'B')];assert.equal(suggest(rows,{},now(78)).length,0);
 const p=mergeCycleGroups(rows,{},'A','B');assert.equal(suggest(rows,p,now(78)).length,1);
 assert.equal(suggest([...rows,{id:'todo',title:'B',completed:false}],p,now(78)).length,0);
 assert.throws(()=>mergeCycleGroups(rows,p,'A','B'));
 assert.equal(suggest(rows,{...p,groups:p.groups.map(g=>({...g,disabled:true}))},now(78)).length,0);
 assert.equal(suggest(rows,{...p,enabled:false},now(78)).length,0);
});
test('ignore or accept suppresses correction, deletion of accepted pending, and reopen; new occurrence can qualify',()=>{
 const rows=records([0,20,40,60]);const card=suggest(rows,{},now(78))[0];const p={handledTokens:card.tokens};
 assert.equal(suggest(rows,p,now(78)).length,0);
 assert.equal(suggest(rows.map((r,i)=>i===3?{...r,occurredOn:day(61)}:r),p,now(79)).length,0);
 assert.equal(suggest(rows.slice(0,3),p,now(58)).length,0);
 const extended=records([0,20,40,60,80]);assert.equal(suggest(extended,p,now(98)).length,1);
 assert.notEqual(eventToken(rows[3]),eventToken({...rows[3],completedAt:day(80)}));
});
test('cleared records never reenter on backfill, groups and feedback can reset without deleting items',()=>{
 const rows=records([0,20,40,60]);const p=normalizeCycle({clearedIds:rows.map(r=>r.id)});
 assert.equal(suggest(rows,p,now(78)).length,0);assert.equal(rows.length,4);
 assert.equal(suggest(records([0,20,40,60],'new'),p,now(78)).length,1);
});
test('accept saves feedback and new reminder atomically and account replacement clears previous preferences',async()=>{
 let fail=false;const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('full');storage.set(k,v)}};
 globalThis.window={dispatchEvent:()=>{}};globalThis.CustomEvent=class{};
 const state=await import('../scripts/state.js?cycle-tests');const payload={title:'A',date:day(80)};
 fail=true;assert.throws(()=>state.addReminder(payload,['event']));assert.equal(state.getState().reminders.length,0);assert.deepEqual(state.getState().preferences.cycle.handledTokens,[]);
 fail=false;state.addReminder(payload,['event']);assert.deepEqual(state.getSyncSnapshot().preferences.cycle.handledTokens,['event']);
 state.replaceSyncedData({reminders:[],preferences:{}});assert.deepEqual(state.getState().preferences.cycle.handledTokens,[]);
});
