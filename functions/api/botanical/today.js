import { json } from '../../_utils/http.js';
const licenses={cc0:['CC0','https://creativecommons.org/publicdomain/zero/1.0/'],'cc-by':['CC BY','https://creativecommons.org/licenses/by/4.0/'],'cc-by-sa':['CC BY-SA','https://creativecommons.org/licenses/by-sa/4.0/']};
const clean=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&[^;]+;/g,' ').trim();
async function read(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Weekday botanical discovery/1.0'},signal:AbortSignal.timeout(6500)});if(!r.ok)throw Error('source unavailable');return r.json();}
export async function onRequestGet({request}){
 const excluded=new URL(request.url).searchParams.get('exclude')||'';
 const page=1+crypto.getRandomValues(new Uint32Array(1))[0]%12;
 try{
 const search=new URL('https://api.inaturalist.org/v1/taxa');search.search=new URLSearchParams({iconic_taxa:'Plantae',rank:'species',order_by:'observations_count',per_page:'30',page:String(page),locale:'zh-CN'});
 const {results=[]}=await read(search);
 const candidates=results.filter(p=>p.iconic_taxon_name==='Plantae'&&p.preferred_common_name&&p.preferred_common_name!==excluded&&licenses[p.default_photo?.license_code]);
 // A random starting point makes refresh useful without maintaining a local article/photo collection.
 const offset=candidates.length?crypto.getRandomValues(new Uint32Array(1))[0]%candidates.length:0;
 for(let i=0;i<Math.min(2,candidates.length);i++){
 const record=candidates[(offset+i)%candidates.length];const detail=await read(`https://api.inaturalist.org/v1/taxa/${record.id}?locale=zh-CN`);const p=detail.results?.[0];
 const summary=clean(p?.wikipedia_summary).slice(0,700),photo=p?.default_photo,license=licenses[photo?.license_code];
 if(!p||p.iconic_taxon_name!=='Plantae'||!summary||!/[\u3400-\u9fff]/.test(summary)||!license||!p.wikipedia_url)continue;
 const title=p.preferred_common_name||p.name;if(title===excluded)continue;
 const source=p.wikipedia_url.replace(/^http:/,'https:');
 const plant={title,summary,source,image:photo.medium_url,imageSource:`https://www.inaturalist.org/photos/${photo.id}`,author:photo.attribution_name||photo.attribution||'见图片来源',license:license[0],licenseUrl:license[1],recordSource:`https://www.inaturalist.org/taxa/${p.id}`};
 if(![plant.source,plant.image,plant.imageSource].every(v=>/^https:\/\//.test(v)))continue;
 return json({plant},{headers:{'Cache-Control':'no-store'}});
 }
 return json({error:'暂时未找到资料和授权图片齐全的花草，请换一株再试。'},{status:503});
 }catch{return json({error:'花草资料暂时连接不上，请稍后再试。'},{status:503});}
}
