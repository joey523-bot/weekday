import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadAccountSnapshot} from '../scripts/services/account.js';
test('rejects incomplete sync responses and preserves legitimate empty/new accounts', async()=>{
 const original=globalThis.fetch;
 try {
  for(const payload of [{},{revision:1},{revision:1,snapshot:{}},{revision:1,snapshot:null},{revision:0,snapshot:{reminders:null}}]){
   globalThis.fetch=async()=>Response.json(payload);
   await assert.rejects(loadAccountSnapshot(),/响应不完整/);
  }
  for(const payload of [{revision:0,snapshot:null},{revision:2,snapshot:{reminders:[]}}]){
   globalThis.fetch=async()=>Response.json(payload);
   assert.deepEqual(await loadAccountSnapshot(),payload);
  }
 } finally {globalThis.fetch=original;}
});
