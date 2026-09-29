import { cycleSuggestions, normalizeCycle } from "../../scripts/utils/cycle.js";
// Match the existing notification timezone, independent of the Worker runtime's UTC clock.
export function cyclePushSuggestions(record, now = new Date()) {
  if (!record) return [];
  const cycle = typeof record.cycle === "string" ? JSON.parse(record.cycle) : record.cycle;
  if (!normalizeCycle(cycle).pushEnabled) return [];
  const reminders = typeof record.reminders === "string" ? JSON.parse(record.reminders) : record.reminders;
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(now);
  return cycleSuggestions(Array.isArray(reminders) ? reminders : [], cycle, new Date(`${day}T12:00:00`));
}
export const CYCLE_ACCOUNT_SELECT = `SELECT user_id,revision,
 json_extract(snapshot_data,'$.reminders') AS reminders,
 json_extract(snapshot_data,'$.preferences.cycle') AS cycle FROM account_sync`;
export function matchingCycle(candidates, anchors) {
  const keys = [...anchors].sort().join("\n");
  return candidates.find(item => [...item.anchorTokens].sort().join("\n") === keys);
}
