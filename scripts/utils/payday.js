import { isChinaWorkday } from "./workday-calendar.js";

export const DEFAULT_SALARY_DAY = 5;
const DAY_MS = 86400000;
export function normalizeSalaryDay(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 28 ? day : DEFAULT_SALARY_DAY;
}
export function dateParts(date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
export function daysBetweenParts(start, end) {
  return Math.round((Date.UTC(end.year, end.month - 1, end.day) -
    Date.UTC(start.year, start.month - 1, start.day)) / DAY_MS);
}
export function getSalaryExecutionParts(year, month, salaryDay = DEFAULT_SALARY_DAY) {
  const candidate = new Date(Date.UTC(year, month - 1, normalizeSalaryDay(salaryDay)));
  const nominal = dateParts(candidate);
  while (!isChinaWorkday(dateParts(candidate))) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  return { ...dateParts(candidate), nominalYear: nominal.year, nominalMonth: nominal.month };
}
export function getNextSalaryParts(local, salaryDay = DEFAULT_SALARY_DAY) {
  // A nominal month can already have been paid in the preceding month.
  // Keep advancing nominal months until the execution date is today or later.
  for (let offset = 0; ; offset += 1) {
    const candidate = getSalaryExecutionParts(local.year, local.month + offset, salaryDay);
    if (daysBetweenParts(local, candidate) >= 0) return candidate;
  }
}
