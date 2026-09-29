import { formatLocalDateInput } from "./date.js";

export function isOccurrenceDate(value, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value <= formatLocalDateInput(now);
}

// Pure sample preparation only: callers must supply user-confirmed aliases.
// No predictions, thresholds, or cross-account history are stored here.
export function occurrenceSamples(reminders, aliases = {}) {
  const groups = new Map();
  for (const item of reminders) {
    if (!item.completed || !isOccurrenceDate(item.occurredOn)) continue;
    const key = Object.hasOwn(aliases, item.title) ? aliases[item.title] : item.title;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(item.occurredOn);
  }
  return [...groups].map(([title, days]) => {
    const dates = [...days].sort();
    const gaps = dates.slice(1).map((day, i) => (Date.parse(day) - Date.parse(dates[i])) / 86400000);
    return { title, dates, gaps };
  });
}
