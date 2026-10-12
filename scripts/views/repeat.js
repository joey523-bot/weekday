import { normalizeRepeat, repeatSummary, firstRepeatDate, nextRepeatDate, beijingDate, nextFixedOccurrence, fixedOccurrenceForDate } from '../utils/repeat.js';

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
        <div class="split-grid"><label class="field"><span class="field__label">开始日期</span><input id="repeatStart" class="input" type="date" /></label><label class="field"><span class="field__label">提醒时间（北京时间）</span><input id="repeatTime" class="input" type="time" step="60" /></label></div>
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
      <button type="button" class="button button--secondary" data-repeat-scope="once">仅本次</button><p class="form-note">调整当前事项的日期、时间和内容，后续仍按原规则。</p>
      <button type="button" class="button button--primary" data-repeat-scope="series">整个系列</button><p class="form-note">从当前未完成项及未来生效，可修改重复规则。</p>
    </div>
  </dialog>`;
}

export function bindRepeatSettings(root, refs, onChange) {
  const $ = id => root.querySelector(`#${id}`);
  let current = null, locked = false;
  const dialog = $('repeatDialog');
  const timeInput = $('reminderRepeatTime');
  function showSummary() {
    $('reminderRepeatSummary').textContent = repeatSummary(current);
    $('reminderRepeatButton').disabled = locked;
    $('reminderRepeatScopeNote').textContent = locked ? '仅修改本次；重复规则与后续计划保持不变。' : current ? '日期由重复规则安排；如需调整，请打开重复设置。固定周期自动接续下次提醒。' : '';
    refs.reminderDateInput.disabled = Boolean(current && !locked);
    refs.reminderHourSelect.closest('label').hidden = Boolean(current);
    $('reminderRepeatTimeField').hidden = !current;
    timeInput.required = Boolean(current);
    if (current) timeInput.value = current.time;
  }
  function options() {
    const freq = $('repeatFrequency').value, unit = $('repeatUnit').value, mode = $('repeatMode').value;
    $('repeatCustom').hidden = freq !== 'custom';
    $('repeatWeek').hidden = !(freq === 'week' || freq === 'custom' && unit === 'week' && mode === 'fixed');
    $('repeatWork').hidden = freq !== 'weekday';
    $('repeatDates').hidden = freq === 'none';
    $('repeatEndField').hidden = freq === 'none' || $('repeatEndType').value !== 'date';
    $('repeatInterval').required = freq === 'custom';
    $('repeatInterval').disabled = freq !== 'custom';
    $('repeatStart').required = $('repeatTime').required = freq !== 'none';
    $('repeatEnd').required = !$('repeatEndField').hidden;
    $('repeatModeNote').textContent = freq === 'none' ? '普通事项只在所选日期提醒。' : freq === 'custom' && mode === 'after'
      ? '从实际完成日计算下一次；跳过从当天计算。未完成时不开始下一轮。'
      : '固定周期到点自动接续，不需要点完成。完成只记历史；跳过只取消所选这一次，缺少对应日时跳过该期。';
  }
  $('reminderRepeatButton').addEventListener('click', () => {
    if (locked) return;
    const r = current || {freq:'none', mode:'fixed', interval:1, unit:'day', weekdays:[new Date(`${refs.reminderDateInput.value || beijingDate()}T00:00:00Z`).getUTCDay() || 7], workday:'actual', startDate:refs.reminderDateInput.value || beijingDate(), time:`${String(refs.reminderHourSelect.value).padStart(2,'0')}:00`};
    for (const [id,key] of [['repeatFrequency','freq'],['repeatMode','mode'],['repeatInterval','interval'],['repeatUnit','unit'],['repeatWorkday','workday'],['repeatStart','startDate'],['repeatTime','time']]) $(id).value = r[key];
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
      const candidate = normalizeRepeat({ ...current, freq:$('repeatFrequency').value, mode:$('repeatMode').value,
        interval:Number($('repeatInterval').value), unit:$('repeatUnit').value,
        weekdays:[...$('repeatWeek').querySelectorAll('input:checked')].map(input => Number(input.value)), workday:$('repeatWorkday').value,
        startDate:$('repeatStart').value, endDate:$('repeatEndType').value === 'date' ? $('repeatEnd').value : '', time:$('repeatTime').value });
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
    set(value, {lock = false} = {}) { current = value ? normalizeRepeat(value) : null; locked = lock; showSummary(); },
    get() { return current ? normalizeRepeat({...current,time:timeInput.value}) : null; },
    isRepeating() { return Boolean(current); },
    chooseScope() {
      const scopeDialog = $('repeatScopeDialog');
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

export function repeatStatusLabel(reminder) {
  if (!reminder?.repeat) return '';
  if (reminder.repeat.status === 'history') return reminder.repeatOutcome === 'skipped' ? '本次已跳过' : '本次已完成';
  return {active:'进行中',paused:'已暂停',ended:'循环已结束',calendar_wait:'工作日日历待更新'}[reminder.repeat.status] || '';
}

// Presentation-only projection. Never write a projected cursor or terminal status to state.
export function displayReminder(reminder, { occurrenceDate = '', now = new Date(), reminders = [], resolveHistory = true } = {}) {
  if (!reminder?.repeat || reminder.repeat.mode !== 'fixed' || reminder.repeat.status === 'history') return reminder;
  const isRunning = ['active','calendar_wait'].includes(reminder.repeat.status);
  const next = isRunning ? nextFixedOccurrence(reminder, now) : {dueAt:'',occurrence:null};
  const history = occurrenceDate && resolveHistory ? reminders.find(item => item.repeat?.status === 'history'
    && item.repeat.seriesId === reminder.repeat.seriesId && item.repeat.scheduledDate === occurrenceDate) : null;
  if (history) return { ...history, nextReminderAt: next.dueAt || '' };
  if (!isRunning && !occurrenceDate) return reminder;
  const source = isRunning ? reminder : { ...reminder, repeat:{...reminder.repeat,status:'active'} };
  const occurrence = occurrenceDate ? fixedOccurrenceForDate(source, occurrenceDate) : next.occurrence;
  if (!occurrence) {
    if (occurrenceDate) throw new Error('这次提醒已跳过或不再属于当前循环，请查看历史记录或当前安排。');
    return { ...reminder, repeat: { ...reminder.repeat, status: next.status }, nextReminderAt: '' };
  }
  const recorded = reminders.find(item => item.repeat?.status === 'history' && item.repeat.seriesId === reminder.repeat.seriesId
    && item.repeat.scheduledDate === occurrence.repeat.scheduledDate);
  return { ...occurrence, repeat:{...occurrence.repeat,status:isRunning ? occurrence.repeat.status : reminder.repeat.status},
    nextReminderAt: next.dueAt || '', recordedOutcome: recorded?.repeatOutcome || '' };
}

export function nextReminderLabel(stamp) {
  if (!stamp) return '';
  const value = new Date(new Date(stamp).getTime() + 8 * 3600000).toISOString();
  return `下次提醒 ${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日 ${value.slice(11,16)} 北京时间`;
}
