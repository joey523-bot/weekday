-- Preserve all unrelated fields and device permissions; newest synced device seeds missing values.
UPDATE account_sync SET
 snapshot_data=json_set(snapshot_data,
 '$.salary.notification.hour',COALESCE(json_extract(snapshot_data,'$.salary.notification.hour'),
  (SELECT reminder_hour FROM salary_push_subscriptions WHERE user_id=account_sync.user_id ORDER BY updated_at DESC,installation_id DESC LIMIT 1),9),
 '$.salary.notification.dailyCountdownEnabled',json(CASE WHEN COALESCE(json_extract(snapshot_data,'$.salary.notification.dailyCountdownEnabled'),
  (SELECT COALESCE(d.enabled,0) FROM salary_push_subscriptions s LEFT JOIN salary_daily_push_rules d ON d.installation_id=s.installation_id WHERE s.user_id=account_sync.user_id ORDER BY s.updated_at DESC,s.installation_id DESC LIMIT 1),0)=1 THEN 'true' ELSE 'false' END)),
 revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE (json_type(snapshot_data,'$.salary.notification.hour') IS NULL OR json_type(snapshot_data,'$.salary.notification.dailyCountdownEnabled') IS NULL);

-- Every existing installation needs a daily delivery ledger, even if its old
-- local toggle was off. Preserve deduplication keys and device enablement.
INSERT INTO salary_daily_push_rules(installation_id,enabled,updated_at)
SELECT s.installation_id,COALESCE(json_extract(a.snapshot_data,'$.salary.notification.dailyCountdownEnabled'),0),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM salary_push_subscriptions s JOIN account_sync a ON a.user_id=s.user_id WHERE 1
ON CONFLICT(installation_id) DO UPDATE SET enabled=excluded.enabled;
