export function hasNotificationPreferences(snapshot) {
  const n = snapshot?.salary?.notification;
  return Number.isInteger(n?.hour) && n.hour >= 0 && n.hour <= 23 && typeof n.dailyCountdownEnabled === 'boolean';
}
export function preserveNotificationPreferences(snapshot, previous) {
  if (snapshot?.capabilities?.notifications === 1) {
    if (!hasNotificationPreferences(snapshot)) throw new Error('账号通知设置无效');
    return snapshot;
  }
  if (!hasNotificationPreferences(previous)) return snapshot;
  return { ...snapshot, salary: { ...snapshot.salary, notification: { ...snapshot.salary?.notification,
    hour: previous.salary.notification.hour, dailyCountdownEnabled: previous.salary.notification.dailyCountdownEnabled } } };
}
// Old accounts initialize only missing fields, from the most recently synced
// installation. This CAS-safe SQL never overwrites a later account preference.
export const INITIALIZE_NOTIFICATION_SQL = `UPDATE account_sync SET
 snapshot_data=json_set(snapshot_data,
 '$.salary.notification.hour',COALESCE(json_extract(snapshot_data,'$.salary.notification.hour'),
  (SELECT reminder_hour FROM salary_push_subscriptions WHERE user_id=account_sync.user_id ORDER BY updated_at DESC,installation_id DESC LIMIT 1),9),
 '$.salary.notification.dailyCountdownEnabled',json(CASE WHEN COALESCE(json_extract(snapshot_data,'$.salary.notification.dailyCountdownEnabled'),
  (SELECT COALESCE(d.enabled,0) FROM salary_push_subscriptions s LEFT JOIN salary_daily_push_rules d ON d.installation_id=s.installation_id WHERE s.user_id=account_sync.user_id ORDER BY s.updated_at DESC,s.installation_id DESC LIMIT 1),0)=1 THEN 'true' ELSE 'false' END)),
 revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE (json_type(snapshot_data,'$.salary.notification.hour') IS NULL OR json_type(snapshot_data,'$.salary.notification.dailyCountdownEnabled') IS NULL)`;
export async function initializeNotificationPreferences(DB, userId) {
  await DB.prepare(INITIALIZE_NOTIFICATION_SQL + ' AND user_id=?').bind(userId).run();
}
export async function accountNotificationPreferences(DB, userId) {
  if (!userId) return null;
  const record = await DB.prepare('SELECT snapshot_data FROM account_sync WHERE user_id=?').bind(userId).first();
  try { const snapshot=JSON.parse(record?.snapshot_data || '{}'); return hasNotificationPreferences(snapshot) ? snapshot.salary.notification : null; }
  catch { return null; }
}
