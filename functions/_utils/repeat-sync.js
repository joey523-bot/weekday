import { normalizeRepeat, validRepeatDate } from "../../scripts/utils/repeat.js";

export function hasRepeatItems(snapshot) {
  return Array.isArray(snapshot?.reminders) && snapshot.reminders.some(item => item?.repeat != null);
}

function hasTimes(repeat) {
  return Array.isArray(repeat?.times) ? repeat.times.length > 0 : Boolean(repeat?.times);
}

export function validateRepeatReminder(item) {
  const raw = item?.repeat;
  if (!raw || (raw.version != null && ![1, 2, 3].includes(raw.version))) {
    throw new Error("循环设置版本无效，请刷新应用后重新设置。");
  }
  if (hasTimes(raw) && raw.version !== 3) throw new Error("每天多次提醒需要新版循环设置。");
  const repeat = normalizeRepeat(raw);
  if (!repeat) throw new Error("循环设置无效，请重新设置重复规则。");
  if (hasTimes(raw) && (raw.mode === "after" || repeat.mode !== "fixed" || Number(item.leadDays || 0) !== 0)) {
    throw new Error("每天多次提醒仅支持固定周期，且不能提前提醒。");
  }
  return { ...item, repeat };
}

// Old clients normalize away unknown fields, so omission cannot be interpreted as
// a deliberate conversion, completion or deletion of a recurring series.
export function validateRepeatSnapshot(incoming, stored) {
  const rules = [incoming, stored].flatMap(snapshot => Array.isArray(snapshot?.reminders)
    ? snapshot.reminders.flatMap(item => item?.repeat ? [item.repeat] : []) : []);
  const requiredCapability = rules.reduce((required, rule) => Math.max(required,
    rule.version === 3 || hasTimes(rule) ? 3 : rule.version === 2 ? 2 : 1), 1);
  const capability = incoming?.capabilities?.repeat;
  if (rules.some(rule => rule.version != null && ![1, 2, 3].includes(rule.version)) ||
    ((hasRepeatItems(incoming) || hasRepeatItems(stored)) && (!Number.isInteger(capability) || capability < requiredCapability))) {
    const error = new Error("当前应用版本不支持循环事项，请刷新应用后再同步。");
    error.status = 426;
    throw error;
  }
  if (!hasRepeatItems(incoming)) return incoming;
  const activeSeries = new Set();
  return { ...incoming, reminders: incoming.reminders.map(item => {
    if (item?.repeat == null) return item;
    const normalized = validateRepeatReminder(item);
    const { repeat } = normalized;
    if (!repeat.seriesId || (repeat.status === "active" && !validRepeatDate(repeat.scheduledDate))) throw new Error("循环期次标识无效。");
    if (repeat.status !== "history") {
      if (activeSeries.has(repeat.seriesId)) throw new Error("同一循环只能保留一个当前事项。");
      activeSeries.add(repeat.seriesId);
    }
    if ((item.date && !validRepeatDate(item.date)) || (repeat.status === "active" && !validRepeatDate(item.date))) {
      throw new Error("循环事项日期无效。");
    }
    return normalized;
  }) };
}
