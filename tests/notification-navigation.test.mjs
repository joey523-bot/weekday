import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { processReminderEntry } from '../workers/salary-notifier/src/index.js';
import webpush from '../workers/salary-notifier/node_modules/web-push/src/index.js';

function serviceWorker(windows = [], openWindow = async url => url) {
  const handlers = {};
  const notifications = [];
  const context = vm.createContext({ URL, URLSearchParams, Date, console,
    self: { location: { origin: 'https://app.test' }, registration: {
      scope: 'https://app.test/', showNotification: async (title, options) => notifications.push({ title, ...options })
    }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    clients: { matchAll: async () => windows, openWindow }
  });
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  return { notifications, async dispatch(type, value = {}) {
    let pending;
    handlers[type]({ ...value, waitUntil: promise => { pending = promise; } });
    return await pending;
  } };
}
const notification = data => ({ data, close() {} });

test('reminder Worker payload carries ID and encoded route without changing copy', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-28T01:05:00Z') });
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (_s, payload) => sent.push(JSON.parse(payload)));
  const env = { APP_URL: 'https://app.test/', DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
  await processReminderEntry({ reminder_id: '事项 /&1', title: '测试事项', reminder_date: '2026-09-28',
    reminder_hour: 9, timezone: 'Asia/Shanghai', lead_days: 0, installation_id: 'test', endpoint: 'https://example.test', p256dh: 'test', auth: 'test' }, env);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].reminderId, '事项 /&1');
  assert.equal(new URLSearchParams(new URL(sent[0].url).hash.slice(1)).get('reminder'), '事项 /&1');
  assert.equal(sent[0].body, '今天需要处理：测试事项。');
});

test('push preserves routing metadata', async () => {
  const sw = serviceWorker();
  await sw.dispatch('push', { data: { text: () => JSON.stringify({ title: 't', reminderId: 'r1', url: '/#reminder=r1' }) } });
  assert.equal(sw.notifications[0].data.reminderId, 'r1');
  assert.equal(sw.notifications[0].data.url, '/#reminder=r1');
});

test('cold notification opens its exact reminder', async () => {
  const result = await serviceWorker().dispatch('notificationclick', { notification: notification({ reminderId: 'r1', url: '/' }) });
  assert.equal(result, 'https://app.test/#reminder=r1');
});

test('warm notification navigates then focuses, preserving document search', async () => {
  const calls = [];
  const client = { url: 'https://app.test/?refresh=1', navigate: async url => { calls.push(url); return client; }, focus: async () => calls.push('focus') };
  await serviceWorker([client]).dispatch('notificationclick', { notification: notification({ reminderId: 'r2', url: '/' }) });
  assert.equal(new URL(calls[0]).search, '?refresh=1');
  assert.equal(new URLSearchParams(new URL(calls[0]).hash.slice(1)).get('reminder'), 'r2');
  assert.equal(calls[1], 'focus');
});

test('closed client falls back to openWindow; foreign URL is rejected', async () => {
  const client = { url: 'https://app.test/', navigate: async () => { throw Error('closed'); } };
  const result = await serviceWorker([client]).dispatch('notificationclick', { notification: notification({ url: 'https://evil.test/' }) });
  assert.equal(result, 'https://app.test/');
});

test('salary/legacy notifications still open the home route', async () => {
  assert.equal(await serviceWorker().dispatch('notificationclick', { notification: notification({ url: '/' }) }), 'https://app.test/');
});
