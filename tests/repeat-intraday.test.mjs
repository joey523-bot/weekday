import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepeat, repeatTimes, repeatSummary, firstRepeatDate, nextRepeatDate,
  nextFixedOccurrence, fixedDueOccurrences, fixedOccurrenceForDate, repeatDueAt } from '../scripts/utils/repeat.js';
const cn = value => new Date(`${value}+08:00`);
const hours = (first = 8, last = 21) => Array.from({ length: last - first + 1 }, (_, index) => `${String(first + index).padStart(2, '0')}:00`);
function item(values = {}, fields = {}) {
  return { id: 'intraday', title: '喝水', category: '生活', notes: '', date: '2026-10-10', hour: 8,
    leadDays: 0, notificationEnabled: true, completed: false, ...fields,
    repeat: normalizeRepeat({ version: 3, seriesId: 'series-intraday', freq: 'day', mode: 'fixed',
      startDate: '2026-10-10', time: '08:00', times: hours(), status: 'active',
      template: { title: '喝水', time: '08:00', leadDays: 0, notificationEnabled: true }, ...values }) };
}
const dueTimes = (entry, wallClock) => fixedDueOccurrences(entry, cn(wallClock)).map(occurrence => occurrence.repeat.scheduledTime);

test('v3 sorts/deduplicates 14 points and preserves actual projected time', () => {
  const repeat = item({ times: [...hours().reverse(), '08:00'], time: '13:00', scheduledTime: '13:00' }).repeat;
  assert.equal(repeat.version, 3);
  assert.deepEqual(repeat.times, hours());
  assert.deepEqual(repeatTimes(repeat), hours());
  assert.equal(normalizeRepeat(repeat).time, '13:00');
  assert.equal(normalizeRepeat(repeat).scheduledTime, '13:00');
  assert.match(repeatSummary(repeat), /08:00—21:00.*每天14次/);
});
test('malformed, nonconsecutive, old-version and after-completion multi-time rules fail closed', () => {
  for (const values of [
    { version: 0 }, { version: 4 }, { version: '3' }, { version: 2 }, { version: 1 },
    { times: '08:00' }, { times: null }, { times: ['08:00'] }, { times: ['08:00', '08:00'] },
    { times: ['08:00', '10:00'] }, { times: ['08:00', '09:30'] }, { times: ['8:00', '09:00'] },
    { times: ['23:00', '24:00'] }, { times: ['22:00', '23:00', '00:00'] },
    { freq: 'custom', mode: 'after' }, { scheduledTime: '24:00' }, { template: { leadDays: 1 } },
    { overrides: { '2026-10-12': { leadDays: 1 } } },
    { overrides: { '2026-10-12': { date: '2026-10-13' } } },
    { overrides: { '2026-10-12': { time: '09:30' } } }
  ]) assert.throws(() => item(values), undefined, JSON.stringify(values));
});
test('all 14 hourly points are distinct and calculation never mutates state', () => {
  const entry = item(), before = JSON.stringify(entry), actual = [];
  for (const time of hours()) {
    const occurrences = fixedDueOccurrences(entry, cn(`2026-10-12T${time}:00`));
    assert.equal(occurrences.length, 1);
    actual.push(occurrences[0].repeat.scheduledTime);
    assert.equal(occurrences[0].repeat.time, time);
    assert.equal(occurrences[0].repeat.scheduledDate, '2026-10-12');
    assert.equal(occurrences[0].id, entry.id);
    assert.equal(repeatDueAt(occurrences[0]), occurrences[0].dueAt);
  }
  assert.deepEqual(actual, hours());
  assert.equal(new Set(actual).size, 14);
  assert.equal(JSON.stringify(entry), before);
});
test('projection returns the strictly future next intraday point then the next day', () => {
  const entry = item();
  for (const [clock, date, time] of [
    ['2026-10-12T07:59:59', '2026-10-12', '08:00'], ['2026-10-12T08:00:00', '2026-10-12', '09:00'],
    ['2026-10-12T12:59:59', '2026-10-12', '13:00'], ['2026-10-12T13:00:00', '2026-10-12', '14:00'],
    ['2026-10-12T20:59:59', '2026-10-12', '21:00'], ['2026-10-12T21:00:00', '2026-10-13', '08:00']
  ]) {
    const projected = nextFixedOccurrence(entry, cn(clock));
    assert.equal(projected.status, 'active');
    assert.equal(projected.occurrence.date, date);
    assert.equal(projected.occurrence.repeat.scheduledTime, time);
    assert.equal(normalizeRepeat(projected.occurrence.repeat).time, time);
  }
});
test('catch-up is bounded to today/window and ends precisely at 21:01', () => {
  const entry = item();
  for (const [clock, expected] of [
    ['2026-10-12T07:59:59', []], ['2026-10-12T08:00:00', ['08:00']],
    ['2026-10-12T08:59:59', ['08:00']], ['2026-10-12T09:00:00', ['09:00']],
    ['2026-10-12T10:42:00', ['10:00']], ['2026-10-12T20:59:59', ['20:00']],
    ['2026-10-12T21:00:00', ['21:00']], ['2026-10-12T21:00:59.999', ['21:00']],
    ['2026-10-12T21:01:00', []], ['2026-10-12T21:30:00', []],
    ['2026-10-12T23:59:59', []], ['2026-10-13T00:00:00', []]
  ]) assert.deepEqual(dueTimes(entry, clock), expected, clock);
});
test('a 24-point day crosses Beijing midnight without replaying yesterday', () => {
  const entry = item({ times: hours(0, 23), time: '00:00', template: { time: '00:00', leadDays: 0 } });
  const before = nextFixedOccurrence(entry, cn('2026-10-12T23:00:00'));
  assert.equal(before.occurrence.date, '2026-10-13');
  assert.equal(before.occurrence.repeat.scheduledTime, '00:00');
  assert.deepEqual(dueTimes(entry, '2026-10-12T23:00:59'), ['23:00']);
  assert.deepEqual(dueTimes(entry, '2026-10-12T23:01:00'), []);
  const atMidnight = fixedDueOccurrences(entry, new Date('2026-10-12T16:00:00Z'));
  assert.equal(atMidnight.length, 1);
  assert.equal(atMidnight[0].repeat.scheduledDate, '2026-10-13');
  assert.equal(atMidnight[0].repeat.scheduledTime, '00:00');
});
test('actual workdays include makeup Saturday and exclude Sunday/holidays', () => {
  const entry = item({ freq: 'weekday', startDate: '2026-10-01', workday: 'actual' });
  assert.deepEqual(dueTimes(entry, '2026-10-10T08:00:00'), ['08:00']);
  assert.deepEqual(dueTimes(entry, '2026-10-11T08:00:00'), []);
  assert.deepEqual(dueTimes(entry, '2026-10-01T08:00:00'), []);
  const next = nextFixedOccurrence(entry, cn('2026-10-10T21:00:00'));
  assert.equal(next.occurrence.date, '2026-10-12');
  assert.equal(next.occurrence.repeat.scheduledTime, '08:00');
  assert.deepEqual(dueTimes(item({ freq: 'weekday', workday: 'weekdays' }), '2026-10-10T08:00:00'), []);
});
test('unknown next calendar year pauses the future but not the last known point', () => {
  const entry = item({ freq: 'weekday', workday: 'actual', startDate: '2026-12-31' });
  const known = nextFixedOccurrence(entry, cn('2026-12-31T20:59:59'));
  assert.equal(known.status, 'active');
  assert.equal(known.occurrence.repeat.scheduledTime, '21:00');
  assert.equal(nextFixedOccurrence(entry, cn('2026-12-31T21:00:00')).status, 'calendar_wait');
  assert.deepEqual(dueTimes(entry, '2026-12-31T21:00:59'), ['21:00']);
  assert.deepEqual(dueTimes(entry, '2027-01-01T08:00:00'), []);
  const finite = { ...entry, repeat: { ...entry.repeat, endDate: '2026-12-31' } };
  assert.equal(nextFixedOccurrence(finite, cn('2026-12-31T21:00:00')).status, 'ended');
});
test('exact occurrence lookup defaults to first point and rejects nonexistent points', () => {
  const entry = item();
  assert.equal(fixedOccurrenceForDate(entry, '2026-10-12').repeat.scheduledTime, '08:00');
  const exact = fixedOccurrenceForDate(entry, '2026-10-12', '17:00');
  assert.equal(exact.repeat.time, '17:00');
  assert.equal(exact.dueAt, '2026-10-12T09:00:00.000Z');
  assert.equal(fixedOccurrenceForDate(entry, '2026-10-12', '17:30'), null);
  assert.equal(fixedOccurrenceForDate(entry, '2026-10-12', '07:00'), null);
});
test('day overrides change content/notification without collapsing multiple points', () => {
  const entry = item({ overrides: { '2026-10-12': {
    date: '2026-10-12', time: '17:00', title: '当天标题', notificationEnabled: false, leadDays: 0
  } } });
  for (const time of ['08:00', '12:00', '21:00']) {
    const occurrence = fixedOccurrenceForDate(entry, '2026-10-12', time);
    assert.equal(occurrence.title, '当天标题');
    assert.equal(occurrence.notificationEnabled, false);
    assert.equal(occurrence.repeat.time, time);
  }
  assert.equal(nextFixedOccurrence(entry, cn('2026-10-12T11:30:00')).occurrence.repeat.time, '12:00');
  assert.equal(fixedOccurrenceForDate(entry, '2026-10-13', '12:00').title, '喝水');
});
test('day skip, inactive states and resume cutoff suppress intended deliveries only', () => {
  const entry = item({ skippedDates: ['2026-10-12'] });
  assert.deepEqual(dueTimes(entry, '2026-10-12T13:00:00'), []);
  assert.equal(nextFixedOccurrence(entry, cn('2026-10-12T07:00:00')).occurrence.date, '2026-10-13');
  for (const status of ['paused', 'ended', 'history']) assert.deepEqual(dueTimes(item({ status }), '2026-10-12T13:00:00'), []);
  const resumed = item({ resumeAfter: cn('2026-10-12T12:30:00').toISOString() });
  assert.deepEqual(dueTimes(resumed, '2026-10-12T12:45:00'), []);
  assert.deepEqual(dueTimes(resumed, '2026-10-12T13:00:00'), ['13:00']);
  assert.equal(nextFixedOccurrence(resumed, cn('2026-10-12T12:30:00')).occurrence.repeat.time, '13:00');
});
test('nonzero top-level leadDays never causes shifted intraday deliveries', () => {
  const entry = item({}, { leadDays: 1 });
  assert.deepEqual(dueTimes(entry, '2026-10-12T09:00:00'), []);
  assert.equal(nextFixedOccurrence(entry, cn('2026-10-12T08:30:00')).occurrence, null);
  assert.equal(fixedOccurrenceForDate(entry, '2026-10-12', '09:00'), null);
  assert.equal(repeatDueAt(entry), '');
});
test('date-only first/next APIs retain their date semantics', () => {
  const rule = item({ freq: 'weekday', workday: 'actual' }).repeat;
  assert.equal(firstRepeatDate(rule).date, '2026-10-10');
  assert.equal(nextRepeatDate(rule, { afterDate: '2026-10-10', today: '2026-10-10' }).date, '2026-10-12');
});
test('v1/v2/v3 single times retain minute precision and the original one-hour window', () => {
  for (const version of [1, 2, 3]) {
    const entry = item({ version, times: [], time: '09:35', scheduledDate: '2026-10-10',
      template: { time: '09:35', leadDays: 0, notificationEnabled: true } });
    assert.equal(entry.repeat.version, version);
    assert.deepEqual(repeatTimes(entry.repeat), ['09:35']);
    assert.equal(fixedDueOccurrences(entry, cn('2026-10-12T09:40:00')).length, 1);
    assert.equal(fixedDueOccurrences(entry, cn('2026-10-12T10:35:00')).length, 0);
    assert.equal(nextFixedOccurrence(entry, cn('2026-10-12T09:35:00')).occurrence.date, '2026-10-13');
    assert.equal(repeatSummary(entry.repeat), '每天 · 固定周期');
  }
});
