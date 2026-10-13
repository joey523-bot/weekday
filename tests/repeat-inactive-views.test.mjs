import assert from 'node:assert/strict';
import test from 'node:test';
import { REMINDER_FILTERS } from '../scripts/config.js';
import { displayReminder, isRepeatInactive, repeatStatusLabel, repeatDialogs } from '../scripts/views/repeat.js';
import { applyFilter, renderReminderBoard, renderOverviewReminderPreview } from '../scripts/views/render.js';

const rule = (status, changes={}) => ({version:2,seriesId:`series-${status}`,freq:'day',mode:'fixed',interval:1,unit:'day',weekdays:[1],workday:'actual',startDate:'2000-01-01',endDate:'',time:'09:15',status,scheduledDate:'2000-01-01',template:{title:'循环',category:'其他',notes:'',leadDays:0,notificationEnabled:true,time:'09:15'},...changes});
const item = (id, status, changes={}) => ({id,title:`循环${id}`,date:'2000-01-01',category:'其他',notes:'',leadDays:0,hour:9,completed:false,notificationEnabled:true,...(status ? {repeat:rule(status,changes)} : {})});
const paused=item('paused','paused'), ended=item('ended','ended');
const elapsed=item('elapsed','active',{endDate:'2000-01-02'});
const historical={...item('history','history'),completed:true,repeatOutcome:'completed',occurredOn:'2000-01-01'};
const ordinary=item('ordinary');
const waiting=item('waiting','calendar_wait',{freq:'weekday',startDate:'2099-01-01',scheduledDate:'2099-01-01'});
const records=[ordinary,item('active','active'),paused,ended,elapsed,historical,waiting];
const state=filter=>({reminders:records,preferences:{reminderFilter:filter}});
const refs=()=>({reminderCount:{},reminderFilters:{},reminderBoardMeta:{},filters:[],reminderList:{},overviewReminderCount:{},overviewReminderList:{}});

test('inactive includes legacy pause/end and elapsed schedules, while history and unknown calendars retain their meaning',()=>{
  assert.equal(isRepeatInactive(paused),true);assert.equal(isRepeatInactive(ended),true);
  assert.equal(isRepeatInactive(elapsed),true);assert.equal(isRepeatInactive(historical),false);
  assert.equal(isRepeatInactive(waiting),false);assert.equal(isRepeatInactive(ordinary),false);
  const before=structuredClone(elapsed),display=displayReminder(elapsed);
  assert.equal(display.repeat.status,'ended');assert.equal(repeatStatusLabel(display),'已停用');
  assert.deepEqual(elapsed,before);
});

test('inactive items leave pending and overdue, without mixing with completion history',()=>{
  assert.deepEqual(applyFilter(records,REMINDER_FILTERS.inactive).map(x=>x.id),['paused','ended','elapsed']);
  assert.deepEqual(applyFilter(records,REMINDER_FILTERS.completed).map(x=>x.id),['history']);
  for(const filter of [REMINDER_FILTERS.all,REMINDER_FILTERS.overdue]) {
    const ids=applyFilter(records,filter).map(x=>x.id);
    for(const id of ['paused','ended','elapsed','history']) assert.equal(ids.includes(id),false);
    assert.equal(ids.includes('ordinary'),true);
  }
});

test('inactive board offers edit and re-enable without old time groups or countdown, and home excludes them',()=>{
  const target=refs();renderReminderBoard(state(REMINDER_FILTERS.inactive),target);
  const html=target.reminderList.innerHTML;
  assert.equal(target.reminderCount.textContent,'3 条');
  assert.doesNotMatch(html,/reminder-time-group|class="countdown"|2000|已逾期|下次提醒/);
  assert.equal((html.match(/data-action="repeat-resume"/g)||[]).length,3);
  assert.equal((html.match(/data-action="edit"/g)||[]).length,3);
  assert.match(html,/已停用，不再安排提醒/);
  renderOverviewReminderPreview(state(REMINDER_FILTERS.all),target);
  for(const id of ['paused','ended','elapsed','history']) assert.doesNotMatch(target.overviewReminderList.innerHTML,new RegExp(`data-reminder-detail="${id}"`));
});

test('re-enable dialog has separate date, preview, explicit confirm, edit and cancel controls',()=>{
  const markup=repeatDialogs();
  for(const id of ['repeatResumeDialog','repeatResumeClose','repeatResumeDateField','repeatResumeDate','repeatResumePreview','repeatResumeNote','repeatResumeError','repeatResumeConfirm','repeatResumeEdit','repeatResumeCancel']) assert.match(markup,new RegExp(`id="${id}"`));
  assert.match(markup,/恢复后的首次事项日期/);
});
