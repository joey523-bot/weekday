import { normalizeCycle } from "./utils/cycle.js";
import { normalizeRepeat, firstRepeatDate, nextRepeatDate, beijingDate, validRepeatDate } from "./utils/repeat.js";
import { isOccurrenceDate } from "./utils/occurrence.js";
import { normalizeCustomCategories, validateNewCategory } from "./utils/reminder-categories.js";
import { APP_THEMES, DEFAULT_STATE, DEFAULT_THEME, REMINDER_FILTERS, STORAGE_KEY } from "./config.js";

const state = loadState();

export function updateCyclePreferences(value) {
  const previous = state.preferences.cycle;
  state.preferences.cycle = normalizeCycle(value);
  try { persistState(); } catch(error) { state.preferences.cycle = previous; throw error; }
}

export function getState() {
  return state;
}

export function addReminderCategory(value) {
  const name = validateNewCategory(value, state.preferences.customCategories);
  const previous = state.preferences.customCategories;
  state.preferences.customCategories = [...previous, name];
  try { persistState(); } catch (error) { state.preferences.customCategories = previous; throw error; }
  return name;
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

export function addReminder(payload, cycleTokens = []) {
  const previousReminders = state.reminders;
  const previousCycle = state.preferences.cycle;
  const reminder = prepareNewReminder({
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    completed: false,
    completedAt: "",
    occurredOn: ""
  });
  state.reminders = [...state.reminders, reminder];
  if (cycleTokens.length) state.preferences.cycle = normalizeCycle({ ...previousCycle,
    handledTokens: [...previousCycle.handledTokens, ...cycleTokens] });
  try { persistState(); } catch(error) { state.reminders = previousReminders; state.preferences.cycle = previousCycle; throw error; }
  return reminder;
}

export function updateReminder(id, payload, scope = "once") {
  if (!["once", "series"].includes(scope)) throw new Error("请选择仅本次或整个系列");
  const current = state.reminders.find(entry => entry.id === id);
  if (!current) return;
  if (current.repeat?.status === "history") throw new Error("循环历史不能修改，请编辑当前事项");
  const hasRepeat = Object.hasOwn(payload, "repeat");
  const requestedRule = hasRepeat ? normalizeRepeat(payload.repeat) : current.repeat;
  const apply = entry => {
    const merged = { ...entry, ...payload, id: entry.id, createdAt: entry.createdAt,
      completed: entry.completed, completedAt: entry.completedAt, occurredOn: entry.occurredOn };
    if (!entry.repeat) return requestedRule ? prepareNewReminder({ ...merged, repeat: requestedRule }) : normalizeReminder(merged);
    if (scope === "once") {
      // A local date/time exception must never alter the series anchor or future template.
      const time = requestedRule?.time || entry.repeat.time;
      return normalizeReminder({ ...merged, repeat: { ...entry.repeat, time } });
    }
    if (!requestedRule) return normalizeReminder({ ...merged, repeat: null, repeatOutcome: "" });
    const rule = normalizeRepeat({ ...entry.repeat, ...requestedRule,
      seriesId: entry.repeat.seriesId, status: entry.repeat.status });
    const template = reminderTemplate({ ...merged, repeat: rule });
    rule.template = template;
    // Content-only changes preserve an explicit exception on the current item.
    const scheduleChanged = ["freq", "mode", "interval", "unit", "workday", "startDate", "endDate"]
      .some(key => rule[key] !== entry.repeat[key])
      || JSON.stringify(rule.weekdays) !== JSON.stringify(entry.repeat.weekdays);
    if (scheduleChanged) {
      let first = firstRepeatDate(rule);
      const earliest = entry.repeat.scheduledDate || entry.date;
      if (rule.mode === "after") {
        const date = [merged.date || entry.date, rule.startDate].sort().at(-1);
        first = rule.endDate && date > rule.endDate ? { date: "", status: "ended" } : { date, status: "active" };
      } else if (first.date && first.date < earliest) {
        const before = previousRepeatDay(earliest);
        first = nextRepeatDate({ ...rule, status: "active" }, { afterDate: before, today: before });
      }
      merged.date = first.date || entry.date;
      rule.scheduledDate = first.date || entry.repeat.scheduledDate;
      rule.waitingAfterDate = first.status === "calendar_wait" ? entry.repeat.waitingAfterDate || "" : "";
      rule.status = first.status === "active" && entry.repeat.status === "paused" ? "paused" : first.status;
    }
    return normalizeReminder({ ...merged, repeat: rule });
  };
  const reminders = state.reminders.map(entry => entry.id === id
    || (scope === "series" && current.repeat && entry.repeat?.seriesId === current.repeat.seriesId
      && entry.repeat.status !== "history" && !entry.completed) ? apply(entry) : entry);
  commitReminders(reminders);
  return state.reminders.find(entry => entry.id === id);
}

export function deleteReminder(id) {
  commitReminders(state.reminders.filter(entry => entry.id !== id));
}

export function setReminderCompletion(id, completed, occurredOn = "") {
  const current = state.reminders.find(entry => entry.id === id);
  if (current?.repeat) {
    if (!completed) throw new Error("循环历史不能恢复，请管理当前事项");
    return manageRepeat(id, "complete", { occurredOn });
  }
  if (completed && !isOccurrenceDate(occurredOn)) throw new Error("请确认今天或之前的实际发生日期");
  commitReminders(state.reminders.map(entry => entry.id !== id ? entry : {
    ...entry,
    completed: Boolean(completed),
    completedAt: completed ? (entry.completed ? entry.completedAt : new Date().toISOString()) : "",
    occurredOn: completed ? occurredOn : ""
  }));
}

export function manageRepeat(id, action, { occurredOn = "", now = new Date() } = {}) {
  const entry = state.reminders.find(item => item.id === id);
  if (!entry?.repeat) throw new Error("该事项没有循环设置");
  if (entry.repeat.status === "history" || entry.completed) throw new Error("循环历史不能修改，请管理当前事项");
  if (!["complete", "skip", "pause", "resume", "end"].includes(action)) throw new Error("循环操作无效");
  const today = beijingDate(now);
  const rule = normalizeRepeat(entry.repeat);
  if (rule.status === "ended") throw new Error("该循环已结束");
  if (["complete", "skip"].includes(action)) {
    if (rule.status !== "active") throw new Error("请先恢复循环后再完成或跳过");
    if (action === "complete" && (!validRepeatDate(occurredOn) || occurredOn > today)) {
      throw new Error("请确认今天或之前的实际发生日期");
    }
    const outcome = nextRepeatDate(rule, { afterDate: rule.scheduledDate || entry.date,
      completedOn: occurredOn, action, today });
    const history = { ...entry, completed: true, completedAt: now.toISOString(),
      occurredOn: action === "complete" ? occurredOn : "", repeatOutcome: action === "complete" ? "completed" : "skipped",
      repeat: { ...rule, status: "history" } };
    let next;
    if (outcome.status !== "ended") {
      const template = reminderTemplate({ ...entry, ...rule.template, repeat: { ...rule, time: rule.template.time || rule.time } });
      next = normalizeReminder({ ...template, id: crypto.randomUUID(), createdAt: now.toISOString(),
        date: outcome.date || rule.scheduledDate || entry.date,
        repeat: { ...rule, status: outcome.status, time: template.time,
          scheduledDate: outcome.date || rule.scheduledDate || entry.date,
          waitingAfterDate: outcome.status === "calendar_wait" ? rule.scheduledDate || entry.date : "", template },
        completed: false, completedAt: "", occurredOn: "", repeatOutcome: "" });
    }
    const reminders = state.reminders.map(item => item.id === id ? history : item);
    if (next) reminders.push(next);
    commitReminders(reminders);
    return next || history;
  }
  let updated;
  if (action === "resume") {
    if (!["paused", "calendar_wait"].includes(rule.status)) throw new Error("该循环无需恢复");
    let outcome;
    if (rule.status === "calendar_wait" && !rule.waitingAfterDate) {
      outcome = firstRepeatDate(rule);
      if (outcome.date) outcome = nextRepeatDate(rule, { action, afterDate: outcome.date, today, now });
    } else {
      outcome = nextRepeatDate(rule, { action: rule.status === "calendar_wait" && rule.waitingAfterDate ? "complete" : action,
        afterDate: rule.mode === "after" ? entry.date : rule.waitingAfterDate || rule.scheduledDate || entry.date, today, now });
    }
    updated = { ...entry, date: outcome.date || entry.date,
      repeat: { ...rule, status: outcome.status, scheduledDate: outcome.date || rule.scheduledDate,
        waitingAfterDate: outcome.status === "calendar_wait" ? rule.waitingAfterDate : "" } };
  } else {
    if (action === "pause" && rule.status !== "active") throw new Error("该循环无需暂停");
    updated = { ...entry, repeat: { ...rule, status: action === "pause" ? "paused" : "ended" } };
  }
  commitReminders(state.reminders.map(item => item.id === id ? updated : item));
  return updated;
}

function commitReminders(reminders) {
  const previous = state.reminders;
  state.reminders = reminders;
  try { persistState(); } catch (error) { state.reminders = previous; throw error; }
}

function previousRepeatDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

function reminderTemplate(entry) {
  const item = normalizeReminder(entry);
  return { title: item.title, category: item.category, notes: item.notes, leadDays: item.leadDays,
    notificationEnabled: item.notificationEnabled, time: item.repeat?.time || `${String(item.hour).padStart(2, "0")}:00` };
}

function prepareNewReminder(payload) {
  const rule = normalizeRepeat(payload.repeat);
  if (!rule) return normalizeReminder(payload);
  if (payload.completed) throw new Error("已完成事项不能改成循环，请新建循环事项");
  const first = firstRepeatDate(rule);
  rule.seriesId = crypto.randomUUID();
  rule.status = first.status;
  rule.scheduledDate = first.date || rule.startDate;
  rule.waitingAfterDate = "";
  rule.template = reminderTemplate({ ...payload, repeat: rule });
  return normalizeReminder({ ...payload, date: first.date || rule.startDate, repeat: rule, repeatOutcome: "" });
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
      customCategories: payload?.preferences?.customCategories || [],
      cycle: payload?.preferences?.cycle || {},
      customThemes: state.preferences.customThemes,
      activeCustomThemeId: state.preferences.activeCustomThemeId
    }
  });

  const previous = { salary: state.salary, reminders: state.reminders, preferences: state.preferences };
  state.salary = normalized.salary;
  state.reminders = normalized.reminders;
  state.preferences = normalized.preferences;
  try { persistState(); } catch (error) { Object.assign(state, previous); throw error; }
}

export function clearAccountData() {
  const next = cloneDefaultState();
  state.salary = next.salary;
  state.reminders = next.reminders;
  state.preferences = next.preferences;
  state.weather = next.weather;
  persistState();
}

export function setNickname(nickname) {
  state.preferences.nickname = String(nickname || "").trim().slice(0, 20);
  persistState();
}

export function getSyncSnapshot() {
  return {
    version: 1,
    capabilities: { repeat: 1 },
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
      nickname: state.preferences.nickname,
      customCategories: state.preferences.customCategories,
      cycle: state.preferences.cycle,
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
        dailyCountdownEnabled: raw?.salary?.notification?.dailyCountdownEnabled === true,
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
  const repeat = normalizeRepeat(entry?.repeat);
  const occurredOnValid = repeat ? validRepeatDate(entry?.occurredOn) && entry.occurredOn <= beijingDate() : isOccurrenceDate(entry?.occurredOn);
  return {
    id: String(entry?.id || crypto.randomUUID()),
    title: String(entry?.title || "").trim(),
    date: String(entry?.date || ""),
    category: String(entry?.category || "其他"),
    leadDays: clampReminderLeadDays(entry?.leadDays),
    hour: repeat ? Number(repeat.time.slice(0, 2)) : clampReminderHour(entry?.hour),
    notificationEnabled: Boolean(entry?.notificationEnabled),
    notes: String(entry?.notes || "").trim(),
    createdAt: entry?.createdAt || new Date().toISOString(),
    completed: Boolean(entry?.completed),
    completedAt: entry?.completed ? String(entry?.completedAt || entry?.createdAt || "") : "",
    occurredOn: entry?.completed && occurredOnValid && entry?.repeatOutcome !== "skipped" ? entry.occurredOn : "",
    ...(repeat ? { repeat, repeatOutcome: ["completed", "skipped"].includes(entry?.repeatOutcome) ? entry.repeatOutcome : "" } : {})
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
    nickname: String(raw?.nickname || "").trim().slice(0, 20),
    customCategories: normalizeCustomCategories(raw?.customCategories),
    cycle: normalizeCycle(raw?.cycle),
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
