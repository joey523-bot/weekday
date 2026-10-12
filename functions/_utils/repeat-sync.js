import { normalizeRepeat, validRepeatDate } from "../../scripts/utils/repeat.js";

export function hasRepeatItems(snapshot) {
  return Array.isArray(snapshot?.reminders) && snapshot.reminders.some(item => item?.repeat != null);
}

// Old clients normalize away unknown fields, so omission cannot be interpreted as
// a deliberate conversion, completion or deletion of a recurring series.
export function validateRepeatSnapshot(incoming, stored) {
  const requiresV2 = [incoming,stored].some(snapshot => snapshot?.reminders?.some(item => item?.repeat?.version === 2));
  const capability = incoming?.capabilities?.repeat;
  if ((hasRepeatItems(incoming) || hasRepeatItems(stored)) && (!Number.isInteger(capability) || capability < (requiresV2 ? 2 : 1))) {
    const error = new Error("当前应用版本不支持循环事项，请刷新应用后再同步。");
    error.status = 426;
    throw error;
  }
  if (!hasRepeatItems(incoming)) return incoming;
  const activeSeries = new Set();
  return { ...incoming, reminders: incoming.reminders.map(item => {
    if (item?.repeat == null) return item;
    const repeat = normalizeRepeat(item.repeat);
    if (!repeat) throw new Error("循环设置无效，请重新设置重复规则。");
    if (!repeat.seriesId || (repeat.status === "active" && !validRepeatDate(repeat.scheduledDate))) throw new Error("循环期次标识无效。");
    if (repeat.status !== "history") {
      if (activeSeries.has(repeat.seriesId)) throw new Error("同一循环只能保留一个当前事项。");
      activeSeries.add(repeat.seriesId);
    }
    const normalized = { ...item, repeat };
    if ((item.date && !validRepeatDate(item.date)) || (repeat.status === "active" && !validRepeatDate(item.date))) {
      throw new Error("循环事项日期无效。");
    }
    return normalized;
  }) };
}
