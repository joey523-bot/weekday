const HOUR = 3600000;
export function chinaInput(now = new Date()) {
  return new Date(now.getTime() + 8 * HOUR).toISOString().slice(0, 16);
}
export function parseChinaInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))) return NaN;
  const stamp = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(stamp) && chinaInput(new Date(stamp)) === value ? stamp : NaN;
}
export function defaultSnoozeCutoff(now = new Date()) {
  const local = chinaInput(now);
  return local.slice(11, 13) < '22' ? `${local.slice(0, 10)}T22:00` : '';
}
export function makeSnoozePlan(body, now = new Date()) {
  const mode = body?.mode;
  if (!['once', 'hourly'].includes(mode)) throw new Error('请选择单次或每小时提醒');
  let start;
  if (mode === 'hourly') start = now.getTime() + HOUR;
  else if ([10, 30, 60].includes(body.minutes)) start = now.getTime() + body.minutes * 60000;
  else start = parseChinaInput(body.at);
  if (!Number.isFinite(start) || start <= now.getTime()) throw new Error('请选择未来的提醒时间');
  const until = mode === 'hourly' ? parseChinaInput(body.until) : null;
  if (mode === 'hourly' && (!Number.isFinite(until) || until <= start)) throw new Error('截止时间须晚于第一次提醒（1小时后）');
  return { mode, nextAt: new Date(start).toISOString(), untilAt: until === null ? null : new Date(until).toISOString() };
}
// The anchor stays immutable. Missed hourly slots collapse to the latest slot, never a burst.
export function snoozeOccurrence(rule, now = new Date()) {
  const start = Date.parse(rule.next_at), current = now.getTime();
  if (!rule.active || !Number.isFinite(start) || current < start) return null;
  if (rule.mode === 'hourly' && current >= Date.parse(rule.until_at)) return null;
  return new Date(rule.mode === 'hourly' ? start + Math.floor((current - start) / HOUR) * HOUR : start).toISOString();
}
export function nextSnoozeTime(rule, now = new Date()) {
  if (!rule?.active) return '';
  let next = Date.parse(rule.next_at);
  if (rule.mode === 'hourly' && next <= now.getTime()) next += (Math.floor((now.getTime() - next) / HOUR) + 1) * HOUR;
  if (rule.mode === 'hourly' && next >= Date.parse(rule.until_at)) return '';
  return new Date(next).toISOString();
}
export function isReminderDue(reminder, now = new Date()) {
  if (reminder.completed || (reminder.repeat && reminder.repeat.status !== 'active')) return false;
  const time = parseChinaInput(`${reminder.date}T${reminder.repeat?.time || `${String(Number(reminder.hour) || 0).padStart(2, '0')}:00`}`);
  return Number.isFinite(time) && now.getTime() >= time;
}
