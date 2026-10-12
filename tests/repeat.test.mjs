import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepeat, firstRepeatDate, nextRepeatDate, beijingDate, repeatDueAt } from '../scripts/utils/repeat.js';
const rule = values => normalizeRepeat({ freq: 'custom', mode: 'fixed', interval: 20, unit: 'day', startDate: '2026-10-12', time: '09:35', ...values });
const next = (r, values = {}) => nextRepeatDate(r, { afterDate: r.startDate, today: '2026-10-14', completedOn: '2026-10-14', ...values });

test('fixed and after completion keep different anchors; overdue does not accumulate', () => {
  assert.equal(next(rule({})).date, '2026-11-01');
  assert.equal(next(rule({ mode: 'after' })).date, '2026-11-03');
  assert.equal(next(rule({}), { today: '2026-12-13' }).date, '2026-12-31');
  assert.equal(next(rule({ mode: 'after' }), { action: 'skip', today: '2026-10-18' }).date, '2026-11-07');
});
test('missing month dates and leap day skip, never overflow or drift', () => {
  const monthly = rule({ freq: 'month', startDate: '2026-01-31' });
  assert.equal(next(monthly, { today: '2026-02-01' }).date, '2026-03-31');
  const yearly = rule({ freq: 'year', startDate: '2024-02-29' });
  assert.equal(next(yearly, { today: '2025-02-01' }).date, '2028-02-29');
  assert.equal(next(rule({ mode: 'after', unit: 'month', interval: 1 }), { completedOn: '2026-01-31', today: '2026-01-31' }).date, '2026-03-31');
});
test('weekly multi-selection and N-week intervals anchored to start week', () => {
  const weekly = rule({ freq: 'week', weekdays: [1, 5], startDate: '2026-10-13' });
  assert.equal(firstRepeatDate(weekly).date, '2026-10-16');
  const two = rule({ unit: 'week', interval: 2, weekdays: [1, 5] });
  assert.equal(next(two).date, '2026-10-16');
  assert.equal(next(two, { afterDate: '2026-10-16', today: '2026-10-16' }).date, '2026-10-26');
});
test('actual workdays respect makeup days and fail closed for unknown year', () => {
  assert.equal(firstRepeatDate(rule({ freq: 'weekday', startDate: '2026-10-10' })).date, '2026-10-10');
  assert.equal(firstRepeatDate(rule({ freq: 'weekday', startDate: '2026-10-10', workday: 'weekdays' })).date, '2026-10-12');
  assert.equal(next(rule({ freq: 'weekday' }), { today: '2026-12-31', afterDate: '2026-12-31' }).status, 'calendar_wait');
  assert.equal(firstRepeatDate(rule({ freq: 'weekday', startDate: '2027-01-01', workday: 'weekdays' })).date, '2027-01-01');
});
test('end is inclusive, resume and skip preserve mode semantics', () => {
  assert.equal(next(rule({ endDate: '2026-11-01' })).date, '2026-11-01');
  assert.equal(next(rule({ endDate: '2026-10-31' })).status, 'ended');
  assert.equal(next(rule({ mode: 'after' }), { action: 'resume' }).date, '2026-10-12');
  assert.equal(next(rule({}), { action: 'resume' }).date, '2026-11-01');
});
test('Beijing date and minute reminders are independent of host timezone', () => {
  assert.equal(beijingDate(new Date('2026-10-12T16:01:00Z')), '2026-10-13');
  const item = { repeat: rule({}), date: '2026-10-12', leadDays: 1, notificationEnabled: true };
  assert.equal(repeatDueAt(item), '2026-10-11T01:35:00.000Z');
  assert.equal(repeatDueAt({ ...item, repeat: { ...item.repeat, status: 'paused' } }), '');
  assert.equal(repeatDueAt({ ...item, completed: true }), '');
});
test('reject malformed rules and never silently accept impossible dates', () => {
  for (const invalid of [{ startDate: '2026-02-30' }, { interval: 0 }, { interval: 1.5 }, { time: '24:01' }, { endDate: '2026-01-01' }, { freq: 'week', weekdays: [] }]) assert.throws(() => rule(invalid));
  assert.equal(normalizeRepeat(null), null);
});

test('minute due highlighting excludes paused and ended series', async () => {
  const { isReminderDue } = await import('../scripts/utils/snooze.js');
  const item = { date: '2026-10-12', hour: 9, repeat: rule({ time: '09:35' }) };
  assert.equal(isReminderDue(item, new Date('2026-10-12T01:34:59Z')), false);
  assert.equal(isReminderDue(item, new Date('2026-10-12T01:35:00Z')), true);
  assert.equal(isReminderDue({ ...item, repeat: { ...item.repeat, status: 'paused' } }, new Date('2026-10-12T02:00:00Z')), false);
});
