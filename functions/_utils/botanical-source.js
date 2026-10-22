const licenses={cc0:['CC0','https://creativecommons.org/publicdomain/zero/1.0/'],'cc-by':['CC BY','https://creativecommons.org/licenses/by/4.0/'],'cc-by-sa':['CC BY-SA','https://creativecommons.org/licenses/by-sa/4.0/']};
const clean=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&[^;]+;/g,' ').trim();
async function read(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Weekday botanical discovery/1.0'},signal:AbortSignal.timeout(5500)});if(!r.ok){const e=Error('source unavailable');e.code='source_http_'+r.status;throw e;}return r.json();}
export function normalized(p){
 const summary=clean(p?.wikipedia_summary).slice(0,700),photo=p?.default_photo,license=licenses[photo?.license_code];
 if(p?.iconic_taxon_name!=='Plantae'||!summary||!/[\u3400-\u9fff]/.test(summary)||!license||!p.wikipedia_url)return null;
 const plant={title:p.preferred_common_name||p.name,summary,source:p.wikipedia_url.replace(/^http:/,'https:'),image:photo.medium_url,imageSource:`https://www.inaturalist.org/photos/${photo.id}`,author:photo.attribution_name||photo.attribution||'见图片来源',license:license[0],licenseUrl:license[1],recordSource:`https://www.inaturalist.org/taxa/${p.id}`};
 return [plant.source,plant.image,plant.imageSource].every(v=>/^https:\/\//.test(v))?plant:null;
}

export async function onlineBatch(excluded=new Set(),page=1+crypto.getRandomValues(new Uint32Array(1))[0]%20){
 const search=new URL('https://api.inaturalist.org/v1/taxa');search.search=new URLSearchParams({iconic_taxa:'Plantae',rank:'species',order_by:'observations_count',per_page:'50',page:String(page),locale:'zh-CN'});
 const {results=[]}=await read(search);
 const candidates=results.filter(p=>p.iconic_taxon_name==='Plantae'&&/[\u3400-\u9fff]/.test(p.preferred_common_name||'')&&!excluded.has('inat:'+p.id)&&!excluded.has(p.preferred_common_name)&&licenses[p.default_photo?.license_code]);
 if(!candidates.length)return [];
 const ids=candidates.slice(0,25).map(p=>p.id).join(',');
 const detail=await read(`https://api.inaturalist.org/v1/taxa/${ids}?locale=zh-CN`);
 return (detail.results||[]).map(normalized).filter(Boolean).filter(p=>!excluded.has(plantKey(p))&&!excluded.has(p.title));
}
export function plantKey(p){const id=p.recordSource?.match(/\/taxa\/(\d+)/)?.[1];return id?'inat:'+id:p.title;}
