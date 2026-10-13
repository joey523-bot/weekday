import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';
import { processRepeatAccount } from '../workers/salary-notifier/src/repeat.js';
import { REPEAT_ACCOUNT_SELECT, repeatPushCandidates, repeatDeliverySlotKey, sameRepeatOccurrence } from '../functions/_utils/repeat-push.js';
import { validateRepeatSnapshot } from '../functions/_utils/repeat-sync.js';
import { onRequestPut } from '../functions/api/account/sync.js';

const at = value => new Date(`${value}+08:00`);
const times = Array.from({ length: 14 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
const reminder = () => ({ id: 'r', title: '工作日提醒', category: '其他', notes: '', date: '2026-10-12',
  leadDays: 0, hour: 8, notificationEnabled: true, completed: false,
  repeat: { version: 3, seriesId: 'series', freq: 'weekday', mode: 'fixed', interval: 1, unit: 'day',
    weekdays: [1], workday: 'actual', startDate: '2026-10-01', endDate: '', time: '08:00', times: [...times],
    status: 'active', scheduledDate: '2026-10-12', template: { title: '工作日提醒', category: '其他', notes: '',
      leadDays: 0, notificationEnabled: true, time: '08:00' }, overrides: {}, skippedDates: [], resumeAfter: '' } });
const snapshot = () => ({ capabilities: { repeat: 3 }, reminders: [reminder()] });

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../cloudflare/d1-schema.sql', import.meta.url), 'utf8'));
  t.after(() => sql.close());
  let queue = Promise.resolve();
  const DB = { prepare(query) { let args = []; return {
    bind(...values) { args = values; return this; },
    first: async () => sql.prepare(query).get(...args) || null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...args).changes) } })
  }; }, batch(statements) {
    const run = queue.then(async () => {
      sql.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    });
    queue = run.catch(() => {}); return run;
  } };
  for (const user of ['owner', 'other']) {
    sql.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user, user, 'hash', 'salt', 'now', 'now');
    sql.prepare('INSERT INTO account_sync VALUES (?,?,?,?,?)').run(user, JSON.stringify(snapshot()), 1, 'now', 'now');
    const token = (user === 'owner' ? 'a' : 'b').repeat(43);
    sql.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)').run(user, user,
      createHash('sha256').update(token).digest('base64url'), 'now', '2099-01-01', 'now');
    sql.prepare(`INSERT INTO salary_push_subscriptions (installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at)
      VALUES (?,?,'key','auth',?,'granted','now','now')`).run(`${user}device`, `https://example.test/${user}`, user);
  }
  const env = { DB, APP_URL: 'https://example.test' }, sent = [];
  t.mock.method(webpush, 'sendNotification', async (device, payload, options) => sent.push({ endpoint: device.endpoint, ...JSON.parse(payload), options }));
  const record = (user = 'owner') => DB.prepare(`${REPEAT_ACCOUNT_SELECT} WHERE user_id=?`).bind(user).first();
  const current = () => JSON.parse(sql.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='owner'").get().snapshot_data);
  const update = patch => { const data = current(); patch(data); sql.prepare("UPDATE account_sync SET snapshot_data=?,revision=revision+1 WHERE user_id='owner'").run(JSON.stringify(data)); };
  const save = body => onRequestPut({ env, request: new Request('https://example.test/api/account/sync', {
    method: 'PUT', headers: { cookie: `yoyuan_session=${'a'.repeat(43)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }) });
  return { sql, DB, env, sent, record, current, update, save };
}

test('all 14 hourly slots deliver once with unique keys, tags and exact notification routes', async t => {
  const f = fixture(t), record = await f.record();
  for (const time of times) {
    await processRepeatAccount(record, f.env, at(`2026-10-12T${time}:00`));
    await processRepeatAccount(record, f.env, at(`2026-10-12T${time}:30`));
  }
  assert.equal(f.sent.length, 14);
  assert.equal(new Set(f.sent.map(item => item.tag)).size, 14);
  assert.deepEqual(f.sql.prepare('SELECT scheduled_date FROM recurring_reminder_deliveries ORDER BY scheduled_date').all()
    .map(row => row.scheduled_date), times.map(time => `2026-10-12T${time}`));
  for (let index = 0; index < times.length; index++) {
    assert.equal(f.sent[index].url, `https://example.test#reminder=r&occurrence=2026-10-12&slot=${encodeURIComponent(times[index])}`);
    assert.equal(f.sent[index].tag, `repeat-series-2026-10-12T${times[index]}`);
  }
});

test('concurrent Cron claims each device independently and leaves legacy date-only rows untouched', async t => {
  const f = fixture(t);
  f.sql.exec(`INSERT INTO salary_push_subscriptions(installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at)
    VALUES('second','https://example.test/second','key','auth','owner','granted','now','now');
    INSERT INTO recurring_reminder_deliveries VALUES('owner','series','2026-10-09','ownerdevice','r','sent','old')`);
  const record = await f.record();
  await Promise.all(Array.from({ length: 8 }, () => processRepeatAccount(record, f.env, at('2026-10-12T08:00:00'))));
  assert.deepEqual(f.sent.map(item => item.endpoint).sort(), ['https://example.test/owner', 'https://example.test/second']);
  assert.deepEqual({ ...f.sql.prepare("SELECT * FROM recurring_reminder_deliveries WHERE scheduled_date='2026-10-09'").get() },
    { user_id: 'owner', series_id: 'series', scheduled_date: '2026-10-09', installation_id: 'ownerdevice', reminder_id: 'r', status: 'sent', attempted_at: 'old' });
  await processRepeatAccount(await f.record('other'), f.env, at('2026-10-12T08:00:00'));
  assert.equal(f.sent.filter(item => item.endpoint === 'https://example.test/other').length, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM recurring_reminder_deliveries').get().count, 4);
});

test('workday rules include makeup Saturday, exclude holiday/weekend, and never catch up outside the daily window', async t => {
  const f = fixture(t);
  for (const date of ['2026-10-01', '2026-10-05', '2026-10-11', '2027-01-04']) {
    for (const time of times) await processRepeatAccount(await f.record(), f.env, at(`${date}T${time}:00`));
  }
  assert.equal(f.sent.length, 0);
  for (const time of ['07:59:59', '21:01:00', '21:30:00', '23:59:59']) {
    await processRepeatAccount(await f.record(), f.env, at(`2026-10-10T${time}`));
  }
  assert.equal(f.sent.length, 0);
  for (const time of times) await processRepeatAccount(await f.record(), f.env, at(`2026-10-10T${time}:00`));
  assert.equal(f.sent.length, 14);
});

test('within-window delayed Cron retains the due slot and resume cutoff excludes prior slots', () => {
  const item = reminder(), row = { snapshot_data: { reminders: [item] } };
  assert.equal(repeatPushCandidates(row, at('2026-10-12T08:05:00'))[0].repeat.scheduledTime, '08:00');
  item.repeat.resumeAfter = at('2026-10-12T10:15:00').toISOString();
  assert.deepEqual(repeatPushCandidates(row, at('2026-10-12T10:20:00')), []);
  assert.equal(repeatPushCandidates(row, at('2026-10-12T11:00:00'))[0].repeat.scheduledTime, '11:00');
  const next = repeatPushCandidates(row, at('2026-10-12T12:00:00'))[0];
  const changedSlot = { ...next, repeat: { ...next.repeat, scheduledTime: '13:00' } };
  assert.equal(sameRepeatOccurrence(next, changedSlot), false);
});

test('pause, deletion or slot removal after claim blocks sending and releases the unsent claim', async t => {
  for (const change of [data => { data.reminders[0].repeat.status = 'paused'; }, data => { data.reminders = []; },
    data => { const rule = data.reminders[0].repeat; rule.times = times.slice(1); rule.time = rule.template.time = '09:00'; }]) {
    const f = fixture(t), prepare = f.DB.prepare.bind(f.DB); let once = true;
    f.DB.prepare = query => {
      const statement = prepare(query);
      if (query.startsWith('INSERT OR IGNORE INTO recurring_reminder_deliveries')) {
        const run = statement.run;
        statement.run = async () => { const result = await run(); if (once) { once = false; f.update(change); } return result; };
      }
      return statement;
    };
    await processRepeatAccount(await f.record(), f.env, at('2026-10-12T08:00:00'));
    assert.equal(f.sent.length, 0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM recurring_reminder_deliveries').get().count, 0);
  }
});

test('database delay across the final minute stops the later device before send and releases only its claim', async t => {
  const f = fixture(t);
  f.sql.exec(`INSERT INTO salary_push_subscriptions(installation_id,endpoint,p256dh,auth,user_id,permission,created_at,updated_at)
    VALUES('second','https://example.test/second','key','auth','owner','granted','now','now')`);
  const record = await f.record(), prepare = f.DB.prepare.bind(f.DB);
  let elapsed = 0, accountReads = 0;
  f.DB.prepare = query => {
    const statement = prepare(query);
    if (query === `${REPEAT_ACCOUNT_SELECT} WHERE user_id = ?`) {
      const first = statement.first;
      statement.first = async () => {
        const result = await first();
        if (++accountReads === 2) elapsed = 1500;
        return result;
      };
    }
    return statement;
  };
  await processRepeatAccount(record, f.env, at('2026-10-12T21:00:59'), () => elapsed);
  assert.equal(accountReads, 2);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].endpoint, 'https://example.test/owner');
  assert.deepEqual(f.sql.prepare('SELECT installation_id, scheduled_date, status FROM recurring_reminder_deliveries').all()
    .map(row => ({ ...row })), [{ installation_id: 'ownerdevice', scheduled_date: '2026-10-12T21:00', status: 'sent' }]);
});

test('the installed web-push library retains an explicit zero TTL without making a request', () => {
  const request = webpush.generateRequestDetails({ endpoint: 'https://example.test/subscription' }, undefined,
    { TTL: 0, vapidDetails: null });
  assert.equal(request.headers.TTL, 0);
});

test('intraday queue TTL ends at the final minute while early and legacy single-point pushes retain 300 seconds', async t => {
  for (const { stamp, expectedTTL, single = false } of [
    { stamp: '2026-10-12T21:00:30', expectedTTL: 30 },
    { stamp: '2026-10-12T21:00:59.999', expectedTTL: 0 },
    { stamp: '2026-10-12T08:00:30', expectedTTL: 300 },
    { stamp: '2026-10-12T21:00:30', expectedTTL: 300, single: true }
  ]) {
    const f = fixture(t);
    if (single) f.update(data => {
      const rule = data.reminders[0].repeat;
      rule.version = 2; rule.times = []; rule.time = rule.template.time = '21:00';
    });
    await processRepeatAccount(await f.record(), f.env, at(stamp), () => 0);
    assert.equal(f.sent.length, 1, stamp);
    assert.equal(f.sent[0].options.TTL, expectedTTL, `${stamp}, single=${single}`);
  }
});

test('queue TTL and live eligibility use the same advanced send clock after database work', async t => {
  const f = fixture(t), ticks = [0, 10000];
  await processRepeatAccount(await f.record(), f.env, at('2026-10-12T21:00:20'), () => ticks.shift() ?? 10000);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].options.TTL, 30);
  assert.deepEqual(ticks, []);
});

test('completed days still notify; day-level skip and notification override exclude every slot of that day', async t => {
  const f = fixture(t);
  f.update(data => { data.reminders[0].completed = true; });
  await processRepeatAccount(await f.record(), f.env, at('2026-10-12T08:00:00'));
  await processRepeatAccount(await f.record(), f.env, at('2026-10-12T09:00:00'));
  assert.equal(f.sent.length, 2);
  f.update(data => { data.reminders[0].repeat.skippedDates = ['2026-10-12']; });
  await processRepeatAccount(await f.record(), f.env, at('2026-10-12T10:00:00'));
  f.update(data => { const rule = data.reminders[0].repeat; rule.skippedDates = []; rule.overrides['2026-10-12'] = { notificationEnabled: false }; });
  await processRepeatAccount(await f.record(), f.env, at('2026-10-12T11:00:00'));
  assert.equal(f.sent.length, 2);
});

test('cap2 cannot delete, downgrade or omit stored v3 data through the authenticated API', async t => {
  const f = fixture(t), original = f.current();
  for (const reminders of [[], [{ ...reminder(), repeat: undefined }],
    [{ ...reminder(), repeat: { ...reminder().repeat, version: 2, times: [] } }]]) {
    const response = await f.save({ baseRevision: 1, snapshot: { capabilities: { repeat: 2 }, reminders } });
    assert.equal(response.status, 426);
    assert.deepEqual(f.current(), original);
  }
  const updated = f.current(); updated.reminders[0].repeat.status = 'paused';
  assert.equal((await f.save({ baseRevision: 1, snapshot: updated })).status, 200);
  assert.equal(f.current().reminders[0].repeat.status, 'paused');
  assert.equal((await f.save({ baseRevision: 1, snapshot: updated })).status, 409);
});

test('capability detection covers incoming/stored times even when an old version is claimed; unknown versions fail closed', () => {
  const data = snapshot(); data.capabilities.repeat = 2;
  assert.throws(() => validateRepeatSnapshot(data, null), error => error.status === 426);
  data.reminders[0].repeat.version = 2;
  assert.throws(() => validateRepeatSnapshot(data, null), error => error.status === 426);
  assert.throws(() => validateRepeatSnapshot({ capabilities: { repeat: 2 }, reminders: [] }, data), error => error.status === 426);
  for (const version of [0, 4, '3']) {
    const invalid = snapshot(); invalid.reminders[0].repeat.version = version;
    assert.throws(() => validateRepeatSnapshot(invalid, null), error => error.status === 426);
    assert.deepEqual(repeatPushCandidates({ snapshot_data: invalid }, at('2026-10-12T08:00:00')), []);
  }
});

test('server and Worker reject intraday date/lead/mode escapes rather than moving hourly workday reminders', () => {
  const invalidChanges = [
    item => { item.leadDays = 1; },
    item => { item.repeat.template.leadDays = 1; },
    item => { item.repeat.mode = 'after'; },
    item => { item.repeat.overrides['2026-10-12'] = { date: '2026-10-11' }; },
    item => { item.repeat.overrides['2026-10-12'] = { leadDays: 1 }; },
    item => { item.repeat.overrides['2026-10-12'] = { time: '22:00' }; },
    item => { item.repeat.times = ['08:00', '08:30']; },
    item => { item.repeat.times = ['08:00', '10:00']; }
  ];
  for (const change of invalidChanges) {
    const data = snapshot(); change(data.reminders[0]);
    assert.throws(() => validateRepeatSnapshot(data, null));
    assert.deepEqual(repeatPushCandidates({ snapshot_data: data }, at('2026-10-12T08:00:00')), []);
  }
  const valid = snapshot(); valid.reminders[0].repeat.overrides['2026-10-12'] = { title: '当天标题', time: '09:00', date: '2026-10-12', leadDays: 0 };
  const normalized = validateRepeatSnapshot(valid, null);
  const slots = repeatPushCandidates({ snapshot_data: normalized }, at('2026-10-12T08:00:00'));
  assert.equal(slots[0].title, '当天标题');
  assert.equal(slots[0].repeat.scheduledTime, '08:00');
});

test('v3 without an hourly schedule retains the existing date-only delivery key', () => {
  const item = reminder(); item.repeat.times = [];
  assert.equal(repeatDeliverySlotKey(item), '2026-10-12');
  for (const version of [1, 2]) {
    item.repeat.version = version;
    assert.equal(repeatDeliverySlotKey(item), '2026-10-12');
  }
  item.repeat.version = 3; item.repeat.times = times;
  assert.equal(repeatDeliverySlotKey(item), '');
  item.repeat.scheduledTime = '09:00';
  assert.equal(repeatDeliverySlotKey(item), '2026-10-12T09:00');
});
