import webpush from 'web-push';
import { repeatNotificationPayload, dailyNotificationPayload } from './push-payloads.js';

const hidden = () => new Response(null, { status: 404 });
const reply = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

// There is no API to create jobs. An operator must explicitly seed an expiring,
// account/device-bound job through D1. Each secret permits at most two attempts.
export async function diagnosticPush(request, env) {
  if (new URL(request.url).pathname !== '/__diagnostics/push' || request.method !== 'POST') return hidden();
  const token = (request.headers.get('Authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return hidden();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  let job;
  try {
    job = await env.DB.prepare(`SELECT * FROM push_diagnostic_runs WHERE token_hash=? AND status='pending' AND expires_at>?`).bind(hash, now).first();
  } catch { return hidden(); } // Unmigrated/unconfigured deployments remain closed.
  if (!job) return hidden();
  const claim = await env.DB.prepare(`UPDATE push_diagnostic_runs SET status='claimed',attempted_at=?
    WHERE token_hash=? AND status='pending' AND expires_at>?`).bind(now, hash, now).run();
  if (claim.meta?.changes !== 1) return hidden();
  const finish = async (status, results) => {
    await env.DB.prepare('UPDATE push_diagnostic_runs SET status=?,results=? WHERE token_hash=?')
      .bind(status, JSON.stringify(results), hash).run();
    return reply({ status, results });
  };
  const device = await env.DB.prepare(`SELECT endpoint,p256dh,auth FROM salary_push_subscriptions
    WHERE user_id=? AND installation_id=? AND enabled=1 AND permission='granted'`)
    .bind(job.user_id, job.installation_id).first();
  const account = await env.DB.prepare('SELECT snapshot_data FROM account_sync WHERE user_id=?').bind(job.user_id).first();
  let item;
  try { item = JSON.parse(account?.snapshot_data || '{}').reminders?.find(r => r.id === job.reminder_id && r.notificationEnabled && ['active','calendar_wait'].includes(r.repeat?.status)); }
  catch { /* Invalid account data cannot be a diagnostic target. */ }
  if (!device || !item || Date.now() >= Date.parse(job.expires_at)) return finish('aborted', []);
  const stamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  // Builders are shared with normal delivery. Labels identify test messages;
  // no reminder history, production dedup key, or subscription is changed.
  const repeat = { ...repeatNotificationPayload(item, env), title: '循环测试',
    body: `循环提醒对照测试 · ${stamp}`, tag: `diagnostic-repeat-${hash.slice(0, 16)}` };
  const daily = { ...dailyNotificationPayload(1, {month:1,day:1}, 'test', env), title: '工资测试',
    body: `工资倒计时对照测试 · ${stamp}`, tag: `diagnostic-salary-${hash.slice(0, 16)}` };
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const results = await Promise.all([{ kind: 'repeat', payload: repeat, options: { TTL: 300, timeout: 15000 } },
    { kind: 'salary_daily', payload: daily, options: { timeout: 15000 } }].map(async message => {
    try {
      const response = await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(message.payload), message.options);
      return { kind: message.kind, status: 'accepted', provider_status: response?.statusCode ?? null,
        provider_ttl: response?.headers?.ttl ?? null, at: new Date().toISOString() };
    } catch (error) {
      return { kind: message.kind, status: 'failed-or-unknown', provider_status: Number(error?.statusCode) || null, at: new Date().toISOString() };
    }
  }));
  return finish('finished', results);
}
