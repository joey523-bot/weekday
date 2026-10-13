import { isChinaWorkday, CalendarUnavailableError } from './workday-calendar.js';

const DAY = 86400000;
export const beijingDate = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function validRepeatDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const dateNumber = value => Date.parse(`${value}T00:00:00Z`);
const dateKey = stamp => new Date(stamp).toISOString().slice(0, 10);
const parts = value => { const [year, month, day] = value.split('-').map(Number); return { year, month, day }; };

export function normalizeRepeat(value) {
  if (!value || value.freq === 'none') return null;
  const version = value.version ?? 1;
  if (![1, 2, 3].includes(version)) throw new Error('重复规则版本不受支持，请更新应用');
  if (!['day', 'week', 'month', 'year', 'weekday', 'custom'].includes(value.freq)) throw new Error('请选择有效的重复周期');
  if (!validRepeatDate(value.startDate)) throw new Error('请选择循环开始日期');
  if (value.endDate && (!validRepeatDate(value.endDate) || value.endDate < value.startDate)) throw new Error('结束日期不能早于开始日期');
  const interval = Number(value.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error('间隔须为1—365的整数');
  const unit = value.unit || 'day';
  if (!['day', 'week', 'month'].includes(unit)) throw new Error('请选择天、周或月');
  const mode = value.freq === 'custom' && value.mode === 'after' ? 'after' : 'fixed';
  if (value.times !== undefined && !Array.isArray(value.times)) throw new Error('每日提醒时点格式无效');
  const times = [...new Set(value.times || [])].sort();
  if (times.length) {
    if (version !== 3) throw new Error('每日多时点需要新版重复规则');
    if (mode === 'after' || value.mode === 'after') throw new Error('完成后间隔不能设置每日多时点');
    if (times.length < 2 || times.length > 24 || times.some(time => typeof time !== 'string' || !/^([01]\d|2[0-3]):00$/.test(time))) throw new Error('请选择2—24个连续整点');
    if (times.some((time, index) => index > 0 && Number(time.slice(0, 2)) !== Number(times[index - 1].slice(0, 2)) + 1)) throw new Error('每日提醒时点必须为同一天的连续整点');
  }
  const weekdays = [...new Set(value.weekdays || [new Date(dateNumber(value.startDate)).getUTCDay() || 7])].map(Number).sort((a, b) => a - b);
  if (weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) || ((value.freq === 'week' || (value.freq === 'custom' && unit === 'week' && mode === 'fixed')) && !weekdays.length)) throw new Error('请至少选择一个有效星期');
  const time = value.time || '09:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择有效提醒时间');
  const status = value.status || 'active';
  if (!['active', 'paused', 'ended', 'calendar_wait', 'history'].includes(status)) throw new Error('循环状态无效');
  if (value.scheduledDate && !validRepeatDate(value.scheduledDate)) throw new Error('期次日期无效');
  if (value.scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.scheduledTime)) throw new Error('期次时点无效');
  if (value.waitingAfterDate && !validRepeatDate(value.waitingAfterDate)) throw new Error('待排期锚点无效');
  const rawTemplate = value.template && typeof value.template === 'object' && !Array.isArray(value.template) ? value.template : {};
  const template = {};
  for (const key of ['title','category','notes']) if (Object.hasOwn(rawTemplate,key)) template[key] = String(rawTemplate[key]);
  if (Object.hasOwn(rawTemplate,'time')) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTemplate.time)) throw new Error('系列提醒时间无效');
    template.time = rawTemplate.time;
  }
  if (Object.hasOwn(rawTemplate,'leadDays')) {
    const lead = Number(rawTemplate.leadDays);
    if (!Number.isInteger(lead) || lead < 0 || lead > 365) throw new Error('系列提前提醒天数无效');
    template.leadDays = lead;
  }
  if (Object.hasOwn(rawTemplate,'notificationEnabled')) template.notificationEnabled = rawTemplate.notificationEnabled === true;
  const overrides = {};
  for (const [day, raw] of Object.entries(value.overrides || {})) {
    if (!validRepeatDate(day) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('本次修改的期次无效');
    const patch = {};
    for (const key of ['title','category','notes']) if (Object.hasOwn(raw,key)) patch[key] = String(raw[key]);
    if (Object.hasOwn(raw,'date')) { if (!validRepeatDate(raw.date)) throw new Error('本次修改的日期无效'); patch.date = raw.date; }
    if (Object.hasOwn(raw,'time')) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) throw new Error('本次修改的时间无效'); patch.time = raw.time; }
    if (Object.hasOwn(raw,'leadDays')) { const lead = Number(raw.leadDays); if (!Number.isInteger(lead) || lead < 0 || lead > 365) throw new Error('提前提醒天数无效'); patch.leadDays = lead; }
    if (Object.hasOwn(raw,'notificationEnabled')) patch.notificationEnabled = raw.notificationEnabled === true;
    if (times.length && ((patch.date && patch.date !== day) || (patch.time && !times.includes(patch.time)))) throw new Error('每日多时点不能单独移动日期或时点');
    if (times.length && Number(patch.leadDays || 0) !== 0) throw new Error('每日多时点仅支持当天提醒');
    overrides[day] = patch;
  }
  if (times.length && Number(template.leadDays || 0) !== 0) throw new Error('每日多时点仅支持当天提醒');
  const skippedDates = [...new Set(value.skippedDates || [])];
  if (skippedDates.some(day => !validRepeatDate(day))) throw new Error('跳过的期次无效');
  const resumeAfter = value.resumeAfter || '';
  if (resumeAfter && !Number.isFinite(Date.parse(resumeAfter))) throw new Error('恢复时间无效');
  return { version, seriesId: typeof value.seriesId === 'string' ? value.seriesId : '', freq: value.freq,
    mode, interval, unit, weekdays, workday: value.workday === 'weekdays' ? 'weekdays' : 'actual',
    startDate: value.startDate, endDate: value.endDate || '', time, times, status,
    scheduledDate: value.scheduledDate || '', scheduledTime: value.scheduledTime || '', waitingAfterDate: value.waitingAfterDate || '', template, overrides, skippedDates, resumeAfter };
}

export function repeatTimes(value) {
  const rule = normalizeRepeat(value);
  return rule ? (rule.times.length ? [...rule.times] : [rule.time]) : [];
}

function resolved(rule, date) {
  if (!date || (rule.endDate && date > rule.endDate)) return { date: '', status: 'ended' };
  return { date, status: 'active' };
}
function scan(rule, threshold, inclusive = false) {
  const start = dateNumber(rule.startDate);
  const from = Math.max(start, dateNumber(threshold) + (inclusive ? 0 : DAY));
  const limit = rule.endDate ? dateNumber(rule.endDate) : Date.UTC(9999, 11, 31);
  const anchor = parts(rule.startDate);
  const interval = rule.freq === 'custom' ? rule.interval : 1;
  const unit = rule.freq === 'custom' ? rule.unit : rule.freq;
  if (unit === 'month' || unit === 'year') {
    const stride = unit === 'year' ? 12 : interval;
    const fromParts = parts(dateKey(from));
    const monthDistance = (fromParts.year - anchor.year) * 12 + fromParts.month - anchor.month;
    let n = Math.max(0, Math.floor(monthDistance / stride));
    for (; n <= 120000; n++) {
      const monthIndex = anchor.year * 12 + anchor.month - 1 + n * stride;
      const year = Math.floor(monthIndex / 12), month = monthIndex % 12;
      if (year > 9999) break;
      const stamp = Date.UTC(year, month, anchor.day);
      if (stamp > limit) break;
      if (new Date(stamp).getUTCMonth() !== month || stamp < from) continue;
      return resolved(rule, dateKey(stamp));
    }
    return resolved(rule, '');
  }
  if (unit === 'day') {
    const n = Math.max(0, Math.ceil((from - start) / (DAY * interval)));
    const stamp = start + n * DAY * interval;
    return stamp <= limit ? resolved(rule, dateKey(stamp)) : resolved(rule, '');
  }
  const startDay = new Date(start).getUTCDay() || 7;
  const monday = start - (startDay - 1) * DAY;
  // A weekly rule needs at most one full interval; a workday scan stops at the first unknown year.
  const searchEnd = Math.min(limit, from + Math.max(interval * 7 + 7, 370) * DAY);
  for (let stamp = from; stamp <= searchEnd; stamp += DAY) {
    const date = dateKey(stamp), day = new Date(stamp).getUTCDay() || 7;
    if (unit === 'week' && Math.floor((stamp - monday) / (7 * DAY)) % interval === 0 && rule.weekdays.includes(day)) return resolved(rule, date);
    if (unit === 'weekday') {
      try {
        if (rule.workday === 'weekdays' ? day <= 5 : isChinaWorkday(parts(date))) return resolved(rule, date);
      } catch (error) {
        if (!(error instanceof CalendarUnavailableError)) throw error;
        return { date: '', status: 'calendar_wait', reason: error.message, unavailableDate: date };
      }
    }
  }
  return resolved(rule, '');
}

export function firstRepeatDate(value) {
  const rule = normalizeRepeat(value);
  if (!rule) return { date: '', status: 'ended' };
  if (rule.mode === 'after') return resolved(rule, rule.startDate);
  return scan(rule, rule.startDate, true);
}

export function nextRepeatDate(value, { afterDate, completedOn, action = 'complete', now = new Date(), today = beijingDate(now) } = {}) {
  const rule = normalizeRepeat(value);
  if (!rule || rule.status === 'ended') return { date: '', status: 'ended' };
  if (!validRepeatDate(today)) throw new Error('当前日期无效');
  if (rule.mode === 'after') {
    if (action === 'resume') return resolved(rule, afterDate || rule.scheduledDate || rule.startDate);
    const anchor = action === 'skip' ? today : completedOn;
    if (!validRepeatDate(anchor) || anchor > today) throw new Error('请确认今天或之前的实际完成日期');
    if (rule.unit === 'week') return resolved(rule, dateKey(dateNumber(anchor) + rule.interval * 7 * DAY));
    return scan({ ...rule, startDate: anchor, freq: 'custom' }, anchor);
  }
  const scheduled = afterDate || rule.scheduledDate || rule.startDate;
  const currentTime = new Date(now.getTime() + 8 * 3600000).toISOString().slice(11, 16);
  if (action === 'resume' && (scheduled > today || (scheduled === today && rule.time > currentTime))) return resolved(rule, scheduled);
  const threshold = [today, afterDate || rule.scheduledDate || rule.startDate].sort().at(-1);
  return scan(rule, threshold);
}

export function repeatDueAt(item) {
  if (!item?.repeat || (item.completed && item.repeat.mode === 'after') || item.repeat.status !== 'active' || !item.notificationEnabled) return '';
  try {
    const rule = normalizeRepeat(item.repeat);
    if (!validRepeatDate(item.date)) return '';
    const lead = Number(item.leadDays || 0);
    if (!Number.isInteger(lead) || lead < 0 || lead > 365 || (rule.times.length && (lead !== 0 || !rule.times.includes(rule.time)))) return '';
    return new Date(Date.parse(`${item.date}T${rule.time}:00+08:00`) - lead * DAY).toISOString();
  } catch { return ''; }
}

// Fixed schedules are projected from the clock, never advanced by rendering or Cron.
// The saved series remains available for a delayed Cron after UI has shown tomorrow.
function fixedRule(item) {
  const rule = normalizeRepeat(item?.repeat);
  return rule && rule.mode === 'fixed' && ['active','calendar_wait'].includes(rule.status) ? rule : null;
}
function fixedValues(item, rule) {
  return { title: item.title, category: item.category, notes: item.notes, leadDays: item.leadDays || 0,
    notificationEnabled: item.notificationEnabled, time: rule.time, ...rule.template };
}
function occurrenceTime(date, time, leadDays) {
  const lead = Number(leadDays || 0);
  if (!validRepeatDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(lead) || lead < 0 || lead > 365) return '';
  return new Date(Date.parse(`${date}T${time}:00+08:00`) - lead * DAY).toISOString();
}
function effectiveOverrides(item, rule) {
  const overrides = { ...rule.overrides };
  if (rule.version === 1 && validRepeatDate(rule.scheduledDate)) {
    overrides[rule.scheduledDate] = { title: item.title, category: item.category, notes: item.notes,
      date: item.date, leadDays: item.leadDays, notificationEnabled: item.notificationEnabled,
      time: rule.time, ...overrides[rule.scheduledDate] };
  }
  return overrides;
}
function deriveFixed(item, rule, scheduledDate, overrides, scheduledTime = '') {
  if (!validRepeatDate(scheduledDate) || rule.skippedDates.includes(scheduledDate)) return null;
  const result = scan(rule, scheduledDate, true);
  // Even a saved v1 date or an explicit exception must be backed by a real slot.
  if (result.status !== 'active' || result.date !== scheduledDate) return null;
  const base = fixedValues(item, rule);
  const plannedTime = scheduledTime || (rule.times.length ? rule.times[0] : base.time);
  if (rule.times.length ? !rule.times.includes(plannedTime) : plannedTime !== base.time) return null;
  const values = { ...base, date: scheduledDate, ...overrides[scheduledDate] };
  if (rule.times.length) {
    if (Number(item.leadDays || 0) !== 0 || Number(values.leadDays || 0) !== 0) return null;
    // A day-level override may change content, never one slot's original date/time.
    values.date = scheduledDate;
    values.time = plannedTime;
  }
  const dueAt = occurrenceTime(values.date, values.time, values.leadDays);
  if (!dueAt) return null;
  return { ...item, ...values, hour: Number(values.time.slice(0,2)),
    repeat: { ...rule, status: 'active', scheduledDate, scheduledTime: plannedTime, time: values.time }, dueAt };
}
export function fixedOccurrenceForDate(item, scheduledDate, scheduledTime = '') {
  const rule = fixedRule(item);
  return rule ? deriveFixed(item, rule, scheduledDate, effectiveOverrides(item, rule), scheduledTime) : null;
}
function afterResume(rule, dueAt) {
  return !rule.resumeAfter || Date.parse(dueAt) > Date.parse(rule.resumeAfter);
}
export function fixedDueOccurrences(item, now = new Date()) {
  const rule = fixedRule(item);
  if (!rule || !Number.isFinite(now.getTime())) return [];
  const overrides = effectiveOverrides(item,rule), base = fixedValues(item,rule);
  if (rule.times.length) return intradayDueOccurrences(item, rule, overrides, now);
  const lead = Number(base.leadDays || 0);
  if (!Number.isInteger(lead) || lead < 0 || lead > 365) return [];
  const from = now.getTime() - 3600000, to = now.getTime();
  const lower = beijingDate(new Date(from + lead * DAY));
  const upper = beijingDate(new Date(to + lead * DAY));
  const dates = new Set(Object.keys(overrides));
  let slot = scan(rule, lower, true);
  while (slot.status === 'active' && slot.date <= upper) {
    dates.add(slot.date); slot = scan(rule, slot.date);
  }
  return [...dates].flatMap(day => {
    const occurrence = deriveFixed(item,rule,day,overrides);
    const due = Date.parse(occurrence?.dueAt);
    return occurrence && due > from && due <= to && afterResume(rule,occurrence.dueAt) ? [occurrence] : [];
  }).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||a.repeat.scheduledDate.localeCompare(b.repeat.scheduledDate));
}
export function nextFixedOccurrence(item, now = new Date()) {
  const rule = fixedRule(item);
  if (!rule || !Number.isFinite(now.getTime())) return { status:'ended', occurrence:null, dueAt:'' };
  const overrides = effectiveOverrides(item,rule), base = fixedValues(item,rule);
  if (rule.times.length) return nextIntradayOccurrence(item, rule, overrides, now);
  const lead = Number(base.leadDays || 0);
  if (!Number.isInteger(lead) || lead < 0 || lead > 365) return { status:'ended', occurrence:null, dueAt:'' };
  const threshold = Math.max(now.getTime(), rule.resumeAfter ? Date.parse(rule.resumeAfter) : -Infinity);
  const candidates = Object.keys(overrides).flatMap(day => {
    const occurrence = deriveFixed(item,rule,day,overrides);
    return occurrence && Date.parse(occurrence.dueAt) > threshold ? [occurrence] : [];
  });
  let slot = scan(rule,beijingDate(new Date(threshold + lead * DAY)),true);
  // Skips and exceptions are finite; the first unaffected future slot ends the search.
  while (slot.status === 'active') {
    if (!Object.hasOwn(overrides,slot.date)) {
      const occurrence = deriveFixed(item,rule,slot.date,overrides);
      if (occurrence && Date.parse(occurrence.dueAt) > threshold) { candidates.push(occurrence); break; }
    }
    slot = scan(rule,slot.date);
  }
  candidates.sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||a.repeat.scheduledDate.localeCompare(b.repeat.scheduledDate));
  const occurrence = candidates[0] || null;
  if (slot.status === 'calendar_wait') {
    // A moved exception beyond an unknown year cannot prove which reminder is next.
    const unknownAt = occurrenceTime(slot.unavailableDate,base.time,base.leadDays);
    if (!occurrence || !unknownAt || Date.parse(occurrence.dueAt) >= Date.parse(unknownAt)) {
      return { status:'calendar_wait', occurrence:null, dueAt:'' };
    }
  }
  return occurrence ? { status:'active', occurrence, dueAt:occurrence.dueAt } : { status:slot.status, occurrence:null, dueAt:'' };
}

function validIntradayLead(item, rule) {
  return Number(item.leadDays || 0) === 0 && Number(fixedValues(item, rule).leadDays || 0) === 0;
}
function intradayDueOccurrences(item, rule, overrides, now) {
  if (!validIntradayLead(item, rule)) return [];
  const day = beijingDate(now);
  const first = Date.parse(occurrenceTime(day, rule.times[0], 0));
  const last = Date.parse(occurrenceTime(day, rule.times.at(-1), 0));
  const to = now.getTime();
  // Catch up only within today's configured window. The final minute is allowed,
  // but the next minute, a later day, and off-calendar days never replay that slot.
  if (to < first || to >= last + 60000) return [];
  const from = to - 3600000;
  return rule.times.flatMap(time => {
    const occurrence = deriveFixed(item, rule, day, overrides, time);
    const due = Date.parse(occurrence?.dueAt);
    return occurrence && due > from && due <= to && afterResume(rule, occurrence.dueAt) ? [occurrence] : [];
  });
}
function nextIntradayOccurrence(item, rule, overrides, now) {
  if (!validIntradayLead(item, rule)) return { status: 'ended', occurrence: null, dueAt: '' };
  const threshold = Math.max(now.getTime(), rule.resumeAfter ? Date.parse(rule.resumeAfter) : -Infinity);
  let slot = scan(rule, beijingDate(new Date(threshold)), true);
  while (slot.status === 'active') {
    for (const time of rule.times) {
      const occurrence = deriveFixed(item, rule, slot.date, overrides, time);
      if (occurrence && Date.parse(occurrence.dueAt) > threshold) {
        return { status: 'active', occurrence, dueAt: occurrence.dueAt };
      }
    }
    slot = scan(rule, slot.date);
  }
  return { status: slot.status, occurrence: null, dueAt: '' };
}

export function repeatSummary(value) {
  if (!value) return '不重复';
  const r = normalizeRepeat(value);
  if (!r) return '不重复';
  const weekdays = r.weekdays.map(day => ['一','二','三','四','五','六','日'][day - 1]).join('、');
  const names = { day: '每天', week: `每周${weekdays}`, month: '每月', year: '每年', weekday: r.workday === 'actual' ? '法定工作日（含调休）' : '周一至周五' };
  const unit = { day: '天', week: '周', month: '月' };
  const frequency = r.freq === 'custom' ? `每${r.interval}${unit[r.unit]}${r.unit === 'week' && r.mode === 'fixed' ? ` · 周${weekdays}` : ''}` : names[r.freq];
  const intraday = r.times.length ? ` · ${r.times[0]}—${r.times.at(-1)} · 每天${r.times.length}次` : '';
  return `${frequency} · ${r.mode === 'after' ? '完成后计算' : '固定周期'}${intraday}`;
}
