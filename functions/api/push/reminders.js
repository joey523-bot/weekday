import { badRequest, json } from "../../_utils/http.js";
import { normalizeReminderPushRules } from "../../_utils/push.js";
import { requireSession } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  const session = await requireSession(context);
  if (session.response) return session.response;
  if (!context.env.DB) {
    return badRequest("缺少 D1 绑定 DB", 503);
  }

  const body = await context.request.json().catch(() => null);
  if (!body) {
    return badRequest("请求体必须是合法 JSON");
  }

  const payload = normalizeReminderPushRules(body);
  if (!payload.installationId) {
    return badRequest("缺少 installationId");
  }

  const subscription = await context.env.DB.prepare(
    `SELECT d.installation_id, a.snapshot_data FROM salary_push_subscriptions d
      LEFT JOIN account_sync a ON a.user_id = d.user_id
      WHERE d.installation_id = ? AND d.user_id = ? AND d.enabled = 1`
  )
    .bind(payload.installationId, session.session.user_id)
    .first();

  if (!subscription) {
    return badRequest("请先开启通知权限");
  }

  // An old client may omit repeat. The account snapshot remains authoritative.
  let stored;
  try { stored = JSON.parse(subscription.snapshot_data || '{}'); }
  catch { return badRequest("账号事项数据暂时不可用，请重试", 503); }
  const recurringIds = new Set((stored.reminders || []).filter(item => item?.repeat != null).map(item => item.id));
  payload.reminders = payload.reminders.filter(item => !recurringIds.has(item.reminderId));
  const now = new Date().toISOString();
  const statements = [
    context.env.DB.prepare(`DELETE FROM reminder_push_rules WHERE installation_id = ?
      AND reminder_id NOT IN (SELECT value FROM json_each(?))`).bind(payload.installationId, JSON.stringify(payload.reminders.map(r => r.reminderId))),
    ...payload.reminders.map((entry) =>
      context.env.DB
        .prepare(
          `
            INSERT INTO reminder_push_rules (
              installation_id, reminder_id, title, category, reminder_date,
              lead_days, reminder_hour, enabled, last_sent_key, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)
            ON CONFLICT(installation_id, reminder_id) DO UPDATE SET
              title=excluded.title, category=excluded.category, reminder_date=excluded.reminder_date,
              lead_days=excluded.lead_days, reminder_hour=excluded.reminder_hour, enabled=1, updated_at=excluded.updated_at
          `
        )
        .bind(
          payload.installationId,
          entry.reminderId,
          entry.title,
          entry.category,
          entry.reminderDate,
          entry.leadDays,
          entry.reminderHour,
          now,
          now
        )
    )
  ];

  await context.env.DB.batch(statements);

  return json({ ok: true, count: payload.reminders.length, syncedAt: now });
}
