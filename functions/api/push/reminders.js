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
    "SELECT installation_id FROM salary_push_subscriptions WHERE installation_id = ? AND user_id = ? AND enabled = 1"
  )
    .bind(payload.installationId, session.session.user_id)
    .first();

  if (!subscription) {
    return badRequest("请先开启通知权限");
  }

  const now = new Date().toISOString();
  const statements = [
    context.env.DB.prepare("DELETE FROM reminder_push_rules WHERE installation_id = ?").bind(payload.installationId),
    ...payload.reminders.map((entry) =>
      context.env.DB
        .prepare(
          `
            INSERT INTO reminder_push_rules (
              installation_id, reminder_id, title, category, reminder_date,
              lead_days, reminder_hour, enabled, last_sent_key, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)
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
