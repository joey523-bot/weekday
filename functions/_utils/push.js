import { DEFAULT_SALARY_DAY } from "../../scripts/utils/payday.js";

export function normalizePushPayload(payload) {
  const installationId = String(payload?.installationId || "").trim();
  const endpoint = String(payload?.subscription?.endpoint || payload?.endpoint || "").trim();
  const p256dh = String(payload?.subscription?.keys?.p256dh || "").trim();
  const auth = String(payload?.subscription?.keys?.auth || "").trim();
  const salaryDay = clampInteger(payload?.salaryDay, 1, 28, DEFAULT_SALARY_DAY);
  const leadDays = clampInteger(payload?.leadDays, 0, 7, 0);
  const reminderHour = clampInteger(payload?.reminderHour, 0, 23, 9);
  const permission = String(payload?.permission || "default").trim() || "default";
  const appName = String(payload?.appName || "星期").trim() || "星期";

  return {
    installationId,
    dailyCountdownEnabled: typeof payload?.dailyCountdownEnabled === "boolean" ? payload.dailyCountdownEnabled : undefined,
    endpoint,
    p256dh,
    auth,
    salaryDay,
    leadDays,
    reminderHour,
    permission,
    appName
  };
}

export function normalizeReminderPushRules(payload) {
  const installationId = String(payload?.installationId || "").trim();
  const reminders = Array.isArray(payload?.reminders) ? payload.reminders : [];

  return {
    installationId,
    reminders: reminders
      .map((entry) => ({
        reminderId: String(entry?.id || "").trim(),
        title: String(entry?.title || "").trim().slice(0, 120),
        category: String(entry?.category || "其他").trim().slice(0, 40),
        reminderDate: normalizeDate(entry?.date),
        leadDays: clampInteger(entry?.leadDays, 0, 30, 0),
        reminderHour: clampInteger(entry?.hour, 0, 23, 9),
        enabled: Boolean(entry?.notificationEnabled) && !Boolean(entry?.completed) && !entry?.repeat
      }))
      .filter((entry) => entry.reminderId && entry.title && entry.reminderDate && entry.enabled)
  };
}

export function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function normalizeDate(value) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}
