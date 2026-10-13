import { normalizeRepeat, repeatSummary, firstRepeatDate, nextRepeatDate, beijingDate, nextFixedOccurrence, fixedOccurrenceForDate } from '../utils/repeat.js';

export const hasMultipleTimes = rule => Array.isArray(rule?.times) && rule.times.length > 1;
const hourOptions = () => Array.from({length:24}, (_, hour) => `<option value="${hour}">${String(hour).padStart(2,'0')}:00</option>`).join('');

export function repeatDialogs() {
  return `<dialog id="repeatDialog" class="reminder-detail repeat-dialog" aria-labelledby="repeatHeading">
    <button id="repeatClose" class="reminder-detail__close" type="button" aria-label="关闭重复设置">×</button>
    <form id="repeatForm" class="stack-form">
      <h2 id="repeatHeading">重复设置</h2>
      <label class="field"><span class="field__label">重复周期</span><select id="repeatFrequency" class="select">
        <option value="none">不重复</option><option value="day">每天</option><option value="week">每周</option><option value="month">每月</option><option value="year">每年</option><option value="weekday">工作日</option><option value="custom">自定义</option>
      </select></label>
      <div id="repeatCustom" class="stack-form" hidden>
        <label class="field"><span class="field__label">计算方式</span><select id="repeatMode" class="select"><option value="fixed">固定周期</option><option value="after">完成后再间隔</option></select></label>
        <div class="split-grid"><label class="field"><span class="field__label">每隔</span><input id="repeatInterval" class="input" type="number" min="1" max="365" step="1" value="1" /></label><label class="field"><span class="field__label">单位</span><select id="repeatUnit" class="select"><option value="day">天</option><option value="week">周</option><option value="month">月</option></select></label></div>
      </div>
      <fieldset id="repeatWeek" class="repeat-week" hidden><legend>选择星期（可多选）</legend><div>${['一','二','三','四','五','六','日'].map((day,i)=>`<label><input type="checkbox" value="${i+1}" /><span>${day}</span></label>`).join('')}</div></fieldset>
      <label id="repeatWork" class="field" hidden><span class="field__label">工作日口径</span><select id="repeatWorkday" class="select"><option value="actual">法定工作日（含调休）</option><option value="weekdays">周一至周五</option></select></label>
      <div id="repeatDates" class="stack-form" hidden>
        <label class="field"><span class="field__label">开始日期</span><input id="repeatStart" class="input" type="date" /></label>
        <label class="field"><span class="field__label">当日提醒</span><select id="repeatDailyPattern" class="select"><option value="once">每天一次</option><option value="hourly">时段内每小时</option></select></label>
        <label id="repeatSingleTimeField" class="field"><span class="field__label">提醒时间（北京时间）</span><input id="repeatTime" class="input" type="time" step="60" /></label>
        <div id="repeatHourlyFields" class="stack-form" hidden>
          <div class="split-grid"><label class="field"><span class="field__label">开始时间</span><select id="repeatHourStart" class="select">${hourOptions()}</select></label><label class="field"><span class="field__label">结束时间</span><select id="repeatHourEnd" class="select">${hourOptions()}</select></label></div>
          <p id="repeatHourlyPreview" class="form-note" aria-live="polite"></p>
        </div>
        <label class="field"><span class="field__label">结束条件</span><select id="repeatEndType" class="select"><option value="never">永不结束</option><option value="date">到指定日期结束</option></select></label>
        <label id="repeatEndField" class="field" hidden><span class="field__label">结束日期（含当天）</span><input id="repeatEnd" class="input" type="date" /></label>
      </div>
      <p id="repeatModeNote" class="form-note"></p><p id="repeatError" class="form-note" role="alert"></p>
      <button type="submit" class="button button--primary">确认重复设置</button>
    </form>
  </dialog>
  <dialog id="repeatScopeDialog" class="reminder-detail repeat-dialog" aria-labelledby="repeatScopeHeading">
    <button id="repeatScopeClose" class="reminder-detail__close" type="button" aria-label="取消编辑">×</button>
    <div class="stack-form"><h2 id="repeatScopeHeading">编辑循环事项</h2><p class="form-note">选择本次修改的范围，历史记录保持不变。</p>
      <button type="button" class="button button--secondary" data-repeat-scope="once">仅本次</button><p id="repeatScopeOnceNote" class="form-note">调整当前事项的日期、时间和内容，后续仍按原规则。</p>
      <button type="button" class="button button--primary" data-repeat-scope="series">整个系列</button><p class="form-note">从当前未完成项及未来生效，可修改重复规则。</p>
    </div>
  </dialog>
  <dialog id="repeatResumeDialog" class="reminder-detail repeat-dialog" aria-labelledby="repeatResumeHeading">
    <button id="repeatResumeClose" class="reminder-detail__close" type="button" aria-label="取消重新启用">×</button>
    <div class="stack-form">
      <h2 id="repeatResumeHeading">重新启用循环</h2>
      <p id="repeatResumeNote" class="form-note"></p>
      <label id="repeatResumeDateField" class="field" hidden><span class="field__label">恢复后的首次事项日期（北京时间）</span><input id="repeatResumeDate" class="input" type="date" /></label>
      <p id="repeatResumePreview" class="repeat-resume-preview" aria-live="polite"></p>
      <p id="repeatResumeError" class="form-note" role="alert"></p>
      <button id="repeatResumeConfirm" class="button button--primary" type="button">确认启用</button>
      <button id="repeatResumeEdit" class="button button--secondary" type="button" hidden>先编辑</button>
      <button id="repeatResumeCancel" class="button button--secondary" type="button">取消</button>
    </div>
  </dialog>`;
}

export function bindRepeatSettings(root, refs, onChange) {
  const $ = id => root.querySelector(`#${id}`);
  let current = null, locked = false, stopped = false;
  const dialog = $('repeatDialog');
  const timeInput = $('reminderRepeatTime');
  function showSummary() {
    const multiple = hasMultipleTimes(current);
    $('reminderRepeatSummary').textContent = repeatSummary(current);
    $('reminderRepeatButton').disabled = locked;
    $('reminderRepeatScopeNote').textContent = stopped ? '已停用；保存修改后仍保持停用，重新启用后才会安排。' : locked ? multiple ? '仅修改当天的内容和推送开关；日期、时段和后续计划保持不变。调整日程请选择整个系列。' : '仅修改本次；重复规则与后续计划保持不变。' : current ? '日期由重复规则安排；如需调整，请打开重复设置。固定周期自动接续下次提醒。' : '';
    refs.reminderDateInput.disabled = Boolean(current && (!locked || multiple));
    refs.reminderLeadDaysInput.disabled = multiple;
    if (multiple) refs.reminderLeadDaysInput.value = '0';
    refs.reminderHourSelect.closest('label').hidden = Boolean(current);
    $('reminderRepeatTimeField').hidden = !current || multiple;
    timeInput.required = Boolean(current && !multiple);
    timeInput.disabled = multiple;
    if (current) timeInput.value = multiple ? current.times[0] : current.time;
    $('reminderHourlyNote').hidden = !multiple;
    $('reminderHourlyNote').textContent = multiple ? `${current.times[0]}—${current.times.at(-1)}，共${current.times.length}次，按北京时间每小时提醒。仅在事项当天提醒，不提前。` : '';
  }
  function options() {
    const freq = $('repeatFrequency').value, unit = $('repeatUnit').value, mode = $('repeatMode').value;
    const after = freq === 'custom' && mode === 'after';
    if (after) $('repeatDailyPattern').value = 'once';
    $('repeatDailyPattern').querySelector('option[value="hourly"]').disabled = after;
    const hourly = !after && $('repeatDailyPattern').value === 'hourly';
    $('repeatFrequency').querySelector('option[value="none"]').disabled = stopped;
    $('repeatCustom').hidden = freq !== 'custom';
    $('repeatWeek').hidden = !(freq === 'week' || freq === 'custom' && unit === 'week' && mode === 'fixed');
    $('repeatWork').hidden = freq !== 'weekday';
    $('repeatDates').hidden = freq === 'none';
    $('repeatEndField').hidden = freq === 'none' || $('repeatEndType').value !== 'date';
    $('repeatInterval').required = freq === 'custom';
    $('repeatInterval').disabled = freq !== 'custom';
    $('repeatStart').required = freq !== 'none';
    $('repeatTime').required = freq !== 'none' && !hourly;
    $('repeatTime').disabled = hourly;
    $('repeatSingleTimeField').hidden = hourly;
    $('repeatHourlyFields').hidden = !hourly;
    const first = Number($('repeatHourStart').value), last = Number($('repeatHourEnd').value);
    $('repeatHourlyPreview').textContent = last > first ? `北京时间 ${String(first).padStart(2,'0')}:00—${String(last).padStart(2,'0')}:00，每小时一次，含开始和结束时刻，共${last-first+1}次。仅在事项当天提醒。` : '结束时间须晚于开始时间，不支持跨午夜或仅一个时点。';
    $('repeatEnd').required = !$('repeatEndField').hidden;
    $('repeatModeNote').textContent = stopped ? '当前循环已停用。这里仅保存重复规则，保存后不会自动启用。' : freq === 'none' ? '普通事项只在所选日期提醒。' : freq === 'custom' && mode === 'after'
      ? '从实际完成日计算下一次；跳过从当天计算。未完成时不开始下一轮。'
      : hourly ? '同一天仍是一项。完成当天只记录一次历史，剩余提醒继续；跳过当天取消当天全部提醒。缺少对应日时跳过该期。' : '固定周期到点自动接续，不需要点完成。完成只记历史；跳过只取消所选这一次，缺少对应日时跳过该期。';
  }
  $('reminderRepeatButton').addEventListener('click', () => {
    if (locked) return;
    const r = current || {freq:'none', mode:'fixed', interval:1, unit:'day', weekdays:[new Date(`${refs.reminderDateInput.value || beijingDate()}T00:00:00Z`).getUTCDay() || 7], workday:'actual', startDate:refs.reminderDateInput.value || beijingDate(), time:`${String(refs.reminderHourSelect.value).padStart(2,'0')}:00`};
    for (const [id,key] of [['repeatFrequency','freq'],['repeatMode','mode'],['repeatInterval','interval'],['repeatUnit','unit'],['repeatWorkday','workday'],['repeatStart','startDate'],['repeatTime','time']]) $(id).value = r[key];
    $('repeatDailyPattern').value = hasMultipleTimes(r) ? 'hourly' : 'once';
    $('repeatHourStart').value = hasMultipleTimes(r) ? String(Number(r.times[0].slice(0,2))) : '8';
    $('repeatHourEnd').value = hasMultipleTimes(r) ? String(Number(r.times.at(-1).slice(0,2))) : '21';
    $('repeatEndType').value = r.endDate ? 'date' : 'never'; $('repeatEnd').value = r.endDate || '';
    $('repeatWeek').querySelectorAll('input').forEach(input => input.checked = r.weekdays.includes(Number(input.value)));
    $('repeatError').textContent = ''; options(); dialog.showModal();
  });
  $('repeatClose').addEventListener('click', () => dialog.close());
  $('repeatForm').addEventListener('change', options);
  $('repeatForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const previous = current;
      const freq = $('repeatFrequency').value;
      const mode = freq === 'custom' ? $('repeatMode').value : 'fixed';
      const hourly = freq !== 'none' && mode === 'fixed' && $('repeatDailyPattern').value === 'hourly';
      const first = Number($('repeatHourStart').value), last = Number($('repeatHourEnd').value);
      if (hourly && last <= first) throw new Error('结束时间须晚于开始时间，不支持跨午夜或仅一个时点。');
      const times = hourly ? Array.from({length:last-first+1}, (_, i) => `${String(first+i).padStart(2,'0')}:00`) : [];
      const schedule = hourly ? {
        template: {...current?.template, leadDays:0, time:times[0]},
        overrides: Object.fromEntries(Object.entries(current?.overrides || {}).map(([day, patch]) => [day,
          Object.fromEntries(Object.entries(patch).filter(([key]) => ['title','category','notes','notificationEnabled'].includes(key)))])),
        scheduledTime:times[0]
      } : {};
      const candidate = normalizeRepeat({ ...current, ...schedule, version:hourly ? 3 : current?.version || 2, freq, mode, times,
        interval:Number($('repeatInterval').value), unit:$('repeatUnit').value,
        weekdays:[...$('repeatWeek').querySelectorAll('input:checked')].map(input => Number(input.value)), workday:$('repeatWorkday').value,
        startDate:$('repeatStart').value, endDate:$('repeatEndType').value === 'date' ? $('repeatEnd').value : '', time:times[0] || $('repeatTime').value });
      if (candidate) {
        const changed = !previous || ['freq','mode','interval','unit','workday','startDate','endDate'].some(key => candidate[key] !== previous[key]) || JSON.stringify(candidate.weekdays) !== JSON.stringify(previous.weekdays);
        if (!candidate.seriesId || changed) {
          let next = firstRepeatDate(candidate);
          if (candidate.seriesId) {
            const earliest = candidate.scheduledDate || refs.reminderDateInput.value;
            if (candidate.mode === 'after') {
              const date = [refs.reminderDateInput.value, candidate.startDate].sort().at(-1);
              next = {date: candidate.endDate && date > candidate.endDate ? '' : date};
            } else if (next.date && next.date < earliest) {
              const before = new Date(Date.parse(`${earliest}T00:00:00Z`) - 86400000).toISOString().slice(0,10);
              next = nextRepeatDate({...candidate,status:'active'}, {afterDate:before,today:before});
            }
          }
          refs.reminderDateInput.value = next.date || (candidate.seriesId ? refs.reminderDateInput.value : candidate.startDate);
        }
        refs.reminderHourSelect.value = String(Number(candidate.time.slice(0,2)));
      }
      current = candidate;
      showSummary(); onChange?.(); dialog.close();
    } catch(error) { $('repeatError').textContent = error.message; }
  });
  timeInput.addEventListener('input', () => { if (current) current = { ...current, time:timeInput.value }; });
  showSummary();
  return {
    set(value, {lock = false, inactive = false} = {}) {
      current = value ? normalizeRepeat(value) : null;
      stopped = Boolean(current && (inactive || ['paused','ended'].includes(current.status)));
      locked = stopped ? false : lock;
      showSummary();
    },
    get() { return current ? normalizeRepeat({...current,time:hasMultipleTimes(current) ? current.times[0] : timeInput.value}) : null; },
    isRepeating() { return Boolean(current); },
    chooseScope(rule) {
      const scopeDialog = $('repeatScopeDialog');
      const multiple = hasMultipleTimes(rule);
      scopeDialog.querySelector('[data-repeat-scope="once"]').textContent = multiple ? '仅当天' : '仅本次';
      $('repeatScopeOnceNote').textContent = multiple ? '只修改所选当天的标题、分类、备注和推送开关。日期和提醒时段须通过整个系列修改；已保存的历史保持不变。' : '调整当前事项的日期、时间和内容，后续仍按原规则。';
      return new Promise(resolve => {
        let result = null;
        const click = event => { const button = event.target.closest('[data-repeat-scope]'); if (button) { result = button.dataset.repeatScope; scopeDialog.close(); } };
        const close = () => { scopeDialog.removeEventListener('click', click); resolve(result); };
        scopeDialog.addEventListener('click', click); scopeDialog.addEventListener('close', close, {once:true});
        $('repeatScopeClose').onclick = () => scopeDialog.close(); scopeDialog.showModal();
      });
    }
  };
}

export function isRepeatInactive(reminder, now = new Date()) {
  if (!reminder?.repeat || reminder.completed || reminder.repeat.status === 'history') return false;
  if (['paused','ended'].includes(reminder.repeat.status)) return true;
  return reminder.repeat.mode === 'fixed' && ['active','calendar_wait'].includes(reminder.repeat.status)
    && nextFixedOccurrence(reminder, now).status === 'ended';
}

export function repeatStatusLabel(reminder) {
  if (!reminder?.repeat) return '';
  if (reminder.repeat.status === 'history') return hasMultipleTimes(reminder.repeat) ? reminder.repeatOutcome === 'skipped' ? '当天已跳过' : '当天已完成' : reminder.repeatOutcome === 'skipped' ? '本次已跳过' : '本次已完成';
  if (isRepeatInactive(reminder)) return '已停用';
  return {active:'进行中',paused:'已停用',ended:'已停用',calendar_wait:'工作日日历待更新'}[reminder.repeat.status] || '';
}

// Presentation-only projection. Never write a projected cursor or terminal status to state.
export function displayReminder(reminder, { occurrenceDate = '', occurrenceTime = '', now = new Date(), reminders = [], resolveHistory = true } = {}) {
  if (!reminder?.repeat || reminder.repeat.mode !== 'fixed' || reminder.repeat.status === 'history') return reminder;
  const isRunning = ['active','calendar_wait'].includes(reminder.repeat.status);
  const next = isRunning ? nextFixedOccurrence(reminder, now) : {dueAt:'',occurrence:null};
  const histories = occurrenceDate && resolveHistory ? reminders.filter(item => item.repeat?.status === 'history'
    && item.repeat.seriesId === reminder.repeat.seriesId && item.repeat.scheduledDate === occurrenceDate) : [];
  const history = histories.find(item => item.repeatOutcome === 'skipped') || histories[0];
  const historyView = () => ({ ...history, notificationSlot:occurrenceTime, nextReminderAt: next.dueAt || '', nextNotificationEnabled: Boolean(next.occurrence?.notificationEnabled) });
  // Multi-time completion is a day record, not a replacement for a notification slot.
  if (history && (!hasMultipleTimes(reminder.repeat) || history.repeatOutcome === 'skipped')) return historyView();
  if (!isRunning && !occurrenceDate) return reminder;
  const source = isRunning ? reminder : { ...reminder, repeat:{...reminder.repeat,status:'active'} };
  const occurrence = occurrenceDate ? fixedOccurrenceForDate(source, occurrenceDate, hasMultipleTimes(reminder.repeat) ? occurrenceTime : '') : next.occurrence;
  if (!occurrence) {
    if (history) return historyView();
    if (occurrenceDate) throw new Error('这次提醒已跳过或不再属于当前循环，请查看历史记录或当前安排。');
    return { ...reminder, repeat: { ...reminder.repeat, status: next.status }, nextReminderAt: '' };
  }
  const recorded = reminders.filter(item => item.repeat?.status === 'history' && item.repeat.seriesId === reminder.repeat.seriesId
    && item.repeat.scheduledDate === occurrence.repeat.scheduledDate).sort((a,b) => Number(b.repeatOutcome === 'completed') - Number(a.repeatOutcome === 'completed'))[0];
  return { ...occurrence, repeat:{...occurrence.repeat,status:isRunning ? occurrence.repeat.status : reminder.repeat.status},
    nextReminderAt: next.dueAt || '', nextNotificationEnabled: Boolean(next.occurrence?.notificationEnabled), recordedOutcome: recorded?.repeatOutcome || '' };
}

export function nextReminderLabel(stamp, enabled = true) {
  if (!stamp) return '';
  const value = new Date(new Date(stamp).getTime() + 8 * 3600000).toISOString();
  return `${enabled ? '下次提醒' : '下次计划'} ${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日 ${value.slice(11,16)} 北京时间`;
}
