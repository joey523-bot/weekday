const key='weekday:botanical-online:v1';
export const botanicalDay=(now=new Date())=>new Intl.DateTimeFormat('sv-SE').format(now);
export function validPlant(p){return p&&typeof p.title==='string'&&typeof p.summary==='string'&&typeof p.author==='string'&&typeof p.license==='string'&&['source','image','imageSource','licenseUrl'].every(k=>typeof p[k]==='string'&&/^https:\/\//.test(p[k]));}
export function readBotanicalCache(){try{const c=JSON.parse(localStorage.getItem(key));return validPlant(c?.plant)&&typeof c.day==='string'?c:null;}catch{return null;}}
export async function fetchBotanical(exclude=''){
 const current=readBotanicalCache()?.plant;if(current)rememberPlant(current);
 const seen=readSeen();
 const r=await fetch('/api/botanical/today?'+new URLSearchParams({exclude,seen:JSON.stringify(seen)}),{signal:AbortSignal.timeout(25000),cache:'no-store'});
 if(!r.ok){let data;try{data=await r.json();}catch{}const e=Error(data?.code==='NO_UNSEEN_PLANTS'?'这批花草已经看过了，等资料源补充后再换一株。':'花草资料暂时连接不上');e.code=data?.code;throw e;}const {plant,cached=false,collectedAt}=await r.json();
 if(!validPlant(plant)||plant.title===exclude||seen.includes(plantKey(plant)))throw Error('暂时没有新的花草');
 rememberPlant(plant);
 const value={day:botanicalDay(),plant,cached,collectedAt};let persisted=true;try{localStorage.setItem(key,JSON.stringify(value));}catch{persisted=false;}
 return {...value,persisted};
}

const historyKey='weekday:botanical-seen:v1';
export function plantKey(p){const id=p.recordSource?.match(/\/taxa\/(\d+)/)?.[1];return id?'inat:'+id:p.title;}
export function readSeen(){try{const a=JSON.parse(localStorage.getItem(historyKey));return Array.isArray(a)?a.filter(s=>typeof s==='string').slice(-500):[];}catch{return [];}}
export function rememberPlant(p){const seen=readSeen(),id=plantKey(p);if(!seen.includes(id))seen.push(id);try{localStorage.setItem(historyKey,JSON.stringify(seen.slice(-500)));}catch{}return seen.slice(-500);}
