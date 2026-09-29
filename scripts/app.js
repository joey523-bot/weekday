import { setupLifestyle, renderLifestyle } from "./views/lifestyle.js";
import { bindCycleUI } from "./views/cycle.js";
import { cycleSuggestions } from "./utils/cycle.js";
import { requestOccurrenceDate } from "./views/occurrence.js";
import { bindSnoozePanel } from "./services/snooze.js";
import { categoryOptions, DEFAULT_CATEGORIES } from "./utils/reminder-categories.js";
import { APP_META, APP_THEMES, DEFAULT_THEME, REMINDER_FILTERS } from "./config.js";
import {
  addReminder,
  updateCyclePreferences,
  addReminderCategory,
  addCustomTheme,
  deleteReminder,
  deleteCustomTheme,
  clearAccountData,
  getSyncSnapshot,
  getState,
  replaceSyncedData,
  setNickname,
  setReminderFilter,
  setReminderCompletion,
  selectCustomTheme,
  setTheme,
  setWeatherFailure,
  setWeatherPending,
  setWeatherSuccess,
  updateReminder,
  updateSalary
} from "./state.js";
import { exportSingleReminder } from "./services/calendar.js";
import {
  disableSalaryPushNotifications,
  enableSalaryPushNotifications,
  getCurrentPushSubscription,
  isStandaloneExperience,
  sendLocalTestNotification,
  supportsPushNotifications,
  syncReminderPushRules,
  syncSalaryPushRule
} from "./services/push.js";
import {
  changeAccountPassword,
  getAccountSession,
  identifyAccount,
  loadAccountSnapshot,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveAccountSnapshot
} from "./services/account.js";
import { prepareThemeImage } from "./services/theme.js";
import { fetchWeatherReportByCoordinates } from "./services/weather.js";
import { formatDateLong, formatLocalDateInput } from "./utils/date.js";
import {
  createRefs,
  populateSalaryOptions,
  renderDashboard,
  renderAppearancePanel,
  renderOverviewWeather,
  renderPushPanel,
  renderReminderBoard,
  renderOverviewReminderPreview,
  renderSalaryPanel
} from "./views/render.js";
import { createAuthShell, createShell } from "./views/shell.js";

import { createReminderTimeDefault } from "./utils/reminder-default.js";

import { bindReminderSuggestions } from "./utils/reminder-suggestions.js";

let dueRefreshTimer;
let showSnoozePanel;
let categoriesReady = false;
let suggestionUI;
let suggestionHistory = [];
const reminderTimeDefault = createReminderTimeDefault();
let activeView = "overview";
let editingReminderId = null;
let cycleUI = null;
let cycleDraft = null;
let accountSyncTimer = null;
let accountSyncPaused = false;
let accountRevision = 0;
let activeAccount = null;
let accountDirty = false;
let accountSavePromise = null;
let accountChangeVersion = 0;
let routeVersion = 0;
let detailReminderId = null;
let routeLoading = false;
const CUSTOM_THEME_VARIABLES = [
  "--bg", "--surface", "--surface-strong", "--surface-muted", "--text", "--text-muted", "--text-soft",
  "--text-inverse", "--accent", "--accent-strong", "--accent-soft", "--accent-warm", "--accent-warm-soft",
  "--line", "--line-strong"
];

boot();

async function boot() {
  document.title = APP_META.productName;
  const root = document.querySelector("#app");
  const session = await getAccountSession().catch(() => null);
  if (!session?.user) {
    applyTheme(DEFAULT_THEME);
    root.innerHTML = createAuthShell();
    bindAuthEvents(root);
    return;
  }

  activeAccount = session.user;
  startApplication(root);
}

async function startApplication(root) {
  categoriesReady = false;
  suggestionHistory = [];
  suggestionUI = null;
  applyTheme(getState().preferences.theme);
  root.innerHTML = createShell();
  setupLifestyle(root);

  const refs = createRefs(document);
  const state = getState();

  populateSalaryOptions(refs.salaryDaySelect, state.salary.day);
  bindEvents(refs);
  cycleUI = bindCycleUI({ getState, save: updateCyclePreferences, sync: flushAccountSync,
    ready: () => categoriesReady, enablePush: () => enablePushAndSync(refs), compose: suggestion => {
      resetReminderForm(refs);
      cycleDraft = suggestion;
      refs.reminderTitleInput.value = suggestion.title;
      const today = formatLocalDateInput(new Date());
      refs.reminderDateInput.value = suggestion.expected < today ? today : suggestion.expected;
      reminderTimeDefault.apply(refs, false);
      refs.reminderNotificationInput.checked = false;
      refs.reminderFormDescription.textContent = `周期建议预计${formatDateLong(suggestion.expected)}，请确认日期、时间和是否开启通知。`;
      syncReminderDateDisplay(refs); setActiveView(refs, "compose");
    } });
  if (!new URLSearchParams(window.location.hash.slice(1)).has("reminder")) await hydrateAccountData(refs);
  renderAll(refs);
  bindReminderNavigation(refs);
  clearInterval(dueRefreshTimer);
  dueRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && activeAccount) {
      renderReminderBoard(getState(), refs);
      renderOverviewReminderPreview(getState(), refs);
      cycleUI?.renderSuggestions();
      renderLifestyle(getState());
    }
  }, 60000);
  await openNotificationReminder(refs);
  registerServiceWorker();
  hydratePushSubscription(refs);
  hydrateDefaultWeather(refs, getState());
  const sharedFingerprint = () => {
    const { updatedAt, ...snapshot } = getSyncSnapshot();
    return JSON.stringify(snapshot);
  };
  let observedSnapshot = sharedFingerprint();
  window.addEventListener("yoyuan:state-changed", () => {
    const nextSnapshot = sharedFingerprint();
    const sharedChanged = nextSnapshot !== observedSnapshot;
    observedSnapshot = nextSnapshot;
    if (accountSyncPaused || !sharedChanged) return;
    accountDirty = true;
    accountChangeVersion += 1;
    scheduleAccountSync(refs);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || routeLoading || detailReminderId) return;
    if (accountDirty) {
      scheduleAccountSync(refs);
      return;
    }
    hydrateAccountData(refs, { preserveLocal: true });
  });
  window.addEventListener("online", () => {
    if (accountDirty) scheduleAccountSync(refs);
  });
}

function bindAuthEvents(root) {
  const startForm = root.querySelector("#accountStartForm");
  const loginForm = root.querySelector("#loginForm");
  const setupForm = root.querySelector("#accountSetupForm");
  const stateLabel = root.querySelector("#accountStartState");
  const phoneInput = root.querySelector("#accountPhoneInput");
  const phoneLabels = Array.from(root.querySelectorAll("[data-account-phone]"));
  let pendingPhone = "";

  const showStep = (step) => {
    startForm.hidden = step !== "start";
    loginForm.hidden = step !== "login";
    setupForm.hidden = step !== "setup";
    if (step === "start") phoneInput.focus();
    if (step === "login") root.querySelector("#loginPassword").focus();
    if (step === "setup") root.querySelector("#nicknameInput").focus();
  };

  root.querySelectorAll("[data-auth-back]").forEach((button) => button.addEventListener("click", () => showStep("start")));

  startForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    stateLabel.textContent = "正在确认账号…";
    const submit = startForm.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const result = await identifyAccount(phoneInput.value);
      pendingPhone = result.phone;
      phoneLabels.forEach((label) => { label.textContent = pendingPhone; });
      showStep(result.exists ? "login" : "setup");
      stateLabel.textContent = "";
    } catch (error) {
      stateLabel.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = root.querySelector("#loginState");
    state.textContent = "正在登录…";
    const submit = loginForm.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const result = await loginAccount({ phone: pendingPhone, password: root.querySelector("#loginPassword").value });
      clearAccountData();
      activeAccount = result.user;
      await startApplication(root);
    } catch (error) {
      state.textContent = error.message;
      submit.disabled = false;
    }
  });

  setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = root.querySelector("#setupState");
    state.textContent = "正在创建账号…";
    const submit = setupForm.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      if (root.querySelector("#setupPassword").value !== root.querySelector("#setupPasswordConfirm").value) {
        throw new Error("两次输入的密码不一致");
      }
      setNickname(root.querySelector("#nicknameInput").value);
      const result = await registerAccount({
        phone: pendingPhone,
        password: root.querySelector("#setupPassword").value,
        snapshot: getSyncSnapshot()
      });
      activeAccount = result.user;
      await startApplication(root);
    } catch (error) {
      state.textContent = error.message;
      submit.disabled = false;
    }
  });
}

function bindEvents(refs) {
  const root = document.querySelector("#app");

  const panel = root.querySelector('#newCategoryPanel');
  const categoryName = root.querySelector('#newCategoryInput');
  const categoryMessage = root.querySelector('#categoryState');
  const toggle = root.querySelector('#addCategoryButton');
  const closeCategoryPanel = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => {
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); categoryMessage.textContent = ''; categoryName.focus();
  });
  root.querySelector('#cancelCategoryButton').addEventListener('click', closeCategoryPanel);
  const saveCategory = async () => {
    const button = root.querySelector('#saveCategoryButton');
    if (button.disabled) return;
    if (!categoriesReady) { categoryMessage.textContent = '分类尚未从账号加载，请联网刷新后再试。'; return; }
    button.disabled = true;
    let added = false;
    try {
      const name = addReminderCategory(categoryName.value);
      added = true;
      renderCategoryOptions(refs, name);
      categoryName.value = ''; closeCategoryPanel();
      categoryMessage.textContent = '分类已保存，正在同步…';
      await flushAccountSync();
      categoryMessage.textContent = '分类已保存并同步。';
    } catch (error) {
      categoryMessage.textContent = added ? `分类已保存在本机，但尚未同步：${error.message}` : error.message;
    } finally { button.disabled = false; }
  };
  root.querySelector('#saveCategoryButton').addEventListener('click', saveCategory);
  categoryName.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); saveCategory(); }
  });
  suggestionUI = bindReminderSuggestions(refs.reminderTitleInput, root.querySelector("#reminderSuggestions"), () => suggestionHistory);
  syncReminderDateDisplay(refs);
  const onReminderDateChange = () => {
    reminderTimeDefault.apply(refs, editingReminderId !== null);
    syncReminderDateDisplay(refs);
  };
  refs.reminderDateInput.addEventListener("input", onReminderDateChange);
  refs.reminderDateInput.addEventListener("change", onReminderDateChange);
  refs.reminderHourSelect.addEventListener("change", () => reminderTimeDefault.markManual());

  root?.addEventListener("click", (event) => {
    const themeButton = event.target instanceof Element ? event.target.closest("[data-theme-option]") : null;
    if (themeButton) {
      const theme = themeButton.dataset.themeOption;
      if (theme === "custom") {
        const activeCustomTheme = getActiveCustomTheme();
        if (activeCustomTheme) {
          selectCustomTheme(activeCustomTheme.id);
          renderAll(refs);
        } else {
          refs.customThemeImageInput.click();
        }
        return;
      }
      setTheme(theme);
      applyTheme(theme);
      renderAll(refs);
      return;
    }

    const weatherButton = event.target instanceof Element ? event.target.closest("[data-refresh-weather]") : null;
    if (weatherButton) {
      refreshWeather(refs);
      return;
    }

    const button = event.target instanceof Element ? event.target.closest("[data-switch-view]") : null;
    if (!button) {
      return;
    }
    const nextView = button.dataset.switchView;
    if (!nextView) {
      return;
    }
    if (nextView === "compose") {
      resetReminderForm(refs);
    }
    setActiveView(refs, nextView);
  });

  refs.customThemeImageInput.addEventListener("change", async () => {
    const [file] = refs.customThemeImageInput.files || [];
    refs.customThemeImageInput.value = "";
    if (!file) {
      return;
    }

    refs.customThemeState.textContent = "正在处理照片…";
    try {
      const customTheme = await prepareThemeImage(file);
      addCustomTheme(customTheme);
      renderAll(refs);
      refs.customThemeState.textContent = `智能推荐：${customTheme.recommendation}，已新增到照片主题库。`;
    } catch (error) {
      refs.customThemeState.textContent = error.message || "照片处理失败，请换一张再试";
    }
  });

  refs.customThemeCreateButton.addEventListener("click", () => refs.customThemeImageInput.click());
  refs.customThemeDeleteCurrentButton.addEventListener("click", () => {
    const activeCustomTheme = getActiveCustomTheme();
    if (!activeCustomTheme || !window.confirm("删除当前照片主题吗？此操作无法恢复。")) return;
    deleteCustomTheme(activeCustomTheme.id);
    renderAll(refs);
    refs.customThemeState.textContent = "照片主题已删除。";
  });
  refs.customThemeGallery.addEventListener("click", (event) => {
    const actionButton = event.target instanceof Element ? event.target.closest("[data-custom-theme-action]") : null;
    if (!actionButton) return;
    const id = actionButton.dataset.customThemeId;
    if (!id) return;

    if (actionButton.dataset.customThemeAction === "delete") {
      if (!window.confirm("删除这张照片主题吗？此操作无法恢复。")) return;
      deleteCustomTheme(id);
      renderAll(refs);
      refs.customThemeState.textContent = "照片主题已删除。";
      return;
    }

    selectCustomTheme(id);
    renderAll(refs);
  });

  refs.salaryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const notification = getNotificationFormState(refs);
    updateSalary({
      day: Number(refs.salaryDaySelect.value),
      amount: refs.salaryAmountInput.value.trim(),
      account: refs.salaryAccountInput.value.trim(),
      notification
    });
    renderAll(refs);
    syncExistingPushSubscription(refs);
  });

  refs.changePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    refs.changePasswordState.textContent = "正在修改密码…";
    try {
      if (refs.newPasswordInput.value !== refs.newPasswordConfirmInput.value) throw new Error("两次输入的新密码不一致");
      await changeAccountPassword({ currentPassword: refs.currentPasswordInput.value, newPassword: refs.newPasswordInput.value });
      refs.changePasswordForm.reset();
      refs.changePasswordState.textContent = "密码已更新，请妥善保管。";
    } catch (error) {
      refs.changePasswordState.textContent = error.message;
    }
  });

  refs.logoutButton.addEventListener("click", async () => {
    if (!window.confirm("退出后会清除这台设备的本地数据与提醒订阅，确定继续吗？")) return;
    refs.logoutButton.disabled = true;
    try {
      await disableSalaryPushNotifications().catch(() => {});
      await logoutAccount();
    } finally {
      clearAccountData();
      activeAccount = null;
      window.location.reload();
    }
  });

  refs.clearAppCacheButton?.addEventListener("click", async () => {
    await refreshAppAssetsAndReload(refs);
  });

  refs.reminderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const wantsNotification = refs.reminderNotificationInput.checked;
    const payload = {
      title: refs.reminderTitleInput.value.trim(),
      date: refs.reminderDateInput.value,
      category: refs.reminderCategoryInput.value,
      leadDays: Number(refs.reminderLeadDaysInput.value) || 0,
      hour: Number(refs.reminderHourSelect.value) || 0,
      notificationEnabled: wantsNotification,
      notes: refs.reminderNotesInput.value.trim()
    };
    const isEditing = Boolean(editingReminderId);

    if (isEditing) {
      updateReminder(editingReminderId, payload);
    } else {
      if (cycleDraft) {
        const fresh = cycleSuggestions(getState().reminders, getState().preferences.cycle).find(item => item.id === cycleDraft.id);
        if (!fresh || fresh.anchorTokens.join() !== cycleDraft.anchorTokens.join()) {
          refs.reminderSaveState.textContent = "这条建议已变化或已处理，请返回首页重新查看。"; return;
        }
      }
      try { addReminder(payload, cycleDraft?.tokens || []); }
      catch(error) { refs.reminderSaveState.textContent = `保存失败：${error.message}`; return; }
    }

    resetReminderForm(refs);
    refs.reminderSaveState.textContent = isEditing ? "事项已更新。" : "事项已保存。";
    renderAll(refs);
    try { await flushAccountSync(); }
    catch(error) {
      refs.reminderBoardState.textContent = `已保存在本机，尚未同步：${error.message}`;
      setActiveView(refs, "reminders"); return;
    }

    if (wantsNotification && !getState().salary.notification.enabled) {
      const enabled = await enablePushAndSync(refs);
      refs.reminderSaveState.textContent = enabled
        ? isEditing ? "事项已更新，通知已同步。" : "事项已保存，通知已同步。"
        : isEditing ? "事项已更新，但通知尚未同步。请在设置中检查状态。" : "事项已保存，但通知尚未同步。请在设置中检查状态。";
      setActiveView(refs, enabled ? "reminders" : "settings");
      return;
    }

    await syncExistingPushSubscription(refs);
    setActiveView(refs, "reminders");
  });

  refs.dailyCountdownInput.addEventListener("change", async () => {
    refs.dailyCountdownInput.dataset.syncing = "true";
    refs.dailyCountdownInput.disabled = true;
    try {
      updateSalary({ notification: {
        ...getState().salary.notification,
        dailyCountdownEnabled: refs.dailyCountdownInput.checked
      } });
      await syncExistingPushSubscription(refs);
    } finally {
      delete refs.dailyCountdownInput.dataset.syncing;
      renderAll(refs);
    }
  });

  refs.pushEnableButton.addEventListener("click", async () => {
    await enablePushAndSync(refs);
  });

  refs.pushDisableButton.addEventListener("click", async () => {
    try {
      await disableSalaryPushNotifications();
      updateSalary({
        notification: {
          ...getState().salary.notification,
          enabled: false,
          endpoint: "",
          permission: typeof Notification === "undefined" ? "default" : Notification.permission,
          lastError: "",
          lastSyncedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      updateSalary({
        notification: {
          ...getState().salary.notification,
          lastError: error.message
        }
      });
    }

    renderAll(refs);
  });

  refs.pushTestButton.addEventListener("click", async () => {
    try {
      const result = await sendLocalTestNotification();
      updateSalary({
        notification: {
          ...getState().salary.notification,
          permission: result.permission,
          lastTestedAt: new Date().toISOString(),
          lastError: ""
        }
      });
    } catch (error) {
      updateSalary({
        notification: {
          ...getState().salary.notification,
          permission: typeof Notification === "undefined" ? "default" : Notification.permission,
          lastError: error.message
        }
      });
    }

    renderAll(refs);
  });

  refs.filters.forEach((button) => {
    button.addEventListener("click", () => {
      setReminderFilter(button.dataset.filter || REMINDER_FILTERS.all);
      renderReminderBoard(getState(), refs);
    });
  });

  root?.addEventListener("click", async (event) => {
    const actionButton = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const id = actionButton.dataset.id;
    if (!action || !id) {
      return;
    }

    if (action === "detail") {
      await openReminderDetail(refs, id);
      return;
    }

    const reminder = getState().reminders.find((entry) => entry.id === id);
    if (!reminder) {
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`确定删除“${reminder.title}”吗？此操作无法恢复。`)) {
        return;
      }
      deleteReminder(id);
      renderAll(refs);
      await syncExistingPushSubscription(refs);
      refs.reminderBoardState.textContent = "事项已删除。";
      return;
    }

    if (action === "edit") {
      openReminderEditor(refs, reminder);
      return;
    }

    if (action === "occurrence") {
      if (await confirmOccurrence(reminder)) {
        renderAll(refs);
        try { await flushAccountSync(); refs.reminderBoardState.textContent = "实际发生日期已保存。"; }
        catch (error) { refs.reminderBoardState.textContent = `日期已保存在本机，尚未同步：${error.message}`; }
      }
      return;
    }

    if (action === "complete" || action === "restore") {
      const completed = action === "complete";
      if (completed) { if (!await confirmOccurrence(reminder)) return; }
      else setReminderCompletion(id, false);
      renderAll(refs);
      try {
        await flushAccountSync();
        await syncExistingPushSubscription(refs);
        refs.reminderBoardState.textContent = completed
          ? "事项已归档到“已完成”，不会再计为逾期或继续推送。"
          : "事项已恢复到待处理列表。";
      } catch (error) {
        refs.reminderBoardState.textContent = `已保存在本机，尚未同步：${error.message}`;
      }
      return;
    }

    if (action === "export") {
      exportSingleReminder(reminder);
    }
  });
}

function openReminderEditor(refs, reminder) {
  editingReminderId = reminder.id;
  refs.reminderDateNotice.textContent = "";
  refs.reminderTitleInput.value = reminder.title;
  refs.reminderDateInput.value = reminder.date;
  renderCategoryOptions(refs, reminder.category, reminder.category);
  refs.reminderLeadDaysInput.value = String(reminder.leadDays);
  refs.reminderHourSelect.value = String(reminder.hour);
  refs.reminderNotificationInput.checked = reminder.notificationEnabled;
  refs.reminderNotesInput.value = reminder.notes;
  suggestionUI?.refresh();
  refs.reminderFormHeading.textContent = "编辑事项";
  refs.reminderFormDescription.textContent = "更新日期、提醒或备注后，保存即可生效。";
  refs.reminderSubmitButton.textContent = "保存修改";
  refs.reminderSaveState.textContent = "";
  syncReminderDateDisplay(refs);
  setActiveView(refs, "compose");
}

function resetReminderForm(refs) {
  cycleDraft = null;
  editingReminderId = null;
  reminderTimeDefault.reset();
  refs.reminderDateNotice.textContent = "";
  refs.reminderForm.reset();
  renderCategoryOptions(refs, DEFAULT_CATEGORIES[0]);
  document.querySelector("#newCategoryPanel").hidden = true;
  document.querySelector("#addCategoryButton").setAttribute("aria-expanded", "false");
  document.querySelector("#categoryState").textContent = "";
  refs.reminderLeadDaysInput.value = "0";
  const now = new Date();
  refs.reminderDateInput.value = formatLocalDateInput(now);
  reminderTimeDefault.apply(refs, false, now);
  refs.reminderNotificationInput.checked = true;
  suggestionUI?.refresh();
  refs.reminderFormHeading.textContent = "新建事项";
  refs.reminderFormDescription.textContent = "记下日期和提醒时刻，到点让小星轻轻提醒你。";
  refs.reminderSubmitButton.textContent = "保存事项";
  syncReminderDateDisplay(refs);
}

function syncReminderDateDisplay(refs) {
  const value = refs.reminderDateInput.value;
  refs.reminderDateDisplay.textContent = value ? formatDateLong(value) : "选择日期";
  refs.reminderDateDisplay.dataset.empty = String(!value);
}

function renderCategoryOptions(refs, selected = refs.reminderCategoryInput.value, legacy = '') {
  const oldCategory = legacy || (editingReminderId ? getState().reminders.find(item => item.id === editingReminderId)?.category : '');
  const values = categoryOptions(categoriesReady ? getState().preferences.customCategories : [], oldCategory);
  refs.reminderCategoryInput.replaceChildren(...values.map(value => {
    const option = document.createElement('option'); option.value = value; option.textContent = value; return option;
  }));
  refs.reminderCategoryInput.value = values.includes(selected) ? selected : DEFAULT_CATEGORIES[0];
}

function renderAll(refs) {
  renderCategoryOptions(refs);
  cycleUI?.render();
  const state = getState();
  applyTheme(state.preferences.theme);
  renderAppearancePanel(state, refs);
  renderDashboard(state, refs);
  renderSalaryPanel(state, refs);
  renderPushPanel(state, refs, getPushCapabilities());
  renderOverviewWeather(state, refs);
  renderReminderBoard(state, refs);
  renderOverviewReminderPreview(state, refs);
  renderAccountPanel(refs);
  renderLifestyle(state);
  syncViewState(refs);
}

function renderAccountPanel(refs) {
  refs.accountStatusBadge.textContent = activeAccount?.phone ? "已登录" : "未登录";
  refs.accountUsername.textContent = activeAccount?.phone
    ? `${getState().preferences.nickname || "我的星期"} · ${activeAccount.phone}`
    : "--";
}

function applyTheme(theme) {
  const nextTheme = Object.hasOwn(APP_THEMES, theme) ? theme : DEFAULT_THEME;
  const root = document.documentElement;
  const customTheme = getActiveCustomTheme();
  const canUseCustomTheme = nextTheme === "custom" && customTheme?.imageDataUrl;
  const appliedTheme = canUseCustomTheme ? "custom" : nextTheme === "custom" ? DEFAULT_THEME : nextTheme;
  root.dataset.theme = appliedTheme;
  root.dataset.customTone = canUseCustomTheme ? customTheme.tone : "";
  if (canUseCustomTheme) {
    root.style.setProperty("--custom-theme-artwork", `url("${customTheme.imageDataUrl}")`);
    CUSTOM_THEME_VARIABLES.forEach((name) => {
      const value = customTheme.palette?.[name];
      if (value) {
        root.style.setProperty(name, value);
      }
    });
  } else {
    root.style.removeProperty("--custom-theme-artwork");
    CUSTOM_THEME_VARIABLES.forEach((name) => root.style.removeProperty(name));
  }
  const themeColor = canUseCustomTheme
    ? customTheme.tone === "light"
      ? "#f8f3ec"
      : "#17130f"
    : APP_THEMES[appliedTheme].themeColor;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
}

function getActiveCustomTheme() {
  const preferences = getState().preferences;
  return preferences.customThemes.find((entry) => entry.id === preferences.activeCustomThemeId) || null;
}

async function hydrateDefaultWeather(refs, state) {
  if (!shouldAutoRefreshWeather(state)) {
    return;
  }

  try {
    await refreshWeather(refs);
  } catch (error) {
    console.warn("Default weather hydration failed", error);
  }
}

async function refreshWeather(refs) {
  const label = "当前位置";
  setWeatherPending(label);
  renderAll(refs);

  try {
    const payload = await fetchWeatherFromCurrentPosition();
    setWeatherSuccess(payload.city || label, payload);
  } catch (error) {
    setWeatherFailure(label, error.message);
  }

  renderAll(refs);
}

function setActiveView(refs, nextView, { scroll = true } = {}) {
  activeView = nextView;
  syncViewState(refs);

  const activeHeading = refs.views
    .find((view) => view.dataset.view === activeView)
    ?.querySelector("h1");
  if (activeHeading instanceof HTMLElement) {
    activeHeading.tabIndex = -1;
    window.requestAnimationFrame(() => activeHeading.focus({ preventScroll: true }));
  }

  if (scroll) {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }
}

function syncViewState(refs) {
  refs.views.forEach((view) => {
    const isActive = view.dataset.view === activeView;
    view.hidden = !isActive;
    view.classList.toggle("is-active", isActive);
  });

  refs.tabButtons.forEach((button) => {
    const isActive = button.dataset.switchView === activeView
      || (activeView === "compose" && button.dataset.switchView === "reminders");
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const hadController = Boolean(navigator.serviceWorker.controller);
  let updateReloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || updateReloading) {
      return;
    }

    updateReloading = true;
    window.location.reload();
  });

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none"
      });
      await registration.update();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      });
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

async function refreshAppAssetsAndReload(refs) {
  const button = refs.clearAppCacheButton;
  const stateLabel = refs.appMaintenanceState;
  if (button) {
    button.disabled = true;
  }
  if (stateLabel) {
    stateLabel.textContent = "正在刷新应用资源...";
  }

  try {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("yoyuan-ledger-"))
          .map((cacheName) => caches.delete(cacheName))
      );
    }

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
    }

    if (stateLabel) {
      stateLabel.textContent = "应用资源已刷新，通知订阅会保留。正在重新加载。";
    }

    const url = new URL(window.location.href);
    url.searchParams.set("refresh", String(Date.now()));
    window.location.replace(url.toString());
  } catch (error) {
    if (button) {
      button.disabled = false;
    }
    if (stateLabel) {
      stateLabel.textContent = `清理失败：${error.message}`;
    }
  }
}

async function hydrateAccountData(refs, { preserveLocal = false } = {}) {
  if (!activeAccount || !navigator.onLine) return;
  try {
    const remote = await loadAccountSnapshot();
    if (!remote.snapshot) return;
    if (preserveLocal && (accountDirty || routeLoading || detailReminderId || remote.revision === accountRevision)) return;
    accountSyncPaused = true;
    replaceSyncedData(remote.snapshot);
    categoriesReady = true;
    suggestionHistory = getState().reminders;
    suggestionUI?.refresh();
    accountRevision = remote.revision;
    accountDirty = false;
    renderAll(refs);
    await syncExistingPushSubscription(refs);
  } catch (error) {
    console.warn("Account sync hydration failed", error);
  } finally {
    accountSyncPaused = false;
  }
}

function scheduleAccountSync(refs) {
  if (accountSyncPaused || !activeAccount) return;
  window.clearTimeout(accountSyncTimer);
  accountSyncTimer = window.setTimeout(() => {
    flushAccountSync().catch((error) => console.warn("Account sync save failed", error));
  }, 800);
}

async function flushAccountSync() {
  window.clearTimeout(accountSyncTimer);
  while (accountSavePromise) await accountSavePromise;
  if (!accountDirty) return;
  if (!navigator.onLine) throw new Error("当前离线，请联网后重试同步。");
  const version = accountChangeVersion;
  const snapshot = getSyncSnapshot();
  accountSavePromise = (async () => {
    const result = await saveAccountSnapshot(snapshot, accountRevision);
    if (result.conflict) {
      // Do not overwrite a newer device snapshot while handling a notification.
      throw new Error("其他设备已更新事项，请刷新后确认最新状态。");
    }
    accountRevision = result.revision;
    suggestionHistory = snapshot.reminders;
    suggestionUI?.refresh();
    if (accountChangeVersion === version) accountDirty = false;
  })();
  try {
    await accountSavePromise;
  } finally {
    accountSavePromise = null;
  }
}

async function confirmOccurrence(reminder) {
  const accountId = activeAccount?.id;
  const occurredOn = await requestOccurrenceDate(reminder);
  if (!occurredOn) return false;
  const current = getState().reminders.find(item => item.id === reminder.id);
  // Do not apply a stale dialog after a restore, deletion, or account change.
  if (activeAccount?.id !== accountId || !current || current.completed !== reminder.completed || current.completedAt !== reminder.completedAt) return false;
  setReminderCompletion(reminder.id, true, occurredOn);
  return true;
}

function renderDetailOccurrence(reminder) {
  document.querySelector("#reminderDetailOccurrence").textContent = reminder.completed
    ? (reminder.occurredOn ? `实际发生于 ${formatDateLong(reminder.occurredOn)}` : "实际发生日期未确认") : "";
  const edit = document.querySelector("#reminderDetailOccurrenceEdit");
  edit.hidden = !reminder.completed;
  edit.textContent = reminder.occurredOn ? "修改实际发生日期" : "补填实际发生日期";
}

function bindReminderNavigation(refs) {
  const dialog = document.querySelector("#reminderDetail");
  showSnoozePanel = bindSnoozePanel(dialog, flushAccountSync);
  const root = document.querySelector("#app");
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("button, a, input, select, textarea, [data-action], [data-switch-view]")) return;
    const card = event.target.closest("[data-reminder-detail]");
    if (card) openReminderDetail(refs, card.dataset.reminderDetail);
  });
  root.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element) || !event.target.matches('.reminder-item__body[role="button"]')) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const card = event.target.closest("[data-reminder-detail]");
    if (card) openReminderDetail(refs, card.dataset.reminderDetail);
  });
  window.addEventListener("hashchange", () => openNotificationReminder(refs));
  dialog.addEventListener("close", () => { if (!dialog.open) detailReminderId = null; });
  document.querySelector("#reminderDetailClose").addEventListener("click", () => dialog.close());
  document.querySelector("#reminderDetailEdit").addEventListener("click", () => {
    const reminder = getState().reminders.find((item) => item.id === detailReminderId);
    dialog.close();
    if (reminder) openReminderEditor(refs, reminder);
  });
  document.querySelector("#reminderDetailOccurrenceEdit").addEventListener("click", async () => {
    const reminder = getState().reminders.find(item => item.id === detailReminderId);
    if (!reminder || !await confirmOccurrence(reminder)) return;
    renderAll(refs);
    renderDetailOccurrence(getState().reminders.find(item => item.id === reminder.id));
    try { await flushAccountSync(); document.querySelector("#reminderDetailState").textContent = "实际发生日期已保存。"; }
    catch (error) { document.querySelector("#reminderDetailState").textContent = `日期已保存在本机，尚未同步：${error.message}`; }
  });
  document.querySelector("#reminderDetailComplete").addEventListener("click", async () => {
    const id = detailReminderId;
    const reminder = getState().reminders.find((item) => item.id === id);
    if (!reminder) return;
    const button = document.querySelector("#reminderDetailComplete");
    const status = document.querySelector("#reminderDetailState");
    if (!reminder.completed && !await confirmOccurrence(reminder)) return;
    button.disabled = true;
    status.textContent = "正在同步完成状态…";
    renderDetailOccurrence(getState().reminders.find(item => item.id === id));
    renderAll(refs);
    try {
      await flushAccountSync();
      await syncExistingPushSubscription(refs);
      if (detailReminderId !== id) return;
      showSnoozePanel({ ...reminder, completed: true });
      document.querySelector("#reminderDetailMeta").textContent = `${formatDateLong(reminder.date)} · ${reminder.category || "事项"} · 已完成`;
      const pushError = getState().salary.notification.lastError;
      status.textContent = pushError ? `事项已完成并保存；提醒规则同步失败：${pushError}` : "事项已完成并同步。";
      button.textContent = pushError ? "重试提醒同步" : "已完成";
      button.disabled = !pushError;
    } catch (error) {
      if (detailReminderId !== id) return;
      status.textContent = `已在本机标记完成，但尚未同步：${error.message}`;
      button.textContent = "重试同步";
      button.disabled = false;
    }
  });
}

async function openNotificationReminder(refs) {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.has("cycle")) return openCycleNotification(refs, params.get("cycle"));
  if (!params.has("reminder")) return;
  return openReminderDetail(refs, params.get("reminder"), { consumeRoute: true });
}

async function openCycleNotification(refs, id) {
  const version = ++routeVersion;
  routeLoading = true;
  setActiveView(refs, "overview");
  const feedback = document.querySelector("#cycleFeedback");
  feedback.hidden = false; feedback.textContent = "正在核对周期建议…";
  try {
    await flushAccountSync();
    if (!navigator.onLine) throw new Error("当前离线，请联网后重新打开通知。");
    const response = await fetch(`/api/push/cycle?id=${encodeURIComponent(id)}`, {credentials:"same-origin"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "暂时无法读取建议");
    const remote = await loadAccountSnapshot();
    if (version !== routeVersion) return;
    if (accountDirty) throw new Error("本机修改尚未同步，请稍后重试。");
    accountSyncPaused = true;
    try { replaceSyncedData(remote.snapshot || {reminders:[]}); accountRevision = remote.revision; categoriesReady = true; }
    finally { accountSyncPaused = false; }
    renderAll(refs);
    const fresh = cycleSuggestions(getState().reminders,getState().preferences.cycle).find(item => item.id === result.suggestion.id
      && item.anchorTokens.join() === result.suggestion.anchorTokens.join());
    if (!fresh || !getState().preferences.cycle.pushEnabled) throw new Error("这条建议已处理或不再满足条件。");
    history.replaceState(null,"",window.location.pathname+window.location.search);
    feedback.hidden = true; cycleUI.openSuggestion(fresh);
  } catch(error) {
    if (version === routeVersion) feedback.textContent = `暂时无法打开建议：${error.message}`;
  } finally { if (version === routeVersion) routeLoading = false; }
}

async function openReminderDetail(refs, id, { consumeRoute = false } = {}) {
  const version = ++routeVersion;
  routeLoading = true;
  const dialog = document.querySelector("#reminderDetail");
  if (dialog.open) dialog.close();
  if (consumeRoute) setActiveView(refs, "reminders");
  refs.reminderBoardState.textContent = "正在加载提醒事项…";
  try {
    await flushAccountSync();
    if (!navigator.onLine) throw new Error("当前离线，无法核对提醒事项。联网后重新点击通知或刷新重试。");
    const remote = await loadAccountSnapshot();
    if (version !== routeVersion) return;
    // Resolve only against the authenticated account, never a stale local cache.
    if (accountDirty) throw new Error("本机仍有修改正在保存，请稍后重新打开提醒。");
    accountSyncPaused = true;
    try {
      replaceSyncedData(remote.snapshot || { reminders: [] });
      categoriesReady = true;
      suggestionHistory = getState().reminders;
      suggestionUI?.refresh();
      accountRevision = remote.revision;
    } finally {
      accountSyncPaused = false;
    }
    renderAll(refs);
    const reminder = remote.snapshot?.reminders?.find((item) => item.id === id);
    if (consumeRoute) history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!reminder) {
      setActiveView(refs, "reminders");
      refs.reminderBoardState.textContent = "该事项已删除或当前账号无权访问，请在事项列表中查看其他事项。";
      return;
    }
    detailReminderId = id;
    document.querySelector("#reminderDetailTitle").textContent = reminder.title;
    document.querySelector("#reminderDetailMeta").textContent = `${formatDateLong(reminder.date)} · ${reminder.category || "事项"} · ${reminder.completed ? "已完成" : "待处理"}`;
    renderDetailOccurrence(reminder);
    document.querySelector("#reminderDetailNotes").textContent = reminder.notes || "暂无备注";
    document.querySelector("#reminderDetailState").textContent = reminder.completed ? "该事项已完成。" : "";
    const button = document.querySelector("#reminderDetailComplete");
    button.disabled = Boolean(reminder.completed);
    button.textContent = reminder.completed ? "已完成" : "完成事项";
    refs.reminderBoardState.textContent = "";
    dialog.showModal();
    showSnoozePanel(reminder);
  } catch (error) {
    if (version === routeVersion) {
      setActiveView(refs, "reminders");
      refs.reminderBoardState.textContent = `暂时无法打开提醒事项：${error.message}`;
    }
  } finally {
    if (version === routeVersion) routeLoading = false;
  }
}

async function hydratePushSubscription(refs) {
  if (!supportsPushNotifications()) {
    renderAll(refs);
    return;
  }

  try {
    const subscription = await getCurrentPushSubscription();
    const permission = typeof Notification === "undefined" ? "default" : Notification.permission;
    updateSalary({
      notification: {
        ...getState().salary.notification,
        permission,
        endpoint: subscription?.endpoint || "",
        enabled: Boolean(subscription?.endpoint) && permission === "granted",
        lastError: ""
      }
    });
  } catch (error) {
    updateSalary({
      notification: {
        ...getState().salary.notification,
        permission: typeof Notification === "undefined" ? "default" : Notification.permission,
        lastError: error.message
      }
    });
  }

  renderAll(refs);
}

async function syncExistingPushSubscription(refs) {
  if (!supportsPushNotifications()) {
    return;
  }

  const notification = getState().salary.notification;
  if (!notification.enabled || Notification.permission !== "granted") {
    return;
  }

  try {
    const result = await syncSalaryPushRule({
      day: getState().salary.day,
      leadDays: notification.leadDays,
      hour: notification.hour,
      dailyCountdownEnabled: notification.dailyCountdownEnabled
    });

    if (!result?.endpoint) throw new Error("本设备通知订阅已失效，请重新开启通知");
    await syncReminderPushRules({ reminders: getState().reminders });

    if (result?.endpoint) {
      updateSalary({
        notification: {
          ...getState().salary.notification,
          endpoint: result.endpoint,
          lastSyncedAt: new Date().toISOString(),
          lastError: ""
        }
      });
      renderAll(refs);
    }
  } catch (error) {
    updateSalary({
      notification: {
        ...getState().salary.notification,
        lastError: error.message
      }
    });
    renderAll(refs);
  }
}

async function enablePushAndSync(refs) {
  const state = getState();
  const nextNotification = getNotificationFormState(refs);

  updateSalary({
    notification: {
      ...state.salary.notification,
      ...nextNotification,
      lastError: ""
    }
  });
  renderAll(refs);

  try {
    const result = await enableSalaryPushNotifications({
      day: state.salary.day,
      leadDays: nextNotification.leadDays,
      hour: nextNotification.hour,
      dailyCountdownEnabled: nextNotification.dailyCountdownEnabled
    });

    updateSalary({
      notification: {
        ...getState().salary.notification,
        ...nextNotification,
        enabled: true,
        permission: "granted",
        endpoint: result.endpoint,
        lastSyncedAt: new Date().toISOString(),
        lastError: ""
      }
    });
    await syncExistingPushSubscription(refs);
    return true;
  } catch (error) {
    updateSalary({
      notification: {
        ...getState().salary.notification,
        ...nextNotification,
        enabled: false,
        permission: typeof Notification === "undefined" ? "default" : Notification.permission,
        lastError: error.message
      }
    });
    return false;
  } finally {
    renderAll(refs);
  }
}

function getNotificationFormState(refs) {
  return {
    dailyCountdownEnabled: refs.dailyCountdownInput.checked,
    leadDays: Number(refs.pushLeadDaysInput.value) || 0,
    hour: Number(refs.pushHourSelect.value) || 0,
    timezone: "Asia/Shanghai",
    permission: typeof Notification === "undefined" ? "default" : Notification.permission
  };
}

function getPushCapabilities() {
  return {
    supported: supportsPushNotifications(),
    standalone: typeof window !== "undefined" ? isStandaloneExperience() : false
  };
}

function shouldAutoRefreshWeather(state) {
  const city = state.weather?.payload?.city || "";
  if (
    state.weather?.status !== "ready" ||
    state.weather?.payload?.country !== "自动定位" ||
    city === "当前位置" ||
    city.startsWith("北纬")
  ) {
    return true;
  }

  const updatedAt = new Date(state.weather?.updatedAt || 0).getTime();
  return Date.now() - updatedAt > 30 * 60 * 1000;
}

async function fetchWeatherFromCurrentPosition() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("当前设备不支持定位");
  }

  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60 * 1000
    });
  }).catch((error) => {
    if (error?.code === 1) {
      throw new Error("请允许位置权限");
    }

    throw new Error("暂时无法定位");
  });

  return fetchWeatherReportByCoordinates(position.coords.latitude, position.coords.longitude);
}
