import test from 'node:test';
import assert from 'node:assert/strict';
import {botanicalDay,validPlant,fetchBotanical,readBotanicalCache} from '../scripts/services/botanical.js';
import {onRequestGet} from '../functions/api/botanical/today.js';
const plant={title:'桂花',summary:'花草资料',source:'https://zh.wikipedia.org/wiki/桂花',image:'https://upload.wikimedia.org/test.jpg',imageSource:'https://commons.wikimedia.org/wiki/File:test',author:'Author',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'};
test('online plant cache validates links, preserves daily selection, and rejects duplicate replacement',async()=>{
 const oldFetch=global.fetch,oldStorage=global.localStorage;const m=new Map();global.localStorage={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};
 try{assert.match(botanicalDay(),/^\d{4}-\d{2}-\d{2}$/);assert.ok(validPlant(plant));assert.ok(!validPlant({...plant,image:'javascript:alert(1)'}));global.fetch=async()=>Response.json({plant});await fetchBotanical();assert.equal(readBotanicalCache().plant.title,'桂花');await assert.rejects(fetchBotanical('桂花'));global.fetch=async()=>{throw Error('offline')};await assert.rejects(fetchBotanical());assert.equal(readBotanicalCache().plant.title,'桂花');}finally{global.fetch=oldFetch;global.localStorage=oldStorage;}
});
test('online endpoint uses plant-only records, online summary and licensed photos; failures remain explicit',async()=>{
 const old=global.fetch;const record={id:123,name:'Osmanthus fragrans',preferred_common_name:'桂花',iconic_taxon_name:'Plantae',wikipedia_url:plant.source,wikipedia_summary:'<b>桂花</b>的来源摘要',default_photo:{id:4,license_code:'cc0',medium_url:plant.image,attribution_name:'Author'}};
 try{global.fetch=async()=>Response.json({results:[record]});let r=await onRequestGet({request:new Request('https://test/api/botanical/today')});assert.equal(r.status,200);assert.equal((await r.json()).plant.summary,'桂花的来源摘要');global.fetch=async()=>Response.json({results:[{...record,iconic_taxon_name:'Insecta'}]});r=await onRequestGet({request:new Request('https://test/api/botanical/today')});assert.equal(r.status,503);global.fetch=async()=>{throw Error('offline')};r=await onRequestGet({request:new Request('https://test/api/botanical/today')});assert.equal(r.status,503);}finally{global.fetch=old;}
});
