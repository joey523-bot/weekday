import { getNextSalaryParts, getSalaryExecutionParts } from "./payday.js";
import { CalendarUnavailableError } from "./workday-calendar.js";

const DAY_MS = 86400000;

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatLocalDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLong(value) {
  const date = typeof value === "string" ? parseDateInput(value) : value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

export function formatDateWithWeekday(value) {
  const date = typeof value === "string" ? parseDateInput(value) : value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

export function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function getNextSalaryDate(dayOfMonth, reference = new Date()) {
  try {
    const parts = getNextSalaryParts({ year: reference.getFullYear(), month: reference.getMonth() + 1,
      day: reference.getDate() }, dayOfMonth);
    return new Date(parts.year, parts.month - 1, parts.day);
  } catch (error) {
    if (error instanceof CalendarUnavailableError) return null;
    throw error;
  }
}

export function getDaysUntil(value, reference = new Date()) {
  const target = typeof value === "string" ? parseDateInput(value) : value;
  const current = startOfDay(reference);
  return Math.ceil((startOfDay(target) - current) / DAY_MS);
}

export function formatCountdown(days) {
  if (days < 0) {
    return `逾期 ${Math.abs(days)} 天`;
  }

  if (days === 0) {
    return "今天";
  }

  return `${days} 天后`;
}

export function getSalaryCycleProgress(dayOfMonth, reference = new Date()) {
  try {
    const local = { year: reference.getFullYear(), month: reference.getMonth() + 1, day: reference.getDate() };
    const next = getNextSalaryParts(local, dayOfMonth);
    const nextDate = new Date(next.year, next.month - 1, next.day);
    const daysUntil = getDaysUntil(nextDate, reference);
    if (daysUntil === 0) return 1;
    const last = getSalaryExecutionParts(next.nominalYear, next.nominalMonth - 1, dayOfMonth);
    const lastDate = new Date(last.year, last.month - 1, last.day);
    const totalDays = Math.max(1, getDaysUntil(nextDate, lastDate));
    return Math.min(1, Math.max(0, (totalDays - daysUntil) / totalDays));
  } catch (error) {
    if (error instanceof CalendarUnavailableError) return null;
    throw error;
  }
}

export function getReminderTone(days) {
  if (days < 0) {
    return "overdue";
  }

  if (days === 0) {
    return "today";
  }

  if (days <= 7) {
    return "soon";
  }

  return "planned";
}

export function buildSalaryAgenda(dayOfMonth, count = 4, now = new Date()) {
  const items = [];

  for (let index = 0; index < count; index += 1) {
    let candidate;
    try {
      candidate = getSalaryExecutionDate(now.getFullYear(), now.getMonth() + index, dayOfMonth);
    } catch (error) {
      if (error instanceof CalendarUnavailableError) break;
      throw error;
    }
    items.push({
      id: `salary-${formatLocalDateInput(candidate)}`,
      type: "salary",
      title: "发薪日",
      date: formatLocalDateInput(candidate),
      notes: "月度薪资节点"
    });
  }

  return items;
}

export function buildAgendaItems(reminders, salaryDay, count = 8) {
  const reminderItems = reminders.map((entry) => ({
    id: entry.id,
    type: "reminder",
    title: entry.title,
    date: entry.date,
    notes: entry.notes,
    category: entry.category
  }));

  return [...reminderItems, ...buildSalaryAgenda(salaryDay, 4)]
    .filter((entry) => {
      const days = getDaysUntil(entry.date);
      return days >= 0 && days <= 30;
    })
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, count);
}

function getSalaryExecutionDate(year, month, dayOfMonth) {
  const parts = getSalaryExecutionParts(year, month + 1, dayOfMonth);
  return new Date(parts.year, parts.month - 1, parts.day);
}
