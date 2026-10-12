import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFixedOccurrence, fixedOccurrenceForDate, fixedDueOccurrences } from '../scripts/utils/repeat.js';

let serial = 0;
async function setup() {
  const storage = new Map();
  let fail = false;
  globalThis.localStorage = { getItem: key => storage.get(key) || null,
    setItem: (key, value) => { if (fail) throw new Error('quota'); storage.set(key, value); } };
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class {};
  const state = await import(`../scripts/state.js?repeat-state-${++serial}`);
  return { ...state, addReminder(payload, tokens = [], options = { now: new Date('2026-10-10T00:00:00Z') }) {
    return state.addReminder(payload, tokens, options);
  }, fail(value) { fail = value; }, async reload() { return import(`../scripts/state.js?repeat-state-${++serial}`); } };
}
const now = new Date('2026-10-12T03:00:00Z');
const payload = extra => ({ title: '浇花', date: '2026-10-10', category: '生活', notes: '窗台',
  leadDays: 0, notificationEnabled: true, hour: 9,
  repeat: { freq: 'day', startDate: '2026-10-10', time: '09:30', ...extra } });
const live = s => s.getState().reminders.filter(item => item.repeat?.status !== 'history');
const history = s => s.getState().reminders.filter(item => item.repeat?.status === 'history');
const next = (s, at = now) => nextFixedOccurrence(live(s)[0], at).occurrence;

test('new fixed series uses version 2 and snapshot capability, validates and survives reload', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'week', weekdays: [1] }));
  assert.equal(added.date, '2026-10-12');
  assert.equal(added.repeat.template.time, '09:30');
  assert.equal(added.repeat.version, 2);
  assert.ok(added.repeat.seriesId);
  assert.deepEqual(s.getSyncSnapshot().capabilities, { repeat: 2 });
  assert.deepEqual((await s.reload()).getState().reminders, s.getState().reminders);
  assert.throws(() => s.addReminder(payload({ startDate: '2026-02-30' })), /开始日期/);
  assert.equal(s.getState().reminders.length, 1);
});

test('fixed calendar crosses reminder times and days without actions, state writes or history growth', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const before = JSON.stringify(s.getState());
  assert.equal(next(s, new Date('2026-10-12T01:00:00Z')).date, '2026-10-12');
  assert.equal(next(s).date, '2026-10-13');
  assert.equal(next(s, new Date('2026-10-15T03:00:00Z')).date, '2026-10-16');
  assert.equal(next(s).id, added.id);
  assert.equal(JSON.stringify(s.getState()), before);
  assert.equal(history(s).length, 0);
});

test('fixed completion keeps active id and calendar unchanged, records immutable explicit slot once', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const before = JSON.stringify(live(s)[0]);
  const beforeNext = next(s).date;
  const record = s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-12', occurredOn: '2026-10-11', now });
  assert.notEqual(record.id, added.id);
  assert.equal(record.date, '2026-10-12');
  assert.equal(record.repeat.scheduledDate, '2026-10-12');
  assert.equal(record.occurredOn, '2026-10-11');
  assert.equal(record.repeatOutcome, 'completed');
  assert.equal(record.completedAt, now.toISOString());
  assert.equal(JSON.stringify(live(s)[0]), before);
  assert.equal(next(s).date, beforeNext);
  assert.equal(live(s)[0].id, added.id);
  assert.throws(() => s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-12', occurredOn: '2026-10-12', now }), /重复/);
  assert.throws(() => s.setReminderCompletion(record.id, false), /历史/);
  assert.throws(() => s.updateReminder(record.id, { title: '改历史' }, 'series'), /历史/);
  assert.equal(history(s).length, 1);
});

test('fixed completion does not suppress a due candidate observed by a late cron', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const dueNow = new Date('2026-10-12T01:31:00Z');
  const before = fixedDueOccurrences(added, dueNow);
  assert.ok(before.length);
  s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-12', occurredOn: '2026-10-12', now: dueNow });
  assert.deepEqual(fixedDueOccurrences(live(s)[0], dueNow), before);
});

test('fixed skip excludes only chosen slot and survives history deletion without suppressing the next calendar slot', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const record = s.manageRepeat(added.id, 'skip', { occurrenceDate: '2026-10-13', now });
  assert.equal(record.repeatOutcome, 'skipped');
  assert.equal(record.occurredOn, '');
  assert.equal(live(s)[0].id, added.id);
  assert.deepEqual(live(s)[0].repeat.skippedDates, ['2026-10-13']);
  assert.equal(next(s).date, '2026-10-14');
  assert.equal(fixedOccurrenceForDate(live(s)[0], '2026-10-13'), null);
  s.deleteReminder(record.id);
  assert.equal(next(s).date, '2026-10-14');
  assert.throws(() => s.manageRepeat(added.id, 'skip', { occurrenceDate: '2026-10-13', now }), /期次/);
});

test('default action targets projected next slot rather than stale raw date', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  assert.equal(added.date, '2026-10-10');
  const record = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-12', now });
  assert.equal(record.repeat.scheduledDate, '2026-10-13');
  assert.equal(next(s).date, '2026-10-13');
});

test('only-once overrides target frozen slots and retain multiple shifted occurrences', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.updateReminder(added.id, { title: '第一处覆盖', date: '2026-10-20', notes: '仅第一期',
    repeat: { ...added.repeat, time: '19:45' } }, 'once', { occurrenceDate: '2026-10-13', now });
  s.updateReminder(added.id, { title: '第二处覆盖', date: '2026-10-16',
    repeat: { ...added.repeat, time: '18:15' } }, 'once', { occurrenceDate: '2026-10-14', now });
  const current = live(s)[0];
  assert.equal(current.id, added.id);
  assert.equal(current.repeat.template.title, '浇花');
  assert.equal(current.repeat.template.time, '09:30');
  assert.equal(fixedOccurrenceForDate(current, '2026-10-13').date, '2026-10-20');
  assert.equal(fixedOccurrenceForDate(current, '2026-10-13').repeat.time, '19:45');
  assert.equal(fixedOccurrenceForDate(current, '2026-10-14').title, '第二处覆盖');
  assert.equal(fixedOccurrenceForDate(current, '2026-10-15').title, '浇花');
  const record = s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-13', occurredOn: '2026-10-12', now });
  assert.equal(record.title, '第一处覆盖');
  assert.equal(record.date, '2026-10-20');
  assert.equal(record.repeat.scheduledDate, '2026-10-13');
  assert.equal(fixedOccurrenceForDate(live(s)[0], '2026-10-13').date, '2026-10-20');
});

test('series edit affects selected slot forward, leaves earlier overrides/history and content-only cutoff unchanged', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-11', occurredOn: '2026-10-11', now });
  const historical = JSON.stringify(history(s)[0]);
  s.updateReminder(added.id, { title: '早期覆盖' }, 'once', { occurrenceDate: '2026-10-12', now });
  s.updateReminder(added.id, { title: '未来覆盖' }, 'once', { occurrenceDate: '2026-10-14', now });
  s.updateReminder(added.id, { title: '新系列' }, 'series', { occurrenceDate: '2026-10-13', now });
  const current = live(s)[0];
  assert.equal(current.repeat.template.title, '新系列');
  assert.equal(current.repeat.overrides['2026-10-12'].title, '早期覆盖');
  assert.equal(current.repeat.overrides['2026-10-14'], undefined);
  assert.equal(current.repeat.resumeAfter, added.repeat.resumeAfter);
  assert.equal(fixedOccurrenceForDate(current, '2026-10-14').title, '新系列');
  assert.equal(JSON.stringify(history(s)[0]), historical);
  s.updateReminder(added.id, { repeat: { ...current.repeat, time: '18:45' } }, 'series', { occurrenceDate: '2026-10-13', now });
  assert.equal(live(s)[0].repeat.resumeAfter, now.toISOString());
  assert.equal(live(s)[0].repeat.template.time, '18:45');
});

test('fixed pause/resume retains overrides and history, sets cutoff, and never creates missed-period history', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.updateReminder(added.id, { title: '保留覆盖' }, 'once', { occurrenceDate: '2026-10-14', now });
  s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-11', occurredOn: '2026-10-11', now });
  s.manageRepeat(added.id, 'pause', { now });
  assert.throws(() => s.manageRepeat(added.id, 'skip', { now }), /恢复/);
  const resumed = s.manageRepeat(added.id, 'resume', { now });
  assert.equal(resumed.id, added.id);
  assert.equal(resumed.repeat.status, 'active');
  assert.equal(resumed.repeat.resumeAfter, now.toISOString());
  assert.equal(resumed.repeat.overrides['2026-10-14'].title, '保留覆盖');
  assert.equal(next(s).date, '2026-10-13');
  assert.equal(history(s).length, 1);
  assert.equal(fixedDueOccurrences(resumed, now).length, 0);
});

test('end date is projected without destroying last due candidate; explicit end disables the series', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ endDate: '2026-10-12' }));
  assert.equal(nextFixedOccurrence(added, now).status, 'ended');
  assert.equal(added.repeat.status, 'active');
  assert.ok(fixedDueOccurrences(added, new Date('2026-10-12T01:31:00Z')).length);
  s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-12', occurredOn: '2026-10-12', now });
  assert.equal(live(s).length, 1);
  assert.equal(live(s)[0].repeat.status, 'active');
  const ended = s.manageRepeat(added.id, 'end', { now });
  assert.equal(ended.repeat.status, 'ended');
  assert.throws(() => s.manageRepeat(added.id, 'resume', { now }), /已结束/);
});

test('version 1 implicit current exception migrates losslessly while future periods use the template', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const v1 = { ...added, title: '旧版本本期', date: '2026-10-17', repeat: { ...added.repeat,
    version: 1, scheduledDate: '2026-10-13', time: '18:15' } };
  s.replaceSyncedData({ reminders: [v1] });
  s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-13', occurredOn: '2026-10-12', now });
  const current = live(s)[0];
  assert.equal(current.repeat.version, 2);
  assert.equal(current.repeat.overrides['2026-10-13'].title, '旧版本本期');
  assert.equal(current.repeat.overrides['2026-10-13'].date, '2026-10-17');
  assert.equal(fixedOccurrenceForDate(current, '2026-10-14').title, '浇花');
  assert.equal(fixedOccurrenceForDate(current, '2026-10-14').repeat.time, '09:30');
  assert.equal(history(s)[0].title, '旧版本本期');
});

test('after-completion mode retains actual-date progression, skip, single-item pause and ordinary history rules', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'custom', mode: 'after', interval: 2, unit: 'week' }));
  assert.throws(() => s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-13', now }), /实际发生日期/);
  const future = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-08', now });
  assert.equal(future.date, '2026-10-22');
  assert.notEqual(future.id, added.id);
  assert.equal(history(s)[0].occurredOn, '2026-10-08');
  s.updateReminder(future.id, { date: '2026-10-23' });
  s.manageRepeat(future.id, 'pause', { now });
  assert.equal(s.manageRepeat(future.id, 'resume', { now }).date, '2026-10-23');
  const skipped = s.manageRepeat(future.id, 'skip', { now: new Date('2026-10-12T18:00:00Z') });
  assert.equal(skipped.date, '2026-10-27');
  assert.equal(history(s).at(-1).occurredOn, '');
  assert.equal(history(s).at(-1).repeatOutcome, 'skipped');
});

test('after-completion only-once time and content reset to template for the next item', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'custom', mode: 'after', interval: 3 }));
  s.updateReminder(added.id, { title: '一次覆盖', repeat: { ...added.repeat, time: '19:45' } }, 'once');
  const future = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-12', now });
  assert.equal(future.date, '2026-10-15');
  assert.equal(future.title, '浇花');
  assert.equal(future.repeat.time, '09:30');
  const updated = s.updateReminder(future.id, { repeat: { ...future.repeat, interval: 5 } }, 'series');
  assert.equal(updated.date, '2026-10-15');
});

test('unknown calendar is a recoverable projected condition and never auto-generates history', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'weekday', startDate: '2099-01-01', workday: 'actual' }));
  assert.equal(nextFixedOccurrence(added, now).status, 'calendar_wait');
  const resumed = s.manageRepeat(added.id, 'resume', { now });
  assert.equal(nextFixedOccurrence(resumed, now).status, 'calendar_wait');
  assert.equal(history(s).length, 0);
  s.updateReminder(added.id, { repeat: { ...resumed.repeat, workday: 'weekdays' } }, 'series', { now });
  assert.equal(next(s).date, '2099-01-01');
});

test('storage failures roll back add, completion, skip, override, series edit, pause, delete and sync', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const before = JSON.stringify(s.getState());
  s.fail(true);
  for (const mutation of [
    () => s.addReminder(payload()),
    () => s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-12', occurredOn: '2026-10-12', now }),
    () => s.manageRepeat(added.id, 'skip', { occurrenceDate: '2026-10-13', now }),
    () => s.updateReminder(added.id, { title: '不可保存' }, 'once', { occurrenceDate: '2026-10-13', now }),
    () => s.updateReminder(added.id, { title: '不可保存' }, 'series', { now }),
    () => s.manageRepeat(added.id, 'pause', { now }),
    () => s.deleteReminder(added.id),
    () => s.replaceSyncedData({ reminders: [] })
  ]) {
    assert.throws(mutation, /quota/);
    assert.equal(JSON.stringify(s.getState()), before);
  }
  s.fail(false);
  assert.equal(JSON.stringify((await s.reload()).getState()), before);
});

test('ordinary reminders and conversion to and from fixed recurrence stay compatible', async () => {
  const s = await setup();
  const ordinary = s.addReminder({ title: '普通事项', date: '2026-10-10', hour: 8 });
  assert.equal(Object.hasOwn(ordinary, 'repeat'), false);
  s.updateReminder(ordinary.id, { repeat: payload().repeat }, 'series');
  assert.equal(live(s)[0].id, ordinary.id);
  assert.equal(live(s)[0].repeat.version, 2);
  s.updateReminder(ordinary.id, { repeat: null }, 'series');
  assert.equal(Object.hasOwn(live(s)[0], 'repeat'), false);
  s.setReminderCompletion(ordinary.id, true, '2026-10-01');
  s.setReminderCompletion(ordinary.id, false);
  assert.equal(live(s)[0].completed, false);
});

test('partial once edits preserve an existing override time and date', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.updateReminder(added.id, { date: '2026-10-18', repeat: { ...added.repeat, time: '18:45' } }, 'once', { occurrenceDate: '2026-10-13', now });
  s.updateReminder(added.id, { title: '只改标题' }, 'once', { occurrenceDate: '2026-10-13', now });
  const occurrence = fixedOccurrenceForDate(live(s)[0], '2026-10-13');
  assert.equal(occurrence.date, '2026-10-18');
  assert.equal(occurrence.repeat.time, '18:45');
  assert.equal(occurrence.title, '只改标题');
  assert.equal(live(s)[0].repeat.template.time, '09:30');
});

test('fixed to after conversion carries frozen occurrence date/content and removes fixed schedule metadata', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.updateReminder(added.id, { title: '目标期次', date: '2026-10-18' }, 'once', { occurrenceDate: '2026-10-13', now });
  const before = live(s)[0];
  const converted = s.updateReminder(added.id, { repeat: { ...before.repeat, freq: 'custom', mode: 'after', interval: 2, unit: 'day' } }, 'series', { occurrenceDate: '2026-10-13', now });
  assert.equal(converted.id, added.id);
  assert.equal(converted.date, '2026-10-18');
  assert.equal(converted.title, '目标期次');
  assert.equal(converted.repeat.mode, 'after');
  assert.deepEqual(converted.repeat.overrides, {});
  assert.deepEqual(converted.repeat.skippedDates, []);
  const following = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-12', now });
  assert.equal(following.date, '2026-10-14');
  assert.notEqual(following.id, added.id);
});

test('after to fixed starts the new reminder schedule at save time without replaying previous due time', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'custom', mode: 'after', interval: 1, unit: 'day' }));
  const at = new Date('2026-10-12T01:31:00Z');
  const converted = s.updateReminder(added.id, { repeat: { ...added.repeat, mode: 'fixed' } }, 'series', { now: at });
  assert.equal(converted.id, added.id);
  assert.equal(converted.repeat.mode, 'fixed');
  assert.equal(converted.repeat.version, 2);
  assert.equal(converted.repeat.resumeAfter, at.toISOString());
  assert.equal(nextFixedOccurrence(converted, at).occurrence.date, '2026-10-13');
  assert.deepEqual(fixedDueOccurrences(converted, at), []);
});

test('historical snapshots contain only their own occurrence and do not multiply series exceptions', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.updateReminder(added.id, { title: '特定期次', notes: '要保留' }, 'once', { occurrenceDate: '2026-10-13', now });
  s.updateReminder(added.id, { title: '其他期次' }, 'once', { occurrenceDate: '2026-10-14', now });
  const record = s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-13', occurredOn: '2026-10-12', now });
  assert.equal(record.title, '特定期次');
  assert.equal(record.notes, '要保留');
  assert.equal(record.repeat.scheduledDate, '2026-10-13');
  assert.deepEqual(record.repeat.overrides, {});
  assert.deepEqual(record.repeat.skippedDates, []);
  assert.equal(Object.keys(live(s)[0].repeat.overrides).length, 2);
});

test('explicit v1 override wins over implicit raw fields during upgrade', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.replaceSyncedData({ reminders: [{ ...added, title: '原始字段', date: '2026-10-17', repeat: { ...added.repeat,
    version: 1, scheduledDate: '2026-10-13', time: '18:15',
    overrides: { '2026-10-13': { title: '显式覆盖', date: '2026-10-19', time: '20:45' } } } }] });
  const record = s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-13', occurredOn: '2026-10-12', now });
  assert.equal(record.title, '显式覆盖');
  assert.equal(record.date, '2026-10-19');
  assert.equal(record.repeat.time, '20:45');
  assert.equal(live(s)[0].repeat.overrides['2026-10-13'].title, '显式覆盖');
});

// Saving a new start anchor is an explicit schedule change, but not permission to replay its past slots.
test('series start-date edits keep immutable records and exclude retroactive due candidates', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.manageRepeat(added.id, 'complete', { occurrenceDate: '2026-10-11', occurredOn: '2026-10-11', now });
  const before = JSON.stringify(history(s));
  const at = new Date('2026-10-12T01:31:00Z');
  const updated = s.updateReminder(added.id, { repeat: { ...added.repeat, startDate: '2026-09-01' } }, 'series', { occurrenceDate: '2026-10-13', now: at });
  assert.equal(updated.repeat.resumeAfter, at.toISOString());
  assert.deepEqual(fixedDueOccurrences(updated, at), []);
  assert.equal(JSON.stringify(history(s)), before);
  assert.equal(nextFixedOccurrence(updated, at).occurrence.date, '2026-10-13');
});

test('new fixed series created after due time does not backfill before its creation', async () => {
  const s = await setup();
  const created = new Date('2026-10-12T01:31:00Z');
  const added = s.addReminder(payload(), [], { now: created });
  assert.equal(added.createdAt, created.toISOString());
  assert.equal(added.repeat.resumeAfter, created.toISOString());
  assert.deepEqual(fixedDueOccurrences(added, created), []);
  assert.equal(nextFixedOccurrence(added, created).occurrence.date, '2026-10-13');
});

test('ordinary to fixed conversion applies the save cutoff instead of the original creation time', async () => {
  const s = await setup();
  const ordinary = s.addReminder({ title: '普通事项', date: '2026-10-10' });
  const saved = new Date('2026-10-12T01:31:00Z');
  const converted = s.updateReminder(ordinary.id, { repeat: payload().repeat, notificationEnabled: true }, 'series', { now: saved });
  assert.equal(converted.createdAt, ordinary.createdAt);
  assert.equal(converted.repeat.resumeAfter, saved.toISOString());
  assert.deepEqual(fixedDueOccurrences(converted, saved), []);
});
