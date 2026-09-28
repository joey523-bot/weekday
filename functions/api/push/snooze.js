import { badRequest, json } from "../../_utils/http.js";
import { requireSession } from "../../_utils/auth.js";
import { makeSnoozePlan, nextSnoozeTime } from "../../../scripts/utils/snooze.js";

export async function onRequestGet(context) {
  const auth = await requireSession(context);
  if (auth.response) return auth.response;
  const id = new URL(context.request.url).searchParams.get('id');
  try {
    const rule = await context.env.DB.prepare(`SELECT * FROM reminder_snoozes WHERE user_id = ? AND reminder_id = ?`)
      .bind(auth.session.user_id, id).first();
    if (!rule?.active || (rule.mode === 'hourly' && Date.now() >= Date.parse(rule.until_at))) return json({ rule: null });
    const live = await context.env.DB.prepare(`SELECT snapshot_data FROM account_sync WHERE user_id = ?`).bind(auth.session.user_id).first();
    const reminder = JSON.parse(live?.snapshot_data || '{}').reminders?.find(r => r.id === id && !r.completed);
    if (!reminder) return json({ rule: null });
    const delivery = await context.env.DB.prepare(`SELECT status FROM reminder_snooze_deliveries WHERE token = ? LIMIT 1`).bind(rule.token).first();
    return json({ rule: { mode: rule.mode, nextAt: nextSnoozeTime(rule), untilAt: rule.until_at,
      attempted: rule.mode === 'once' && Boolean(delivery), token: rule.token } });
  } catch { return badRequest('稍后提醒暂时不可用，请重试', 503); }
}
export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (auth.response) return auth.response;
  const body = await context.request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return badRequest('缺少事项');
  const user = auth.session.user_id, now = new Date();
  try {
    if (body.action === 'stop') {
      await context.env.DB.prepare(`UPDATE reminder_snoozes SET active = 0, updated_at = ? WHERE user_id = ? AND reminder_id = ?`)
        .bind(now.toISOString(), user, id).run();
      return json({ ok: true });
    }
    let plan;
    try { plan = makeSnoozePlan(body, now); } catch (error) { return badRequest(error.message); }
    // Account truth and subscription ownership are checked within the write, not client state.
    const result = await context.env.DB.prepare(`
      INSERT INTO reminder_snoozes (user_id, reminder_id, token, mode, next_at, until_at, active, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, 1, ?
      WHERE EXISTS (SELECT 1 FROM account_sync a, json_each(a.snapshot_data, '$.reminders') r
        WHERE a.user_id = ? AND json_extract(r.value, '$.id') = ? AND COALESCE(json_extract(r.value, '$.completed'), 0) = 0)
        AND EXISTS (SELECT 1 FROM salary_push_subscriptions WHERE user_id = ? AND enabled = 1 AND permission = 'granted')
      ON CONFLICT(user_id, reminder_id) DO UPDATE SET token=excluded.token, mode=excluded.mode,
        next_at=excluded.next_at, until_at=excluded.until_at, active=1, updated_at=excluded.updated_at
    `).bind(user, id, crypto.randomUUID(), plan.mode, plan.nextAt, plan.untilAt, now.toISOString(), user, id, user).run();
    if (result.meta.changes !== 1) return badRequest('请确认事项未完成，并在“我的”中开启通知');
    return json({ ok: true, ...plan });
  } catch { return badRequest('稍后提醒保存失败，请重试', 503); }
}
