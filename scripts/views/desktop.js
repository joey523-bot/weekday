import { botanicalDay, readBotanicalCache, fetchBotanical } from '../services/botanical.js';
import { escapeHtml as esc, formatTemperature } from '../utils/format.js';
import { isWeatherFresh } from '../utils/lifestyle.js';
import { clockoutFor, normalizeClockout } from '../utils/clockout.js';
import { WEATHER_CODES } from '../config.js';

let selection=readBotanicalCache();
function plantMarkup(plant) {
 if(!plant)return '<p class="desktop-plant-line">正在找一株花草…</p>';
 return `<figure><a class="desktop-photo" href="${esc(plant.image)}" target="_blank" rel="noopener noreferrer" aria-label="查看${esc(plant.title)}完整图片"><img src="${esc(plant.image)}" alt="${esc(plant.title)}" width="1200" height="800" referrerpolicy="no-referrer"></a><small class="desktop-photo-hint">点击查看完整图片 ↗</small><figcaption><h3>${esc(plant.title)}</h3><p>${esc(plant.summary)}</p><details><summary>资料与图片来源</summary><p><a href="${esc(plant.source)}" target="_blank" rel="noopener noreferrer">知识摘要：维基百科（经 iNaturalist 获取）</a> · CC BY-SA</p><p><a href="${esc(plant.imageSource)}" target="_blank" rel="noopener noreferrer">${esc(plant.author)}</a> · <a href="${esc(plant.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(plant.license)}</a>；按原始比例完整展示。</p></details></figcaption></figure>`;
}
export function setupDesktop(root) {
 const stack=root.querySelector('.overview-stack');
 const panel=document.createElement('article');panel.className='desktop-only desktop-botanical desktop-card';panel.innerHTML='<header><h2>今日花草</h2><button type="button" data-next-plant>换一株 ↻</button></header><div data-plant-body></div><p class="desktop-plant-state" role="status"></p>';stack.append(panel);
 const weather=document.createElement('article');weather.className='desktop-only desktop-weather desktop-card';weather.innerHTML='<header><h2>接下来的天气</h2><button type="button" data-switch-view="weather">查看详情 ›</button></header><div id="desktopWeatherBody"></div>';stack.append(weather);
 const moon=document.createElement('article');moon.className='desktop-only desktop-moon desktop-card';moon.innerHTML='<header><h2>今晚的月亮</h2><button type="button" data-open-dialog="moonDetailDialog">详情 ›</button></header><div id="desktopMoonBody"></div>';stack.append(moon);
 const nav=document.createElement('nav');nav.className='desktop-only desktop-nav';nav.setAttribute('aria-label','桌面导航');nav.innerHTML='<button type="button" data-switch-view="overview">回到首页</button><button type="button" data-switch-view="settings">设置</button>';root.querySelector('.app-header').append(nav);
 const body=panel.querySelector('[data-plant-body]'),status=panel.querySelector('[role=status]'),button=panel.querySelector('[data-next-plant]');
 const heading=root.querySelector('#homeItemsTitle');
 const layoutLabel=()=>{heading.textContent=window.matchMedia('(min-width:1100px)').matches?'别忘了':'当前事项';};layoutLabel();window.matchMedia('(min-width:1100px)').addEventListener('change',layoutLabel);
 const paint=()=>{body.innerHTML=plantMarkup(selection?.plant);const image=body.querySelector('img');if(image)image.onerror=()=>{image.hidden=true;status.textContent='图片暂未加载，仍可阅读资料或查看来源。';};};
 let busy=false;
 async function load(force=false){
  if(busy||!window.matchMedia('(min-width:1100px)').matches)return;
  if(!force&&selection?.day===botanicalDay()){paint();if(selection.cached)status.textContent='最近收集的花草 · '+(selection.collectedAt||'');return;}
  busy=true;button.disabled=true;status.textContent='正在联网寻找花草…';
  try{selection=await fetchBotanical(selection?.plant.title||'');paint();status.textContent=selection.cached?'资料源暂忙，先看看最近收集的花草。':selection.persisted?'今天再次打开会保留这一株。':'已更新，浏览器暂时无法保存。';}
  catch(error){if(selection){paint();status.textContent=error.code==='NO_UNSEEN_PLANTS'?error.message:'暂时连接不上，先看看上次留下的花草。';}else{body.innerHTML='<p class="desktop-plant-line">花草资料暂不可用</p><p>稍后点“换一株”再试试。</p>';status.textContent='稍后再试，也可以先看看天气和月亮。';}}
  finally{busy=false;button.disabled=false;}
 }
 paint();button.addEventListener('click',()=>load(true));
 const visible=()=>{if(document.visibilityState==='visible')load();};
 document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
 window.matchMedia('(min-width:1100px)').addEventListener('change',visible);load();

}
export function renderDesktop(state, moonHtml) {
 const body=document.querySelector('#desktopWeatherBody');if(!body)return;
 const report=state.weather.status==='ready'&&isWeatherFresh(state.weather.payload)?state.weather.payload:null;
 if(!report){body.innerHTML=`<p class="desktop-weather-empty">${state.weather.status==='loading'?'天气更新中…':'天气暂不可用'}</p><p class="form-note">${state.weather.payload?'上次天气已过期，请更新后查看。':'定位或选择城市后，查看接下来的天气。'}</p><button class="button button--secondary" type="button" data-switch-view="weather">打开天气</button>`;}
 else {
 const local=new Intl.DateTimeFormat('sv-SE',{timeZone:report.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
 const upcoming=(report.hourlyForecast||[]).filter(h=>h.time>=local).slice(0,12);
 const result=clockoutFor(normalizeClockout(state.preferences.clockout));
 const departure=result.dueAt ? new Intl.DateTimeFormat('sv-SE',{timeZone:report.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(result.dueAt)).replace(' ','T') : '';
 const at=result.status==='countdown' && departure && upcoming.find(h=>h.time>=departure);
 const rain=upcoming.filter(h=>Number.isFinite(h.rainProbability));const peak=rain.length?Math.max(...rain.map(h=>h.rainProbability)):null;
 body.innerHTML=`<div class="desktop-weather-current"><strong>${formatTemperature(report.temperature)}</strong><div>${esc(report.city||'当前位置')}<p>${esc(WEATHER_CODES[report.weatherCode]||'天气')}</p></div></div><dl class="desktop-weather-lines"><div><dt>体感</dt><dd>${formatTemperature(report.apparentTemperature)}</dd></div><div><dt>下班前后</dt><dd>${at?`${esc(at.time.slice(11,16))} · ${formatTemperature(at.temperature)}${Number.isFinite(at.rainProbability)?` · 降雨概率 ${at.rainProbability}%`:''}`:'暂无对应时段预报'}</dd></div><div><dt>带伞参考</dt><dd>${peak===null?'暂无降雨概率数据':peak>=40?'接下来有降雨可能，带伞更安心。':'接下来降雨概率较低，出门留意变化。'}</dd></div></dl><div class="desktop-hours">${upcoming.filter((_,i)=>i%2===0).slice(0,3).map(h=>`<div><span>${esc(h.time.slice(11,16))}</span><strong>${formatTemperature(h.temperature)}</strong><small>${esc(WEATHER_CODES[h.weatherCode]||'天气')}</small></div>`).join('')||'<p>逐小时预报暂无数据</p>'}</div><p class="desktop-weather-updated">${esc(report.observedAt.slice(11,16))} 更新 · ${esc(report.source||'天气服务')}</p>`;
 }
 document.querySelector('#desktopMoonBody').innerHTML=moonHtml;
}
