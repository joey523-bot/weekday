import webpush from "web-push";
import { cyclePushSuggestions, CYCLE_ACCOUNT_SELECT, matchingCycle } from "../../../functions/_utils/cycle-push.js";

export async function processCycleAccount(record, env, now = new Date()) {
  const suggestions = cyclePushSuggestions(record, now);
  if (!suggestions.length) return;
  const devices = await env.DB.prepare(`SELECT * FROM salary_push_subscriptions
    WHERE user_id=? AND enabled=1 AND permission='granted'`).bind(record.user_id).all();
  for (const candidate of suggestions) for (const device of devices.results || []) {
    const id = crypto.randomUUID(), anchors = JSON.stringify(candidate.anchorTokens), stamp = now.toISOString();
    // A job reservation plus event markers are committed together. The same samples
    // remain seen even after date correction, alias changes, or accepted-item deletion.
    const claim = await env.DB.batch([
      env.DB.prepare(`INSERT INTO cycle_suggestion_deliveries(id,user_id,installation_id,anchor_tokens,status,attempted_at)
        SELECT ?,?,?,?,'claimed',? WHERE EXISTS (
          SELECT 1 FROM account_sync WHERE user_id=? AND revision=?
            AND json_extract(snapshot_data,'$.preferences.cycle.pushEnabled')=1
        ) AND EXISTS (SELECT 1 FROM salary_push_subscriptions WHERE installation_id=? AND user_id=? AND enabled=1 AND permission='granted')
        AND NOT EXISTS (SELECT 1 FROM cycle_suggestion_seen WHERE user_id=? AND installation_id=?
          AND event_token IN (SELECT value FROM json_each(?)))`)
        .bind(id,record.user_id,device.installation_id,anchors,stamp,record.user_id,record.revision,
          device.installation_id,record.user_id,record.user_id,device.installation_id,anchors),
      env.DB.prepare(`INSERT OR IGNORE INTO cycle_suggestion_seen(user_id,installation_id,event_token,delivery_id)
        SELECT ?,?,value,? FROM json_each(?) WHERE EXISTS (SELECT 1 FROM cycle_suggestion_deliveries WHERE id=?)`)
        .bind(record.user_id,device.installation_id,id,JSON.stringify(candidate.tokens),id)
    ]);
    if (claim[0].meta.changes !== 1) continue;
    const [liveAccount, liveDevice] = await Promise.all([
      env.DB.prepare(`${CYCLE_ACCOUNT_SELECT} WHERE user_id=?`).bind(record.user_id).first(),
      env.DB.prepare(`SELECT * FROM salary_push_subscriptions WHERE installation_id=? AND user_id=? AND enabled=1 AND permission='granted'`)
        .bind(device.installation_id,record.user_id).first()
    ]);
    const live = matchingCycle(cyclePushSuggestions(liveAccount, now), candidate.anchorTokens);
    if (!live || !liveDevice) {
      await env.DB.prepare(`UPDATE cycle_suggestion_deliveries SET status='cancelled' WHERE id=?`).bind(id).run(); continue;
    }
    try {
      await webpush.sendNotification({ endpoint:liveDevice.endpoint,keys:{p256dh:liveDevice.p256dh,auth:liveDevice.auth} },JSON.stringify({
        title: `要安排“${live.title}”吗？`,
        body: `最近${live.dates.length}次间隔约${live.median}天，预计${live.expected}。点开确认日期和时间后创建。`,
        tag: `cycle-${id}`, url: `${(env.APP_URL || '/').split('#')[0]}#cycle=${encodeURIComponent(id)}`
      }), { TTL:300 });
      await env.DB.prepare(`UPDATE cycle_suggestion_deliveries SET status='sent' WHERE id=?`).bind(id).run();
    } catch(error) {
      if ([404,410].includes(error.statusCode)) {
        await env.DB.prepare(`UPDATE salary_push_subscriptions SET enabled=0 WHERE installation_id=? AND user_id=?`).bind(device.installation_id,record.user_id).run();
      } else if (Number(error.statusCode)>=400) {
        // An explicit provider rejection is retryable; unknown transport outcomes are not.
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM cycle_suggestion_seen WHERE delivery_id=?`).bind(id),
          env.DB.prepare(`DELETE FROM cycle_suggestion_deliveries WHERE id=?`).bind(id)
        ]); continue;
      }
      await env.DB.prepare(`UPDATE cycle_suggestion_deliveries SET status='failed-or-unknown' WHERE id=?`).bind(id).run();
    }
  }
}
