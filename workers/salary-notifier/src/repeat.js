import webpush from "web-push";
import { REPEAT_ACCOUNT_SELECT, repeatPushCandidates, sameRepeatOccurrence } from "../../../functions/_utils/repeat-push.js";

export async function processRepeatAccount(record, env, now = new Date()) {
  const candidates = repeatPushCandidates(record, now);
  if (!candidates.length) return;
  const devices = await env.DB.prepare(`SELECT * FROM salary_push_subscriptions
    WHERE user_id = ? AND enabled = 1 AND permission = 'granted'`).bind(record.user_id).all();
  for (const candidate of candidates) for (const device of devices.results || []) {
    const key = [record.user_id, candidate.repeat.seriesId, candidate.repeat.scheduledDate, device.installation_id];
    const claim = await env.DB.prepare(`INSERT OR IGNORE INTO recurring_reminder_deliveries
      (user_id, series_id, scheduled_date, installation_id, reminder_id, status, attempted_at)
      SELECT ?, ?, ?, ?, ?, 'claimed', ? WHERE EXISTS (
        SELECT 1 FROM account_sync WHERE user_id = ? AND revision = ?
      ) AND EXISTS (SELECT 1 FROM salary_push_subscriptions
        WHERE installation_id = ? AND user_id = ? AND enabled = 1 AND permission = 'granted')`)
      .bind(...key, candidate.id, now.toISOString(), record.user_id, record.revision, device.installation_id, record.user_id).run();
    if (claim.meta?.changes !== 1) continue;
    const [account, currentDevice] = await Promise.all([
      env.DB.prepare(`${REPEAT_ACCOUNT_SELECT} WHERE user_id = ?`).bind(record.user_id).first(),
      env.DB.prepare(`SELECT * FROM salary_push_subscriptions
        WHERE installation_id = ? AND user_id = ? AND enabled = 1 AND permission = 'granted'`)
        .bind(device.installation_id, record.user_id).first()
    ]);
    const live = repeatPushCandidates(account, now).find(item => sameRepeatOccurrence(item, candidate));
    if (!live || !currentDevice) {
      // No send happened: a later valid edit/resume may claim this occurrence.
      await removeClaim(env, key);
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: currentDevice.endpoint,
        keys: { p256dh: currentDevice.p256dh, auth: currentDevice.auth } }, JSON.stringify({
        title: live.title,
        body: Number(live.leadDays) > 0 ? `${live.leadDays}天后需要处理：${live.title}（循环事项）。` : `今天需要处理：${live.title}（循环事项）。`,
        tag: `repeat-${live.repeat.seriesId}-${live.repeat.scheduledDate}`,
        reminderId: live.id,
        url: `${(env.APP_URL || '/').split('#')[0]}#reminder=${encodeURIComponent(live.id)}&occurrence=${encodeURIComponent(live.repeat.scheduledDate)}`
      }), { TTL: 300 });
      await setStatus(env, key, "sent");
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) {
        await env.DB.prepare(`UPDATE salary_push_subscriptions SET enabled = 0, updated_at = ?
          WHERE installation_id = ? AND user_id = ?`).bind(now.toISOString(), device.installation_id, record.user_id).run();
      } else if (Number(error?.statusCode) >= 400) {
        // Explicit rejection is retryable. An uncertain transport outcome is not.
        await removeClaim(env, key);
        continue;
      }
      await setStatus(env, key, "failed-or-unknown");
    }
  }
}

function removeClaim(env, key) {
  return env.DB.prepare(`DELETE FROM recurring_reminder_deliveries
    WHERE user_id = ? AND series_id = ? AND scheduled_date = ? AND installation_id = ? AND status = 'claimed'`)
    .bind(...key).run();
}
function setStatus(env, key, status) {
  return env.DB.prepare(`UPDATE recurring_reminder_deliveries SET status = ?
    WHERE user_id = ? AND series_id = ? AND scheduled_date = ? AND installation_id = ?`)
    .bind(status, ...key).run();
}
