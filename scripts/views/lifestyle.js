import { setupDesktop, renderDesktop } from './desktop.js';
import { greetingFor, moonFor, clothingFor, isWeatherFresh } from '../utils/lifestyle.js';
import { escapeHtml as esc, formatTemperature } from '../utils/format.js';
import { WEATHER_CODES } from '../config.js';

function dialog(root, id, title, nodes) {
  const el = document.createElement('dialog');
  el.id=id; el.className='lifestyle-dialog';
  el.setAttribute('aria-labelledby',`${id}Title`);
  el.innerHTML=`<header class="lifestyle-dialog-head"><h2 id="${id}Title">${title}</h2><button type="button" class="lifestyle-close" data-close-dialog aria-label="关闭">×</button></header><div class="lifestyle-dialog-body"></div>`;
  nodes.forEach(node=>{if(node)el.lastElementChild.append(node);});root.append(el);return el;
}
function entry(id,title,subtitle) {return `<button type="button" class="settings-entry" data-open-dialog="${id}"><span>${title}<small>${subtitle}</small></span><span aria-hidden="true">›</span></button>`;}

export function setupLifestyle(root) {
  const overview=root.querySelector('[data-view=overview]');
  const intro=overview.querySelector('.overview-intro');intro.classList.remove('sr-only');
  intro.innerHTML='<div class="home-topline"><div id="homeDate"></div><button id="homeWeather" type="button" data-switch-view="weather">查看天气 ›</button></div><h1 id="homeGreeting"></h1>';
  intro.querySelector('#homeDate').append(root.querySelector('#todayLabel'));
  root.querySelector('.app-header').classList.add('compact-app-header');
  const salary=overview.querySelector('.salary-snapshot');salary.classList.add('salary-compact');
  const salaryDetails=salary.querySelector('.salary-snapshot__details');
  dialog(root,'salaryDetailDialog','发薪详情',[salaryDetails]);
  salary.setAttribute('role','button');salary.tabIndex=0;salary.dataset.openDialog='salaryDetailDialog';salary.setAttribute('aria-label','查看发薪详情');
  const moonButton=document.createElement('button');moonButton.id='homeMoon';moonButton.type='button';moonButton.className='home-moon';moonButton.dataset.openDialog='moonDetailDialog';salary.after(moonButton);
  const moonDialog=dialog(root,'moonDetailDialog','追月亮',[]);moonDialog.lastElementChild.id='moonDetailBody';
  const board=overview.querySelector('#board');board.querySelector('.section-title').id='homeItemsTitle';
  board.querySelector('.section-title').textContent='当前事项';
  board.after(root.querySelector('#cycleSuggestions'),root.querySelector('#cycleFeedback'));
  overview.querySelector('.xm-weather-card')?.remove();

  setupDesktop(root);
  const reminders=root.querySelector('[data-view=reminders]');reminders.querySelector('.page-intro').remove();
  reminders.querySelector('.section-head h2').textContent='事项';
  const settings=root.querySelector('[data-view=settings]');settings.querySelector('.page-intro p')?.remove();
  const grid=settings.querySelector('.settings-grid');
  const appearance=root.querySelector('.appearance-card'), cycle=root.querySelector('.cycle-settings-card');
  const salaryCard=root.querySelector('#salaryForm').closest('article'),pushCard=root.querySelector('#pushEnableButton').closest('article');
  const account=root.querySelector('.cloud-backup-card'), maintenance=root.querySelector('.data-note');
  const pushLabel=root.querySelector('#cyclePushEnabled').closest('label');
  const pushDescription=pushLabel.nextElementSibling;pushCard.append(pushLabel,pushDescription);
  const pushFeedback=document.createElement('p');pushFeedback.id='cyclePushState';pushFeedback.className='form-note';pushFeedback.setAttribute('role','status');pushCard.append(pushFeedback);
  dialog(root,'settingsAccount','账号与同步',[account]);
  dialog(root,'settingsReminders','提醒设置',[pushCard]);
  dialog(root,'settingsCycle','周期建议管理',[cycle]);
  dialog(root,'settingsSalary','发薪设置',[salaryCard]);
  dialog(root,'settingsAppearance','外观与主题',[appearance]);
  const test=root.querySelector('#pushTestButton');
  const help=dialog(root,'settingsHelp','帮助与版本',[maintenance,test]);
  const version=document.createElement('p');version.className='form-note';version.textContent='星期 · '+document.querySelector('meta[name=application-version]').content;help.lastElementChild.prepend(version);
  grid.innerHTML=`<div class="settings-summary"><strong>账号与同步</strong><p id="settingsAccountSummary" class="form-note">正在同步…</p>${entry('settingsAccount','管理账号','同步状态、密码与退出登录')}</div><div class="settings-entry-group">${entry('settingsReminders','提醒设置','当前设备通知、发薪与周期建议推送')}${entry('settingsCycle','周期建议管理','同类事项、实际发生记录与排除规则')}${entry('settingsSalary','发薪设置','日期、收入与到账账户')}</div><div class="settings-entry-group">${entry('settingsAppearance','外观与主题','主题与照片')}${entry('settingsHelp','帮助与版本','测试通知与刷新应用资源')}</div>`;
  // Existing occurrences share the same close target so cancellation remains intact.
  const cancel=root.querySelector('#occurrenceCancel');cancel.textContent='×';cancel.className='lifestyle-close';cancel.setAttribute('aria-label','关闭');
  root.querySelector('#occurrenceDialog form').prepend(cancel);
  root.addEventListener('click',event=>{
    const open=event.target.closest('[data-open-dialog]');
    if(open){const el=document.getElementById(open.dataset.openDialog);if(el&&!el.open)el.showModal();}
    if(event.target.closest('[data-close-dialog]'))event.target.closest('dialog')?.close();
  });
  salary.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('salaryDetailDialog').showModal();}});
}
function moonPicture(info){
  if(!info)return '';
  const light=info.illumination/100;const k=Math.abs(2*light-1);const waxing=info.phase<0.5;
  // Orthographic phase disk: a semicircle plus the illuminated/shadowed terminator ellipse.
  return `<svg class="moon-picture" viewBox="0 0 100 100" role="img" aria-label="${esc(info.name)}，照亮${info.illumination}%"><circle cx="50" cy="50" r="48" fill="#394440"/><path d="M50 2 A48 48 0 0 ${waxing?1:0} 50 98 Z" fill="#ede9cd"/><ellipse cx="50" cy="50" rx="${48*k}" ry="48" fill="${light>=.5?'#ede9cd':'#394440'}"/></svg>`;
}
const timeLabel=(value,date)=>value ? `${value.slice(0,10)===date?'今天':'明天'}${value.slice(11,16)}`:'暂无记录';
export function renderMoon(report) {
  const moon=moonFor(report);
  if(!moon)return '<p class="form-note">月相暂不可用，请更新天气后再试。</p>';
  return `<div class="moon-heading">${moonPicture(moon)}<div><h3>${esc(moon.name)}</h3><p>照亮约${moon.illumination}%</p><small>当地${esc(moon.date)}月相示意</small></div></div><dl class="moon-metrics"><div><dt>月出</dt><dd>${esc(timeLabel(moon.rise,moon.date))}</dd></div><div><dt>月落</dt><dd>${esc(timeLabel(moon.set,moon.date))}</dd></div><div><dt>今晚18—23点云量</dt><dd>${moon.cloud===null?'暂无数据':`约${moon.cloud}%`}</dd></div><div><dt>观赏提示</dt><dd>${moon.cloud===null?'留意实际云层':moon.cloud>=70?'云较多，可能遮挡':'仍需留意局部云层'}</dd></div></dl><p class="form-note">月落展示本次月出之后的时间；月出不一定在夜间；月相图不表示当地天空中的旋转角度。天气与地形也会影响实际可见性。</p>`;
}
export function renderOutfit(report){
 const outfit=clothingFor(report);if(!outfit)return '';
 return `<section class="weather-section outfit-section"><h2>今天怎么穿</h2><p>${esc(outfit.title)}</p><p class="form-note">${esc(outfit.basis)}</p><div class="outfit-preview"><img src="./assets/outfits/${outfit.kind}.svg" alt="${esc(outfit.title)}搭配示意" width="200" height="170"/><div><strong>日常搭配参考</strong><p>${esc(outfit.detail)}</p><small>示意图，不限定性别或穿搭风格</small></div></div></section>`;
}
export function renderLifestyle(state) {
 const candidate=state.weather.status==='ready'?state.weather.payload:null;
 const report=isWeatherFresh(candidate)?candidate:null;
 const greeting=document.querySelector('#homeGreeting');if(!greeting)return;
 greeting.textContent=greetingFor({salaryDay:state.salary.day,weather:report});
 const mini=document.querySelector('#homeWeather');
 mini.innerHTML=report ? `${esc(WEATHER_CODES[report.weatherCode]||'天气')} ${formatTemperature(report.temperature)}<small>当前UV ${report.uvIndex==null?'暂无':Number(report.uvIndex).toFixed(1)} ›</small>` : `${state.weather.status==='loading'?'天气更新中':'查看天气'} ›`;
 const moon=moonFor(candidate);const button=document.querySelector('#homeMoon');
 button.innerHTML=moon ? `${moonPicture(moon)}<span>追月亮 · ${esc(moon.name)}<small>月出 ${esc(timeLabel(moon.rise,moon.date))}</small></span><span aria-hidden="true">›</span>`:'<span>追月亮<small>更新天气，查看当地月相与月出</small></span><span aria-hidden="true">›</span>';
 document.querySelector('#moonDetailBody').innerHTML=renderMoon(candidate);
 renderDesktop(state, renderMoon(candidate));
 document.querySelector('#settingsAccountSummary').textContent=[document.querySelector('#accountStatusBadge')?.textContent,document.querySelector('#accountUsername')?.textContent].filter(Boolean).join(' · ');
}
