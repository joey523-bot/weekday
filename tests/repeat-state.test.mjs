import test from 'node:test';
import assert from 'node:assert/strict';

let serial = 0;
async function setup() {
  const storage = new Map();
  let fail = false;
  globalThis.localStorage = { getItem: key => storage.get(key) || null,
    setItem: (key, value) => { if (fail) throw new Error('quota'); storage.set(key, value); } };
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class {};
  const state = await import(`../scripts/state.js?repeat-state-${++serial}`);
  return { ...state, fail(value) { fail = value; }, async reload() { return import(`../scripts/state.js?repeat-state-${++serial}`); } };
}
const now = new Date('2026-10-12T03:00:00Z');
const payload = extra => ({ title: '浇花', date: '2026-10-10', category: '生活', notes: '窗台',
  leadDays: 0, notificationEnabled: true, hour: 9,
  repeat: { freq: 'day', startDate: '2026-10-10', time: '09:30', ...extra } });
const live = s => s.getState().reminders.filter(item => item.repeat?.status !== 'history');
const history = s => s.getState().reminders.filter(item => item.repeat?.status === 'history');

test('adding a series validates, sets first matching date, snapshots time and survives reload', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'week', weekdays: [1] }));
  assert.equal(added.date, '2026-10-12');
  assert.equal(added.repeat.scheduledDate, added.date);
  assert.equal(added.repeat.template.time, '09:30');
  assert.equal(added.repeat.template.title, '浇花');
  assert.ok(added.repeat.seriesId);
  assert.deepEqual(s.getSyncSnapshot().capabilities, { repeat: 1 });
  const reloaded = await s.reload();
  assert.deepEqual(reloaded.getState().reminders, s.getState().reminders);
  assert.throws(() => s.addReminder(payload({ startDate: '2026-02-30' })), /开始日期/);
  assert.equal(s.getState().reminders.length, 1);
});

test('overdue fixed series creates one next anchored future item and immutable completion history', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const next = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-11', now });
  assert.equal(next.date, '2026-10-13');
  assert.notEqual(next.id, added.id);
  assert.equal(next.repeat.seriesId, added.repeat.seriesId);
  assert.equal(live(s).length, 1);
  assert.equal(history(s).length, 1);
  const past = history(s)[0];
  assert.equal(past.occurredOn, '2026-10-11');
  assert.equal(past.completedAt, now.toISOString());
  assert.equal(past.repeatOutcome, 'completed');
  assert.throws(() => s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-11', now }), /历史/);
  assert.throws(() => s.setReminderCompletion(added.id, false), /历史/);
  assert.throws(() => s.updateReminder(added.id, { title: '更改历史' }, 'series'), /历史/);
  assert.equal(s.getState().reminders.length, 2);
});

test('skipping uses Beijing today, never creates a completed occurrence sample', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'custom', mode: 'after', interval: 3, unit: 'day' }));
  const next = s.manageRepeat(added.id, 'skip', { occurredOn: '2026-10-01', now: new Date('2026-10-12T18:00:00Z') });
  assert.equal(next.date, '2026-10-16');
  assert.equal(history(s)[0].occurredOn, '');
  assert.equal(history(s)[0].repeatOutcome, 'skipped');
  assert.equal(history(s)[0].completed, true);
  const reloaded = await s.reload();
  assert.equal(history(reloaded)[0].occurredOn, '');
});

test('after-completion intervals use actual completion date instead of scheduled date or click date', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'custom', mode: 'after', interval: 2, unit: 'week' }));
  assert.throws(() => s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-13', now }), /实际发生日期/);
  const next = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-08', now });
  assert.equal(next.date, '2026-10-22');
});

test('once edits change current date/content/time but next item inherits unchanged series template', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  s.updateReminder(added.id, { title: '本次标题', date: '2026-10-20', category: '本次', notes: '仅本次',
    leadDays: 1, notificationEnabled: false, repeat: { ...added.repeat, time: '19:45' } }, 'once');
  const current = live(s)[0];
  assert.equal(current.date, '2026-10-20');
  assert.equal(current.repeat.scheduledDate, '2026-10-10');
  assert.equal(current.repeat.template.title, '浇花');
  assert.equal(current.repeat.time, '19:45');
  const next = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-12', now });
  assert.equal(next.date, '2026-10-13');
  assert.equal(next.title, '浇花');
  assert.equal(next.notes, '窗台');
  assert.equal(next.notificationEnabled, true);
  assert.equal(next.leadDays, 0);
  assert.equal(next.repeat.time, '09:30');
  assert.equal(history(s)[0].title, '本次标题');
});

test('series edit updates current and future template but leaves historical versions untouched', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const next = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-10', now });
  const historical = JSON.stringify(history(s)[0]);
  s.updateReminder(next.id, { title: '新系列名称', notes: '全部以后', repeat: { ...next.repeat, time: '18:45' } }, 'series');
  assert.equal(live(s)[0].repeat.template.title, '新系列名称');
  const future = s.manageRepeat(next.id, 'skip', { now });
  assert.equal(future.title, '新系列名称');
  assert.equal(future.repeat.time, '18:45');
  assert.equal(JSON.stringify(history(s)[0]), historical);
});

test('fixed resume skips backlog and after-completion resume retains unfinished exception', async () => {
  const s = await setup();
  const fixed = s.addReminder(payload());
  s.manageRepeat(fixed.id, 'pause', { now });
  assert.throws(() => s.manageRepeat(fixed.id, 'skip', { now }), /恢复/);
  const resumed = s.manageRepeat(fixed.id, 'resume', { now });
  assert.equal(resumed.date, '2026-10-13');
  assert.equal(resumed.repeat.status, 'active');
  assert.equal(history(s).length, 0);
  const after = s.addReminder(payload({ freq: 'custom', mode: 'after', interval: 3 }));
  s.updateReminder(after.id, { date: '2026-10-11' });
  s.manageRepeat(after.id, 'pause', { now });
  const retained = s.manageRepeat(after.id, 'resume', { now });
  assert.equal(retained.date, '2026-10-11');
  assert.equal(retained.id, after.id);
});

test('end boundary stops creation; explicit end retains readable current record', async () => {
  const s = await setup();
  const expiring = s.addReminder(payload({ endDate: '2026-10-12' }));
  const terminal = s.manageRepeat(expiring.id, 'complete', { occurredOn: '2026-10-12', now });
  assert.equal(terminal.repeat.status, 'history');
  assert.equal(live(s).length, 0);
  const another = s.addReminder(payload());
  const ended = s.manageRepeat(another.id, 'end', { now });
  assert.equal(ended.repeat.status, 'ended');
  assert.equal(ended.completed, false);
  assert.throws(() => s.manageRepeat(another.id, 'resume', { now }), /已结束/);
});

test('unsupported workday year keeps recoverable calendar_wait placeholder', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'weekday', startDate: '2099-01-01', workday: 'actual' }));
  assert.equal(added.repeat.status, 'calendar_wait');
  assert.equal(added.date, '2099-01-01');
  assert.equal(added.repeat.scheduledDate, '2099-01-01');
  const waiting = s.manageRepeat(added.id, 'resume', { now });
  assert.equal(waiting.repeat.status, 'calendar_wait');
  assert.equal(s.getState().reminders.length, 1);
  s.updateReminder(added.id, { repeat: { ...waiting.repeat, workday: 'weekdays' } }, 'series');
  assert.equal(live(s)[0].repeat.status, 'active');
});

test('storage failures roll back add, completion, edit, pause, delete and synced replacement', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const before = JSON.stringify(s.getState());
  s.fail(true);
  for (const mutation of [
    () => s.addReminder(payload()),
    () => s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-12', now }),
    () => s.updateReminder(added.id, { title: '不可保存' }, 'series'),
    () => s.manageRepeat(added.id, 'pause', { now }),
    () => s.deleteReminder(added.id),
    () => s.replaceSyncedData({ reminders: [] })
  ]) {
    assert.throws(mutation, /quota/);
    assert.equal(JSON.stringify(s.getState()), before);
  }
  s.fail(false);
  const reloaded = await s.reload();
  assert.equal(JSON.stringify(reloaded.getState()), before);
});

test('ordinary reminders remain compatible and can become series without changing id', async () => {
  const s = await setup();
  const ordinary = s.addReminder({ title: '普通事项', date: '2026-10-10', hour: 8 });
  assert.equal(Object.hasOwn(ordinary, 'repeat'), false);
  s.updateReminder(ordinary.id, { repeat: payload().repeat }, 'series');
  const converted = live(s)[0];
  assert.equal(converted.id, ordinary.id);
  assert.ok(converted.repeat.seriesId);
  s.updateReminder(ordinary.id, { repeat: null }, 'series');
  assert.equal(Object.hasOwn(live(s)[0], 'repeat'), false);
  s.setReminderCompletion(ordinary.id, true, '2026-10-01');
  s.setReminderCompletion(ordinary.id, false);
  assert.equal(live(s)[0].completed, false);
});

test('series rule changes never move current schedule back into completed history', async () => {
  const s = await setup();
  const added = s.addReminder(payload());
  const current = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-12', now });
  assert.equal(current.date, '2026-10-13');
  const updated = s.updateReminder(current.id, { repeat: { ...current.repeat, endDate: '2026-12-31' } }, 'series');
  assert.equal(updated.date, '2026-10-13');
  const weekly = s.updateReminder(current.id, { repeat: { ...updated.repeat, freq: 'week', weekdays: [1] } }, 'series');
  assert.equal(weekly.date, '2026-10-19');
  assert.equal(history(s)[0].date, '2026-10-10');
  assert.equal(history(s).length, 1);
});

test('calendar wait distinguishes initial pending plan from last processed plan', async () => {
  const s = await setup();
  const initial = s.addReminder(payload({ freq: 'weekday', startDate: '2099-01-01', workday: 'actual' }));
  assert.equal(initial.repeat.waitingAfterDate, '');
  const finalKnown = s.addReminder(payload({ freq: 'weekday', startDate: '2026-12-31', workday: 'actual' }));
  const next = s.manageRepeat(finalKnown.id, 'skip', { now: new Date('2026-12-31T00:00:00Z') });
  assert.equal(next.repeat.status, 'calendar_wait');
  assert.equal(next.repeat.waitingAfterDate, '2026-12-31');
  const reloaded = await s.reload();
  const stored = reloaded.getState().reminders.find(item => item.id === next.id);
  assert.equal(stored.repeat.waitingAfterDate, '2026-12-31');
});

test('changing an after-completion interval preserves the current unfinished item', async () => {
  const s = await setup();
  const added = s.addReminder(payload({ freq: 'custom', mode: 'after', interval: 3 }));
  const current = s.manageRepeat(added.id, 'complete', { occurredOn: '2026-10-12', now });
  const updated = s.updateReminder(current.id, { repeat: { ...current.repeat, interval: 5 } }, 'series');
  assert.equal(updated.date, '2026-10-15');
  const next = s.manageRepeat(updated.id, 'skip', { now: new Date('2026-10-15T00:00:00Z') });
  assert.equal(next.date, '2026-10-20');
});

test('resuming before current due time keeps that future or same-day period', async () => {
  const s = await setup();
  const future = s.addReminder(payload({ startDate: '2026-10-20' }));
  s.manageRepeat(future.id, 'pause', { now });
  assert.equal(s.manageRepeat(future.id, 'resume', { now }).date, '2026-10-20');
  const laterToday = s.addReminder(payload({ startDate: '2026-10-12', time: '18:30' }));
  s.manageRepeat(laterToday.id, 'pause', { now });
  assert.equal(s.manageRepeat(laterToday.id, 'resume', { now }).date, '2026-10-12');
});

test('recovering the first calendar period preserves an unprocessed future start', async () => {
  const s = await setup();
  const initial = s.addReminder(payload({ freq: 'weekday', startDate: '2099-01-01', workday: 'actual' }));
  // Simulate a now-resolvable rule without pretending a first period had been processed.
  s.replaceSyncedData({ reminders: [{ ...initial, repeat: { ...initial.repeat, workday: 'weekdays' } }] });
  const recovered = s.manageRepeat(initial.id, 'resume', { now });
  assert.equal(recovered.repeat.status, 'active');
  assert.equal(recovered.date, '2099-01-01');
  assert.equal(recovered.repeat.waitingAfterDate, '');
});
