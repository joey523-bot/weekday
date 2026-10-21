import { initializeNotificationPreferences, preserveNotificationPreferences } from "../../_utils/notification-sync.js";
import { validateRepeatSnapshot } from "../../_utils/repeat-sync.js";
import { preserveMissingOccurrences } from "../../_utils/occurrence-sync.js";
import { preserveMissingCategories } from "../../_utils/category-sync.js";
import { badRequest, json } from "../../_utils/http.js";
import { requireSession } from "../../_utils/auth.js";

const MAX_SNAPSHOT_SIZE = 256000;

export async function onRequestGet(context) {
  const result = await requireSession(context);
  if (result.response) return result.response;
  try {
    await initializeNotificationPreferences(context.env.DB, result.session.user_id);
    const record = await context.env.DB.prepare("SELECT snapshot_data, revision, updated_at FROM account_sync WHERE user_id = ?").bind(result.session.user_id).first();
    if (!record) return json({ ok: true, revision: 0, snapshot: null, updatedAt: "" });
    return json({ ok: true, revision: Number(record.revision), snapshot: parseSnapshot(record.snapshot_data), updatedAt: record.updated_at });
  } catch (error) {
    return badRequest("账号同步服务暂时不可用，请稍后重试", 503);
  }
}

export async function onRequestPut(context) {
  const result = await requireSession(context);
  if (result.response) return result.response;
  const body = await context.request.json().catch(() => null);
  const revision = Number(body?.baseRevision);
  if (!Number.isInteger(revision) || revision < 1 || !isSnapshot(body?.snapshot)) return badRequest("同步数据无效");
  try {
    let snapshot = body.snapshot;
    const stored = await context.env.DB.prepare("SELECT snapshot_data FROM account_sync WHERE user_id = ? AND revision = ?")
      .bind(result.session.user_id, revision).first();
    const previous = stored ? parseSnapshot(stored.snapshot_data) : null;
    try { snapshot = preserveNotificationPreferences(validateRepeatSnapshot(snapshot, previous), previous); }
    catch (error) { return badRequest(error.message, error.status || 400); }
    if (!Object.hasOwn(snapshot.preferences?.cycle || {}, 'pushEnabled') || !Object.hasOwn(snapshot.preferences || {}, 'cycle') || !Object.hasOwn(snapshot.preferences || {}, 'customCategories') || snapshot.reminders?.some(item => !Object.hasOwn(item, 'occurredOn'))) {
      if (!Object.hasOwn(snapshot.preferences || {}, 'cycle')) snapshot = { ...snapshot, preferences: {
        ...snapshot.preferences, cycle: previous?.preferences?.cycle || {} } };
      if (!Object.hasOwn(snapshot.preferences?.cycle || {}, 'pushEnabled') && Object.hasOwn(previous?.preferences?.cycle || {}, 'pushEnabled')) {
        snapshot = { ...snapshot, preferences: { ...snapshot.preferences,
          cycle: { ...snapshot.preferences?.cycle, pushEnabled: previous.preferences.cycle.pushEnabled } } };
      }
      snapshot = preserveMissingOccurrences(preserveMissingCategories(snapshot, previous), previous);
      if (!isSnapshot(snapshot)) return badRequest("同步数据无效");
    }
    if (!Object.hasOwn(snapshot.preferences || {}, 'clockout') && previous?.preferences?.clockout) {
      snapshot = {...snapshot,preferences:{...snapshot.preferences,clockout:previous.preferences.clockout}};
    }
    if (!isSnapshot(snapshot)) return badRequest("同步数据无效");
    const now = new Date().toISOString();
    const writes = await context.env.DB.batch([context.env.DB.prepare(
      "UPDATE account_sync SET snapshot_data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?"
    ).bind(JSON.stringify(snapshot), now, result.session.user_id, revision),
      context.env.DB.prepare(`UPDATE reminder_snoozes SET active = 0, updated_at = ?
        WHERE user_id = ? AND active = 1 AND NOT EXISTS (
          SELECT 1 FROM account_sync a, json_each(a.snapshot_data, '$.reminders') r
          WHERE a.user_id = reminder_snoozes.user_id AND json_extract(r.value, '$.id') = reminder_snoozes.reminder_id
            AND COALESCE(json_extract(r.value, '$.completed'), 0) = 0
            AND (json_extract(r.value, '$.repeat') IS NULL OR json_extract(r.value, '$.repeat.status') = 'active')
            AND NOT EXISTS (
              SELECT 1 FROM json_each(a.snapshot_data, '$.reminders') h
              WHERE json_extract(r.value, '$.repeat.mode') = 'fixed'
                AND json_extract(h.value, '$.repeat.seriesId') = json_extract(r.value, '$.repeat.seriesId')
                AND json_extract(h.value, '$.repeat.status') = 'history'
                AND json_extract(h.value, '$.completedAt') >= reminder_snoozes.updated_at
            )
        )`).bind(now, result.session.user_id),
      context.env.DB.prepare(`DELETE FROM reminder_push_rules WHERE installation_id IN (
        SELECT installation_id FROM salary_push_subscriptions WHERE user_id = ?
      ) AND reminder_id IN (SELECT json_extract(r.value, '$.id')
        FROM account_sync a, json_each(a.snapshot_data, '$.reminders') r
        WHERE a.user_id = ? AND json_extract(r.value, '$.repeat') IS NOT NULL)`)
        .bind(result.session.user_id, result.session.user_id)
    ]);
    const write = writes[0];
    if (!write.meta.changes) {
      const latest = await context.env.DB.prepare("SELECT snapshot_data, revision, updated_at FROM account_sync WHERE user_id = ?").bind(result.session.user_id).first();
      return json({ ok: false, conflict: true, revision: Number(latest.revision), snapshot: parseSnapshot(latest.snapshot_data), updatedAt: latest.updated_at }, { status: 409 });
    }
    return json({ ok: true, revision: revision + 1, updatedAt: now });
  } catch (error) {
    return badRequest("账号同步服务暂时不可用，请稍后重试", 503);
  }
}

function isSnapshot(value) {
  try { return Boolean(value && typeof value === "object" && JSON.stringify(value).length <= MAX_SNAPSHOT_SIZE); } catch { return false; }
}

function parseSnapshot(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("云端同步数据无效");
  }
}
