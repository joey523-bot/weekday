import { badRequest, json } from "../../_utils/http.js";
import { normalizePushPayload } from "../../_utils/push.js";
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

  const payload = normalizePushPayload(body);
  if (!payload.installationId) {
    return badRequest("缺少 installationId");
  }

  if (!payload.endpoint || !payload.p256dh || !payload.auth) {
    return badRequest("缺少完整的 push subscription");
  }

  const now = new Date().toISOString();
  const userAgent = context.request.headers.get("user-agent") || "";

  await context.env.DB.prepare(
    `
      INSERT INTO salary_push_subscriptions (
        installation_id,
        endpoint,
        p256dh,
        auth,
        salary_day,
        lead_days,
        reminder_hour,
        timezone,
        enabled,
        permission,
        app_name,
        user_agent,
        user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(installation_id) DO UPDATE SET
        endpoint = excluded.endpoint,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        salary_day = excluded.salary_day,
        lead_days = excluded.lead_days,
        reminder_hour = excluded.reminder_hour,
        timezone = excluded.timezone,
        enabled = 1,
        permission = excluded.permission,
        app_name = excluded.app_name,
        user_agent = excluded.user_agent,
        user_id = excluded.user_id,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      payload.installationId,
      payload.endpoint,
      payload.p256dh,
      payload.auth,
      payload.salaryDay,
      payload.leadDays,
      payload.reminderHour,
      "Asia/Shanghai",
      payload.permission,
      payload.appName,
      userAgent,
      session.session.user_id,
      now,
      now
    )
    .run();

  return json({
    ok: true,
    installationId: payload.installationId,
    syncedAt: now
  });
}
