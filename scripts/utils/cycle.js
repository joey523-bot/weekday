import { isOccurrenceDate } from "./occurrence.js";
import { formatLocalDateInput } from "./date.js";
const strings = value => [...new Set((Array.isArray(value) ? value : []).filter(x => typeof x === "string"))];
export function normalizeCycle(value = {}) {
  const used = new Set();
  const groups = (Array.isArray(value?.groups) ? value.groups : []).map(group => {
    const titles = strings(group?.titles).filter(title => !used.has(title));
    titles.forEach(title => used.add(title));
    return { id: String(group?.id || titles[0] || ""), titles, disabled: Boolean(group?.disabled) };
  }).filter(group => group.titles.length);
  return { enabled: value?.enabled !== false, pushEnabled: value?.pushEnabled === true, groups, excludedIds: strings(value?.excludedIds),
    clearedIds: strings(value?.clearedIds), handledTokens: strings(value?.handledTokens) };
}
export function cycleGroups(reminders, raw) {
  const prefs = normalizeCycle(raw);
  const groups = prefs.groups.map(group => ({ ...group, titles: [...group.titles] }));
  const known = new Set(groups.flatMap(group => group.titles));
  for (const { title } of reminders) if (title && !known.has(title)) {
    groups.push({ id: `title:${title}`, titles: [title], disabled: false }); known.add(title);
  }
  return groups;
}
export const eventToken = item => JSON.stringify([item.id, item.completedAt || item.createdAt || ""]);
const addDays = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0,10);
export function cycleSuggestions(reminders, raw, now = new Date()) {
  const prefs = normalizeCycle(raw);
  if (!prefs.enabled) return [];
  const today = formatLocalDateInput(now);
  const excluded = new Set([...prefs.excludedIds, ...prefs.clearedIds]);
  const handled = new Set(prefs.handledTokens);
  return cycleGroups(reminders, prefs).flatMap(group => {
    if (group.disabled) return [];
    const items = reminders.filter(item => group.titles.includes(item.title));
    if (items.some(item => !item.completed)) return [];
    const samples = items.filter(item => !excluded.has(item.id) && item.completed && isOccurrenceDate(item.occurredOn, now));
    const dates = [...new Set(samples.map(item => item.occurredOn))].sort().slice(-6);
    if (dates.length < 4) return [];
    const gaps = dates.slice(1).map((day,i) => (Date.parse(day)-Date.parse(dates[i]))/86400000);
    const sorted = [...gaps].sort((a,b) => a-b), mid = Math.floor(sorted.length/2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
    if (gaps.some(gap => Math.abs(gap-median) > median*.25)) return [];
    const last = dates.at(-1), expected = addDays(last, Math.round(median));
    const start = [addDays(expected,-2), addDays(last,1)].sort().at(-1);
    if (today < start || today > addDays(expected,2)) return [];
    const anchors = samples.filter(item => item.occurredOn === last);
    if (anchors.every(item => handled.has(eventToken(item)))) return [];
    return [{ ...group, title: anchors[0].title, dates, gaps, median, expected,
      tokens: samples.map(eventToken), anchorTokens: anchors.map(eventToken) }];
  });
}
export function mergeCycleGroups(reminders, raw, first, second) {
  if (!first || !second || first === second) throw new Error("请选择两个不同的事项名称");
  const groups = cycleGroups(reminders, raw);
  const a = groups.find(group => group.titles.includes(first)), b = groups.find(group => group.titles.includes(second));
  if (!a || !b || a === b) throw new Error("这两个名称已经是同类，或已不存在");
  return { ...normalizeCycle(raw), groups: [...groups.filter(group => group !== a && group !== b),
    { id: a.id, titles: [...new Set([...a.titles,...b.titles])], disabled: a.disabled || b.disabled }] };
}
