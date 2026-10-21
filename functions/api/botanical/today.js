import { json } from '../../_utils/http.js';
import { recoveryPlants, collectedAt } from '../../_utils/botanical-cache.js';
const licenses={cc0:['CC0','https://creativecommons.org/publicdomain/zero/1.0/'],'cc-by':['CC BY','https://creativecommons.org/licenses/by/4.0/'],'cc-by-sa':['CC BY-SA','https://creativecommons.org/licenses/by-sa/4.0/']};
const clean=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&[^;]+;/g,' ').trim();
async function read(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Weekday botanical discovery/1.0'},signal:AbortSignal.timeout(5500)});if(!r.ok){const e=Error('source unavailable');e.code='source_http_'+r.status;throw e;}return r.json();}
const choose=(plants,exclude)=>{const available=plants.filter(p=>p.title!==exclude);return available[crypto.getRandomValues(new Uint32Array(1))[0]%available.length];};
const reply=(plant,cached=false,date='')=>json({plant,cached,collectedAt:date},{headers:{'Cache-Control':'no-store'}});
function normalized(p){
 const summary=clean(p?.wikipedia_summary).slice(0,700),photo=p?.default_photo,license=licenses[photo?.license_code];
 if(p?.iconic_taxon_name!=='Plantae'||!summary||!/[\u3400-\u9fff]/.test(summary)||!license||!p.wikipedia_url)return null;
 const plant={title:p.preferred_common_name||p.name,summary,source:p.wikipedia_url.replace(/^http:/,'https:'),image:photo.medium_url,imageSource:`https://www.inaturalist.org/photos/${photo.id}`,author:photo.attribution_name||photo.attribution||'见图片来源',license:license[0],licenseUrl:license[1],recordSource:`https://www.inaturalist.org/taxa/${p.id}`};
 return [plant.source,plant.image,plant.imageSource].every(v=>/^https:\/\//.test(v))?plant:null;
}
export async function onRequestGet({request}){
 const exclude=new URL(request.url).searchParams.get('exclude')||'';
 const cache=globalThis.caches?.default;
 const poolKey=new Request(new URL('/__botanical/online-pool-v2',request.url));
 const backoffKey=new Request(new URL('/__botanical/backoff-v2',request.url));
 let previous;
 try{previous=await (await cache?.match(poolKey))?.json();}catch{}
 const selected=choose(previous?.plants||[],exclude);
 if(selected && Date.now()-previous.savedAt<6*3600000)return reply(selected,false,previous.date);
 const fallback=()=>reply(choose(previous?.plants?.length>1?previous.plants:recoveryPlants,exclude)||choose(recoveryPlants,exclude),true,previous?.date||collectedAt);
 try{if(await cache?.match(backoffKey))return fallback();}catch{}
 try{
 try{await cache?.put(backoffKey,new Response('loading',{headers:{'Cache-Control':'public,max-age=30'}}));}catch{}
 const search=new URL('https://api.inaturalist.org/v1/taxa');search.search=new URLSearchParams({iconic_taxa:'Plantae',rank:'species',order_by:'observations_count',per_page:'20',page:String(1+crypto.getRandomValues(new Uint32Array(1))[0]%8),locale:'zh-CN'});
 const {results=[]}=await read(search);
 const candidates=results.filter(p=>p.iconic_taxon_name==='Plantae'&&/[\u3400-\u9fff]/.test(p.preferred_common_name||'')&&p.preferred_common_name!==exclude&&licenses[p.default_photo?.license_code]);
 const start=candidates.length?crypto.getRandomValues(new Uint32Array(1))[0]%candidates.length:0;
 const plants=[];
 for(let i=0;i<Math.min(2,candidates.length);i++){
 const record=candidates[(start+i)%candidates.length];const detail=await read(`https://api.inaturalist.org/v1/taxa/${record.id}?locale=zh-CN`);const plant=normalized(detail.results?.[0]);if(plant&&plant.title!==exclude){plants.push(plant);break;}
 }
 if(plants.length){const pool={plants:[...plants,...(previous?.plants||[]),...recoveryPlants].filter((p,i,a)=>a.findIndex(q=>q.title===p.title)===i).slice(0,20),savedAt:Date.now(),date:new Date().toISOString().slice(0,10)};try{await cache?.put(poolKey,json(pool,{headers:{'Cache-Control':'public,max-age=604800'}}));}catch{}return reply(choose(plants,exclude));}
 }catch(error){try{await cache?.put(backoffKey,new Response(error.code||'temporarily unavailable',{headers:{'Cache-Control':'public,max-age=900'}}));}catch{}}
 return fallback();
}
