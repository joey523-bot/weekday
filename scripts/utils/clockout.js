import { isChinaWorkday } from './workday-calendar.js';
export const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const minute = value => Number(value.slice(0,2))*60+Number(value.slice(3));
export const timeText = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
export function clockDate(now = new Date()) { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now); }
export function clockTime(now = new Date()) { return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now); }
export function validDate(value) {return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function normalizeDay(raw) {
 const start=validTime(raw?.start)?raw.start:'09:00', end=validTime(raw?.end)&&minute(raw.end)>minute(start)?raw.end:'18:00';
 return {kind:['auto','work','overtime','rest'].includes(raw?.kind)?raw.kind:'auto',start,end:minute(end)>minute(start)?end:'23:59'};
}
export function normalizeClockout(raw) {
 const entries = (obj,check,convert) => Object.fromEntries(Object.entries(obj||{}).filter(([key,value])=>validDate(key)&&check(value)).slice(-400).map(([key,value])=>[key,convert(value)]));
 return {version:1,enabled:true,mode:raw?.mode==='fixed'?'fixed':'flex',pushEnabled:raw?.pushEnabled!==false,
 week:Array.from({length:7},(_,i)=>normalizeDay(raw?.week?.[i])),
 dates:entries(raw?.dates,value=>value&&typeof value==='object',normalizeDay), records:entries(raw?.records,validTime,value=>value)};
}
export function clockoutFor(raw,date=clockDate(),now=new Date()) {
 const settings=normalizeClockout(raw);if(!settings.enabled)return {status:'disabled'};
 if(!validDate(date))return {status:'invalid',message:'请选择有效日期'};
 const weekday=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
 const override=settings.dates[date],day=override||settings.week[weekday];
 if(day.kind==='rest')return {status:'rest',day};
 if(day.kind==='auto') {try {const [year,month,d]=date.split('-').map(Number);if(!isChinaWorkday({year,month,day:d}))return {status:'rest',day};}catch(error){return {status:'calendar_wait',message:error.message,day};}}
 const record=settings.records[date];if(!record)return {status:'missing',day};
 const end=minute(day.end)+(override||day.kind==='overtime'||settings.mode==='fixed'?0:Math.max(0,minute(record)-minute(day.start)));
 if(end>=1440)return {status:'invalid',message:'下班时间超出当天，请手动调整',day,record};
 const time=timeText(end),dueAt=`${date}T${time}:00+08:00`,remaining=Math.ceil((Date.parse(dueAt)-now.getTime())/60000);
 return {status:remaining<=0?'due':'countdown',time,dueAt,remaining,day,record,source:override?'仅此日期':day.kind==='overtime'?'固定加班':settings.mode==='fixed'?'固定时间':'弹性时间'};
}
