import { json } from '../../_utils/http.js';
import { recoveryPlants, collectedAt } from '../../_utils/botanical-cache.js';
import { onlineBatch, plantKey } from '../../_utils/botanical-source.js';
const choose=(plants,excluded)=>{const available=plants.filter(p=>!excluded.has(plantKey(p))&&!excluded.has(p.title));return available[crypto.getRandomValues(new Uint32Array(1))[0]%available.length];};
const reply=(plant,cached=false,date='')=>json({plant,cached,collectedAt:date},{headers:{'Cache-Control':'no-store'}});
export async function onRequestGet({request}){
 const url=new URL(request.url),excluded=new Set([url.searchParams.get('exclude')||'']);
 try{const seen=JSON.parse(url.searchParams.get('seen')||'[]');if(Array.isArray(seen))seen.slice(-500).forEach(k=>{if(typeof k==='string'&&k.length<120)excluded.add(k)});}catch{}
 const cache=globalThis.caches?.default;
 const poolKey=new Request(new URL('/__botanical/online-pool-v3',request.url));
 const backoffKey=new Request(new URL('/__botanical/backoff-v2',request.url));
 let previous;try{previous=await (await cache?.match(poolKey))?.json();}catch{}
 const pool=[...(previous?.plants||[]),...recoveryPlants].filter((p,i,a)=>a.findIndex(q=>plantKey(q)===plantKey(p))===i);
 const selected=choose(pool,excluded);
 if(selected&&previous&&Date.now()-previous.savedAt<6*3600000)return reply(selected,true,previous.date);
 const fallback=()=>selected?reply(selected,true,previous?.date||collectedAt):json({error:'最近收集的花草已经看过了，资料源暂时没有补充新内容，请稍后再试。',code:'NO_UNSEEN_PLANTS'},{status:409});
 try{if(await cache?.match(backoffKey))return fallback();}catch{}
 try{
 try{await cache?.put(backoffKey,new Response('loading',{headers:{'Cache-Control':'public,max-age=30'}}));}catch{}
 const plants=await onlineBatch(excluded);
 if(plants.length){const updated={plants:[...plants,...pool].filter((p,i,a)=>a.findIndex(q=>plantKey(q)===plantKey(p))===i).slice(0,500),savedAt:Date.now(),date:new Date().toISOString().slice(0,10)};try{await cache?.put(poolKey,json(updated,{headers:{'Cache-Control':'public,max-age=604800'}}));}catch{}return reply(choose(plants,excluded));}
 }catch(error){try{await cache?.put(backoffKey,new Response(error.code||'temporarily unavailable',{headers:{'Cache-Control':'public,max-age=900'}}));}catch{}}
 return fallback();
}
