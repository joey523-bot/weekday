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
  if (!['day', 'week', 'month', 'year', 'weekday', 'custom'].includes(value.freq)) throw new Error('请选择有效的重复周期');
  if (!validRepeatDate(value.startDate)) throw new Error('请选择循环开始日期');
  if (value.endDate && (!validRepeatDate(value.endDate) || value.endDate < value.startDate)) throw new Error('结束日期不能早于开始日期');
  const interval = Number(value.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error('间隔须为1—365的整数');
  const unit = value.unit || 'day';
  if (!['day', 'week', 'month'].includes(unit)) throw new Error('请选择天、周或月');
  const mode = value.freq === 'custom' && value.mode === 'after' ? 'after' : 'fixed';
  const weekdays = [...new Set(value.weekdays || [new Date(dateNumber(value.startDate)).getUTCDay() || 7])].map(Number).sort((a, b) => a - b);
  if (weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) || ((value.freq === 'week' || (value.freq === 'custom' && unit === 'week' && mode === 'fixed')) && !weekdays.length)) throw new Error('请至少选择一个有效星期');
  const time = value.time || '09:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择有效提醒时间');
  const status = value.status || 'active';
  if (!['active', 'paused', 'ended', 'calendar_wait', 'history'].includes(status)) throw new Error('循环状态无效');
  if (value.scheduledDate && !validRepeatDate(value.scheduledDate)) throw new Error('期次日期无效');
  if (value.waitingAfterDate && !validRepeatDate(value.waitingAfterDate)) throw new Error('待排期锚点无效');
  const template = value.template && typeof value.template === 'object' ? { ...value.template } : {};
  return { version: 1, seriesId: typeof value.seriesId === 'string' ? value.seriesId : '', freq: value.freq,
    mode, interval, unit, weekdays, workday: value.workday === 'weekdays' ? 'weekdays' : 'actual',
    startDate: value.startDate, endDate: value.endDate || '', time, status,
    scheduledDate: value.scheduledDate || '', waitingAfterDate: value.waitingAfterDate || '', template };
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
        return { date: '', status: 'calendar_wait', reason: error.message };
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
  if (!item?.repeat || item.completed || item.repeat.status !== 'active' || !item.notificationEnabled) return '';
  try {
    const rule = normalizeRepeat(item.repeat);
    if (!validRepeatDate(item.date)) return '';
    const lead = Number(item.leadDays || 0);
    if (!Number.isInteger(lead) || lead < 0 || lead > 365) return '';
    return new Date(Date.parse(`${item.date}T${rule.time}:00+08:00`) - lead * DAY).toISOString();
  } catch { return ''; }
}

export function repeatSummary(value) {
  if (!value) return '不重复';
  const r = normalizeRepeat(value);
  if (!r) return '不重复';
  const weekdays = r.weekdays.map(day => ['一','二','三','四','五','六','日'][day - 1]).join('、');
  const names = { day: '每天', week: `每周${weekdays}`, month: '每月', year: '每年', weekday: r.workday === 'actual' ? '法定工作日（含调休）' : '周一至周五' };
  const unit = { day: '天', week: '周', month: '月' };
  const frequency = r.freq === 'custom' ? `每${r.interval}${unit[r.unit]}${r.unit === 'week' && r.mode === 'fixed' ? ` · 周${weekdays}` : ''}` : names[r.freq];
  return `${frequency} · ${r.mode === 'after' ? '完成后计算' : '固定周期'}`;
}
