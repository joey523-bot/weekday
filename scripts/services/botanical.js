const key='weekday:botanical-online:v1';
export const botanicalDay=(now=new Date())=>new Intl.DateTimeFormat('sv-SE').format(now);
export function validPlant(p){return p&&typeof p.title==='string'&&typeof p.summary==='string'&&typeof p.author==='string'&&typeof p.license==='string'&&['source','image','imageSource','licenseUrl'].every(k=>typeof p[k]==='string'&&/^https:\/\//.test(p[k]));}
export function readBotanicalCache(){try{const c=JSON.parse(localStorage.getItem(key));return validPlant(c?.plant)&&typeof c.day==='string'?c:null;}catch{return null;}}
export async function fetchBotanical(exclude=''){
 const r=await fetch('/api/botanical/today?'+new URLSearchParams({exclude}),{signal:AbortSignal.timeout(25000),cache:'no-store'});
 if(!r.ok)throw Error('花草资料暂时连接不上');const {plant,cached=false,collectedAt}=await r.json();
 if(!validPlant(plant)||plant.title===exclude)throw Error('暂时没有新的花草');
 const value={day:botanicalDay(),plant,cached,collectedAt};let persisted=true;try{localStorage.setItem(key,JSON.stringify(value));}catch{persisted=false;}
 return {...value,persisted};
}
