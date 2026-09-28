import webpush from "web-push";
import { snoozeOccurrence } from "../../../scripts/utils/snooze.js";

export async function processSnoozeEntry(rule, env, now = new Date()) {
  const occurrence = snoozeOccurrence(rule, now);
  if (!occurrence) return;
  const devices = await env.DB.prepare(`SELECT * FROM salary_push_subscriptions
    WHERE user_id = ? AND enabled = 1 AND permission = 'granted'`).bind(rule.user_id).all();
  for (const device of devices.results || []) {
    const claim = await env.DB.prepare(`
      INSERT OR IGNORE INTO reminder_snooze_deliveries (token, installation_id, occurrence, status, attempted_at)
      SELECT ?, ?, ?, 'claimed', ? WHERE EXISTS (
        SELECT 1 FROM reminder_snoozes s JOIN account_sync a ON a.user_id=s.user_id,
          json_each(a.snapshot_data, '$.reminders') r
        WHERE s.user_id=? AND s.reminder_id=? AND s.token=? AND s.active=1
          AND (s.mode='once' OR s.until_at>?)
          AND json_extract(r.value,'$.id')=s.reminder_id AND COALESCE(json_extract(r.value,'$.completed'),0)=0
      ) AND EXISTS (SELECT 1 FROM salary_push_subscriptions WHERE installation_id=? AND user_id=? AND enabled=1 AND permission='granted')
    `).bind(rule.token, device.installation_id, occurrence, now.toISOString(), rule.user_id,
      rule.reminder_id, rule.token, now.toISOString(), device.installation_id, rule.user_id).run();
    if (claim.meta.changes !== 1) continue;
    // Re-read immediately before the external send, including current owner/endpoint.
    const live = await env.DB.prepare(`SELECT d.*, json_extract(r.value,'$.title') AS title
      FROM reminder_snoozes s JOIN account_sync a ON a.user_id=s.user_id
      JOIN salary_push_subscriptions d ON d.user_id=s.user_id, json_each(a.snapshot_data, '$.reminders') r
      WHERE s.user_id=? AND s.reminder_id=? AND s.token=? AND s.active=1
        AND (s.mode='once' OR s.until_at>?) AND d.installation_id=? AND d.enabled=1 AND d.permission='granted'
        AND json_extract(r.value,'$.id')=s.reminder_id AND COALESCE(json_extract(r.value,'$.completed'),0)=0
    `).bind(rule.user_id, rule.reminder_id, rule.token, now.toISOString(), device.installation_id).first();
    if (!live) continue;
    try {
      await webpush.sendNotification({endpoint:live.endpoint, keys:{p256dh:live.p256dh, auth:live.auth}}, JSON.stringify({
        title: live.title, body: '这件事还未完成，点开查看或稍后提醒。',
        tag: `snooze-${rule.reminder_id}-${rule.token}-${occurrence}`,
        reminderId: rule.reminder_id,
        url: `${(env.APP_URL || '/').split('#')[0]}#reminder=${encodeURIComponent(rule.reminder_id)}`
      }), { TTL: rule.mode === 'hourly' ? Math.max(1, Math.min(300, Math.floor((Date.parse(rule.until_at)-now.getTime())/1000))) : 300 });
      await env.DB.prepare(`UPDATE reminder_snooze_deliveries SET status='sent' WHERE token=? AND installation_id=? AND occurrence=?`)
        .bind(rule.token, device.installation_id, occurrence).run();
    } catch (error) {
      if ([404,410].includes(error.statusCode)) {
        await env.DB.prepare(`UPDATE salary_push_subscriptions SET enabled=0 WHERE installation_id=? AND user_id=?`)
          .bind(device.installation_id, rule.user_id).run();
      } else if (Number(error.statusCode) >= 400) {
        // An explicit rejection is safe to retry. A transport timeout might already have delivered.
        await env.DB.prepare(`DELETE FROM reminder_snooze_deliveries WHERE token=? AND installation_id=? AND occurrence=?`)
          .bind(rule.token, device.installation_id, occurrence).run();
        continue;
      }
      await env.DB.prepare(`UPDATE reminder_snooze_deliveries SET status='failed-or-unknown' WHERE token=? AND installation_id=? AND occurrence=?`)
        .bind(rule.token, device.installation_id, occurrence).run();
    }
  }
  if (rule.mode === 'once') {
    // Close a one-shot only after every enabled device has a terminal attempt.
    // Concurrent jobs must not close it while another job still owns a pending claim.
    await env.DB.prepare(`UPDATE reminder_snoozes SET active=0
      WHERE user_id=? AND reminder_id=? AND token=? AND active=1
        AND EXISTS (SELECT 1 FROM reminder_snooze_deliveries WHERE token=?)
        AND NOT EXISTS (
          SELECT 1 FROM salary_push_subscriptions d WHERE d.user_id=? AND d.enabled=1 AND d.permission='granted'
            AND NOT EXISTS (SELECT 1 FROM reminder_snooze_deliveries x
              WHERE x.token=? AND x.installation_id=d.installation_id AND x.occurrence=? AND x.status!='claimed')
        )`).bind(rule.user_id, rule.reminder_id, rule.token, rule.token, rule.user_id, rule.token, occurrence).run();
  }

}
