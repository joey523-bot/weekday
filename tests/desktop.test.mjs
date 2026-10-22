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
 try{global.fetch=async()=>Response.json({results:[record]});let r=await onRequestGet({request:new Request('https://test/api/botanical/today')});assert.equal(r.status,200);assert.equal((await r.json()).plant.summary,'桂花的来源摘要');global.fetch=async()=>Response.json({results:[{...record,iconic_taxon_name:'Insecta'}]});r=await onRequestGet({request:new Request('https://test/api/botanical/today')});assert.equal(r.status,200);assert.equal((await r.json()).cached,true);global.fetch=async()=>{throw Error('offline')};r=await onRequestGet({request:new Request('https://test/api/botanical/today')});assert.equal(r.status,200);assert.equal((await r.json()).cached,true);}finally{global.fetch=old;}
});

test('first open during rate limit returns attributed real recovery content; shared backoff avoids more upstream calls',async()=>{
 const oldFetch=global.fetch,oldCaches=global.caches;let calls=0;const values=new Map();global.caches={default:{match:async key=>values.get(key.url)?.clone(),put:async(key,response)=>values.set(key.url,response.clone())}};
 global.fetch=async()=>{calls++;return new Response('',{status:429})};
 try{const first=await onRequestGet({request:new Request('https://test/api/botanical/today')});const a=await first.json();assert.equal(first.status,200);assert.equal(a.cached,true);assert.ok(validPlant(a.plant));assert.ok(a.collectedAt);const next=await onRequestGet({request:new Request('https://test/api/botanical/today?exclude='+encodeURIComponent(a.plant.title))});const b=await next.json();assert.notEqual(a.plant.title,b.plant.title);assert.equal(calls,1);}finally{global.fetch=oldFetch;global.caches=oldCaches;}
});

test('continuous browsing excludes history and reports exhaustion instead of silently repeating',async()=>{
 const oldFetch=global.fetch,oldCaches=global.caches;
 const pool=Array.from({length:12},(_,i)=>({...plant,title:'植物'+i,recordSource:'https://www.inaturalist.org/taxa/'+(1000+i)}));
 global.caches={default:{match:async key=>key.url.includes('online-pool-v3')?Response.json({plants:pool,savedAt:Date.now(),date:'2026-10-21'}):undefined,put:async()=>{}}};global.fetch=async()=>new Response('',{status:429});
 const {recoveryPlants:initial}=await import('../functions/_utils/botanical-cache.js');const seen=initial.map(p=>'inat:'+p.recordSource.split('/').at(-1));try{for(let i=0;i<12;i++){const r=await onRequestGet({request:new Request('https://test/api/botanical/today?seen='+encodeURIComponent(JSON.stringify(seen)))});const {plant:p}=await r.json();assert.ok(p);const key='inat:'+p.recordSource.split('/').at(-1);assert.ok(!seen.includes(key));seen.push(key);} // Recovery records remain eligible until viewed too.
 const {recoveryPlants}=await import('../functions/_utils/botanical-cache.js');seen.push(...recoveryPlants.map(p=>'inat:'+p.recordSource.split('/').at(-1)));
 const last=await onRequestGet({request:new Request('https://test/api/botanical/today?seen='+encodeURIComponent(JSON.stringify(seen)))});assert.equal(last.status,409);assert.equal((await last.json()).code,'NO_UNSEEN_PLANTS');
 }finally{global.fetch=oldFetch;global.caches=oldCaches;}
});
