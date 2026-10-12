import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryOptions, normalizeCustomCategories, validateNewCategory } from '../scripts/utils/reminder-categories.js';
import { preserveMissingCategories } from '../functions/_utils/category-sync.js';
test('four exact defaults, customs only, legacy only when editing', () => {
 assert.deepEqual(categoryOptions(), ['带东西','买东西','售后','其他']);
 assert.deepEqual(categoryOptions(['运动'],'账单'),['带东西','买东西','售后','其他','运动','账单']);
 assert.equal(categoryOptions(['运动']).includes('账单'),false);
});
test('reject blank duplicate and long names; normalize stored values safely', () => {
 for (const name of ['', '  ', '其他', '运动', '字'.repeat(21)]) assert.throws(()=>validateNewCategory(name,['运动']));
 assert.equal(validateNewCategory(' 运动 '), '运动');
 assert.deepEqual(normalizeCustomCategories([' 运动 ','运动','其他',null,'']),['运动']);
});
test('snapshot roundtrip, account switch and old snapshot clearing', async () => {
 const storage=new Map(); globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 globalThis.window={dispatchEvent:()=>{}};globalThis.CustomEvent=class{};
 const state=await import('../scripts/state.js?categories');
 state.addReminderCategory('运动'); const saved=state.getSyncSnapshot();
 assert.deepEqual(saved.preferences.customCategories,['运动']);
 state.clearAccountData(); assert.deepEqual(state.getState().preferences.customCategories,[]);
 state.replaceSyncedData(saved); assert.deepEqual(state.getState().preferences.customCategories,['运动']);
 state.replaceSyncedData({preferences:{},reminders:[]}); assert.deepEqual(state.getState().preferences.customCategories,[]);
 state.addReminder({title:'旧事项',date:'2026-09-29',category:'账单'});
 const id=state.getState().reminders[0].id;state.updateReminder(id,{title:'改文字'});
 assert.equal(state.getState().reminders[0].category,'账单');
});
test('old client saves preserve categories; new client field is respected',()=>{
 const stored={preferences:{customCategories:['运动']}};
 assert.deepEqual(preserveMissingCategories({preferences:{nickname:'甲'}},stored).preferences,{nickname:'甲',customCategories:['运动']});
 assert.deepEqual(preserveMissingCategories({preferences:{customCategories:[]}},stored).preferences.customCategories,[]);
});

test('authenticated API preserves old-client categories and rejects stale revision', async () => {
 const { onRequestPut }=await import('../functions/api/account/sync.js');
 for (const conflict of [false,true]) {
  let written;
  const DB={async batch(sts){return Promise.all(sts.map(s=>s.run()));},prepare(sql){return {bind(...args){return {
   async first(){
    if(sql.includes('auth_sessions'))return {user_id:'account-a',username:'fixture'};
    assert.equal(args[0],'account-a');
    if(sql.includes('AND revision'))assert.equal(args[1],3);
    return {snapshot_data:JSON.stringify({preferences:{customCategories:['运动']}}),revision:4};
   },
   async run(){
    if(sql.includes('UPDATE reminder_snoozes'))return {meta:{changes:0}};
    if(sql.includes('DELETE FROM reminder_push_rules')){assert.deepEqual(args,['account-a','account-a']);return {meta:{changes:0}};}
    assert.ok(sql.includes('UPDATE account_sync'));assert.equal(args[2],'account-a');assert.equal(args[3],3);written=JSON.parse(args[0]);return {meta:{changes:conflict?0:1}};}
  };}};}};
  const request=new Request('https://example.test/api/account/sync',{method:'PUT',headers:{cookie:`yoyuan_session=${'a'.repeat(43)}`},body:JSON.stringify({baseRevision:3,snapshot:{preferences:{nickname:'旧设备'}}})});
  const response=await onRequestPut({request,env:{DB}});
  assert.equal(response.status,conflict?409:200);assert.deepEqual(written.preferences.customCategories,['运动']);
 }
});
