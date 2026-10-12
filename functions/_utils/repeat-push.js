import { repeatDueAt } from "../../scripts/utils/repeat.js";

export const REPEAT_ACCOUNT_SELECT = "SELECT user_id, revision, snapshot_data FROM account_sync";
export const REPEAT_ACCOUNT_FILTER = `EXISTS (SELECT 1 FROM json_each(snapshot_data, '$.reminders') r
  WHERE json_extract(r.value, '$.repeat.status') = 'active')`;

export function repeatPushCandidates(record, now = new Date()) {
  if (!record) return [];
  let snapshot;
  try { snapshot = typeof record.snapshot_data === "string" ? JSON.parse(record.snapshot_data) : record.snapshot_data; }
  catch { return []; }
  return (Array.isArray(snapshot?.reminders) ? snapshot.reminders : []).flatMap(item => {
    const rule = item?.repeat;
    if (!rule || rule.version !== 1 || rule.status !== "active" || item.completed || !item.notificationEnabled ||
      !item.id || !rule.seriesId || !/^\d{4}-\d{2}-\d{2}$/.test(rule.scheduledDate || "")) return [];
    try {
      const dueAt = repeatDueAt(item), due = Date.parse(dueAt);
      // Cron may arrive late; never replay a backlog of old occurrences.
      if (!Number.isFinite(due) || now.getTime() < due || now.getTime() >= due + 3600000) return [];
      return [{ ...item, dueAt }];
    } catch { return []; }
  });
}

export function sameRepeatOccurrence(item, candidate) {
  return item.id === candidate.id && item.repeat.seriesId === candidate.repeat.seriesId &&
    item.repeat.scheduledDate === candidate.repeat.scheduledDate && item.dueAt === candidate.dueAt;
}
