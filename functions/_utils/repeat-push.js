import { repeatDueAt, fixedDueOccurrences, validRepeatDate } from "../../scripts/utils/repeat.js";
import { validateRepeatReminder } from "./repeat-sync.js";

export const REPEAT_ACCOUNT_SELECT = "SELECT user_id, revision, snapshot_data FROM account_sync";
export const REPEAT_ACCOUNT_FILTER = `EXISTS (SELECT 1 FROM json_each(snapshot_data, '$.reminders') r
  WHERE json_extract(r.value, '$.repeat.status') IN ('active','calendar_wait'))`;

export function repeatPushCandidates(record, now = new Date()) {
  if (!record) return [];
  let snapshot;
  try { snapshot = typeof record.snapshot_data === "string" ? JSON.parse(record.snapshot_data) : record.snapshot_data; }
  catch { return []; }
  return (Array.isArray(snapshot?.reminders) ? snapshot.reminders : []).flatMap(item => {
    const raw = item?.repeat;
    if (!raw || ![1,2,3].includes(raw.version) || !['active','calendar_wait'].includes(raw.status) || !item.id || !raw.seriesId) return [];
    try {
      const normalized = validateRepeatReminder(item), rule = normalized.repeat;
      if (rule.mode === 'fixed') return fixedDueOccurrences(normalized,now).filter(slot => slot.notificationEnabled && repeatDeliverySlotKey(slot));
      if (rule.status !== 'active' || item.completed || !item.notificationEnabled || !/^\d{4}-\d{2}-\d{2}$/.test(rule.scheduledDate || '')) return [];
      const dueAt = repeatDueAt(item), due = Date.parse(dueAt);
      if (!Number.isFinite(due) || now.getTime() < due || now.getTime() >= due + 3600000) return [];
      return [{ ...item, dueAt }];
    } catch { return []; }
  });
}

// The existing TEXT key keeps legacy date-only deliveries intact. A v3 day has
// multiple notification slots, even though completion and edits remain day-level.
export function repeatDeliverySlotKey(candidate) {
  const rule = candidate?.repeat;
  if (!validRepeatDate(rule?.scheduledDate)) return '';
  if (Array.isArray(rule.times) && rule.times.length) {
    return rule.version === 3 && rule.times.includes(rule.scheduledTime)
      ? `${rule.scheduledDate}T${rule.scheduledTime}` : '';
  }
  return rule.scheduledDate;
}

export function sameRepeatOccurrence(item, candidate) {
  return item.id === candidate.id && item.repeat.seriesId === candidate.repeat.seriesId &&
    repeatDeliverySlotKey(item) === repeatDeliverySlotKey(candidate) && item.dueAt === candidate.dueAt;
}
