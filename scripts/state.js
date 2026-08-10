import { APP_THEMES, DEFAULT_STATE, DEFAULT_THEME, REMINDER_FILTERS, STORAGE_KEY } from "./config.js";

const state = loadState();

export function getState() {
  return state;
}

export function updateSalary(payload) {
  state.salary = {
    ...state.salary,
    ...payload,
    notification: {
      ...state.salary.notification,
      ...(payload.notification || {})
    }
  };
  persistState();
}

export function addReminder(payload) {
  state.reminders = [
    ...state.reminders,
    normalizeReminder({
      ...payload,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    })
  ];
  persistState();
}

export function updateReminder(id, payload) {
  state.reminders = state.reminders.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }

    return normalizeReminder({
      ...entry,
      ...payload,
      id: entry.id,
      createdAt: entry.createdAt,
      completed: entry.completed,
      completedAt: entry.completedAt
    });
  });
  persistState();
}

export function deleteReminder(id) {
  state.reminders = state.reminders.filter((entry) => entry.id !== id);
  persistState();
}

export function setReminderCompletion(id, completed) {
  state.reminders = state.reminders.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }

    return {
      ...entry,
      completed: Boolean(completed),
      completedAt: completed ? new Date().toISOString() : ""
    };
  });
  persistState();
}

export function setReminderFilter(filter) {
  state.preferences.reminderFilter = filter;
  persistState();
}

export function setTheme(theme) {
  state.preferences.theme = normalizeTheme(theme);
  persistState();
}

export function addCustomTheme(customTheme) {
  const previousPreferences = {
    ...state.preferences,
    customThemes: state.preferences.customThemes.map((entry) => ({ ...entry, palette: { ...entry.palette } }))
  };
  if (state.preferences.customThemes.length >= 3) {
    throw new Error("最多保存 3 张照片主题，请删除一张后再新增");
  }

  const nextTheme = {
    ...normalizeCustomTheme(customTheme),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  state.preferences.customThemes = [...state.preferences.customThemes, nextTheme];
  state.preferences.activeCustomThemeId = nextTheme.id;
  state.preferences.theme = "custom";
  try {
    persistState();
  } catch (error) {
    state.preferences = previousPreferences;
    throw new Error("存储空间不足，请选择一张更小的照片");
  }
}

export function selectCustomTheme(id) {
  if (!state.preferences.customThemes.some((entry) => entry.id === id)) {
    return;
  }
  state.preferences.activeCustomThemeId = id;
  state.preferences.theme = "custom";
  persistState();
}

export function deleteCustomTheme(id) {
  const previousPreferences = {
    ...state.preferences,
    customThemes: state.preferences.customThemes.map((entry) => ({ ...entry, palette: { ...entry.palette } }))
  };
  state.preferences.customThemes = state.preferences.customThemes.filter((entry) => entry.id !== id);
  if (state.preferences.activeCustomThemeId === id) {
    const fallback = state.preferences.customThemes.at(-1);
    state.preferences.activeCustomThemeId = fallback?.id || "";
    state.preferences.theme = fallback ? "custom" : DEFAULT_THEME;
  }
  try {
    persistState();
  } catch (error) {
    state.preferences = previousPreferences;
    throw new Error("保存失败，请稍后重试");
  }
}

export function setWeatherPending(city) {
  state.preferences.city = city;
  state.weather = {
    ...state.weather,
    status: "loading",
    error: ""
  };
  persistState();
}

export function setWeatherSuccess(city, payload) {
  state.preferences.city = city;
  state.weather = {
    status: "ready",
    payload,
    updatedAt: new Date().toISOString(),
    error: ""
  };
  persistState();
}

export function setWeatherFailure(city, message) {
  state.preferences.city = city;
  state.weather = {
    ...state.weather,
    status: "error",
    error: message
  };
  persistState();
}

export function replaceSyncedData(payload) {
  const normalized = normalizeState({
    ...state,
    salary: {
      ...state.salary,
      ...(payload?.salary || {}),
      notification: {
        ...state.salary.notification,
        leadDays: payload?.salary?.notification?.leadDays ?? state.salary.notification.leadDays
      }
    },
    reminders: Array.isArray(payload?.reminders) ? payload.reminders : state.reminders,
    preferences: {
      ...state.preferences,
      ...(payload?.preferences || {}),
      customThemes: state.preferences.customThemes,
      activeCustomThemeId: state.preferences.activeCustomThemeId
    }
  });

  state.salary = normalized.salary;
  state.reminders = normalized.reminders;
  state.preferences = normalized.preferences;
  persistState();
}

export function clearAccountData() {
  const next = cloneDefaultState();
  state.salary = next.salary;
  state.reminders = next.reminders;
  state.preferences = next.preferences;
  state.weather = next.weather;
  persistState();
}

export function getSyncSnapshot() {
  return {
    version: 1,
    salary: {
      day: state.salary.day,
      amount: state.salary.amount,
      account: state.salary.account,
      notification: {
        leadDays: state.salary.notification.leadDays
      }
    },
    reminders: state.reminders,
    preferences: {
      reminderFilter: state.preferences.reminderFilter,
      theme: state.preferences.theme === "custom" ? DEFAULT_THEME : state.preferences.theme
    },
    updatedAt: new Date().toISOString()
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneDefaultState();
    }

    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    console.warn("Failed to load local state", error);
    return cloneDefaultState();
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("yoyuan:state-changed"));
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function normalizeState(raw) {
  const base = cloneDefaultState();
  return {
    salary: {
      ...base.salary,
      ...(raw?.salary || {}),
      day: clampPayday(raw?.salary?.day),
      notification: {
        ...base.salary.notification,
        ...(raw?.salary?.notification || {}),
        leadDays: clampLeadDays(raw?.salary?.notification?.leadDays),
        hour: clampReminderHour(raw?.salary?.notification?.hour),
        timezone: String(raw?.salary?.notification?.timezone || base.salary.notification.timezone),
        permission: String(raw?.salary?.notification?.permission || base.salary.notification.permission),
        endpoint: String(raw?.salary?.notification?.endpoint || ""),
        lastSyncedAt: String(raw?.salary?.notification?.lastSyncedAt || ""),
        lastTestedAt: String(raw?.salary?.notification?.lastTestedAt || ""),
        lastError: String(raw?.salary?.notification?.lastError || "")
      }
    },
    reminders: Array.isArray(raw?.reminders) ? raw.reminders.map(normalizeReminder) : [],
    preferences: normalizePreferences(raw?.preferences, base.preferences),
    weather: {
      ...base.weather,
      ...(raw?.weather || {})
    }
  };
}

function normalizeTheme(theme) {
  const value = String(theme || DEFAULT_THEME);
  return Object.hasOwn(APP_THEMES, value) ? value : DEFAULT_THEME;
}

function normalizeReminder(entry) {
  return {
    id: String(entry?.id || crypto.randomUUID()),
    title: String(entry?.title || "").trim(),
    date: String(entry?.date || ""),
    category: String(entry?.category || "其他"),
    leadDays: clampReminderLeadDays(entry?.leadDays),
    hour: clampReminderHour(entry?.hour),
    notificationEnabled: Boolean(entry?.notificationEnabled),
    notes: String(entry?.notes || "").trim(),
    createdAt: entry?.createdAt || new Date().toISOString(),
    completed: Boolean(entry?.completed),
    completedAt: entry?.completed ? String(entry?.completedAt || entry?.createdAt || "") : ""
  };
}

function normalizeCustomTheme(theme) {
  return {
    imageDataUrl: String(theme?.imageDataUrl || ""),
    tone: theme?.tone === "light" ? "light" : "dark",
    palette: Object.fromEntries(
      Object.entries(theme?.palette || {}).filter(([key, value]) => key.startsWith("--") && typeof value === "string")
    ),
    recommendation: String(theme?.recommendation || "").slice(0, 40)
  };
}

function normalizePreferences(raw, base) {
  const themes = normalizeCustomThemes(raw);
  const activeCustomThemeId = themes.some((entry) => entry.id === raw?.activeCustomThemeId)
    ? String(raw.activeCustomThemeId)
    : themes.at(-1)?.id || "";
  const requestedTheme = normalizeTheme(raw?.theme);
  return {
    ...base,
    ...(raw || {}),
    theme: requestedTheme === "custom" && !activeCustomThemeId ? DEFAULT_THEME : requestedTheme,
    reminderFilter: normalizeReminderFilter(raw?.reminderFilter),
    customThemes: themes,
    activeCustomThemeId
  };
}

function normalizeCustomThemes(preferences) {
  const rawThemes = Array.isArray(preferences?.customThemes)
    ? preferences.customThemes
    : preferences?.customTheme?.imageDataUrl
      ? [{ ...preferences.customTheme, id: "legacy-custom-theme", createdAt: "" }]
      : [];
  return rawThemes
    .map((entry, index) => ({
      ...normalizeCustomTheme(entry),
      id: String(entry?.id || `custom-theme-${index}`).slice(0, 80),
      createdAt: String(entry?.createdAt || "")
    }))
    .filter((entry) => entry.imageDataUrl)
    .slice(-3);
}

function normalizeReminderFilter(filter) {
  const value = String(filter || REMINDER_FILTERS.all);
  return Object.values(REMINDER_FILTERS).includes(value) ? value : REMINDER_FILTERS.all;
}

function clampPayday(day) {
  const value = Number(day);
  if (!Number.isFinite(value)) {
    return DEFAULT_STATE.salary.day;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 28);
}

function clampLeadDays(day) {
  const value = Number(day);
  if (!Number.isFinite(value)) {
    return DEFAULT_STATE.salary.notification.leadDays;
  }

  return Math.min(Math.max(Math.trunc(value), 0), 7);
}

function clampReminderLeadDays(day) {
  const value = Number(day);
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(value), 0), 30);
}

function clampReminderHour(hour) {
  const value = Number(hour);
  if (!Number.isFinite(value)) {
    return DEFAULT_STATE.salary.notification.hour;
  }

  return Math.min(Math.max(Math.trunc(value), 0), 23);
}
