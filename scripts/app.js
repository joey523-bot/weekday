import { setupRecovery } from "./views/recovery.js";
import { setupClockout } from "./views/clockout.js";
import { updateClockout } from "./state.js";
let clockoutUI;
import { bindRepeatSettings, repeatStatusLabel, displayReminder, nextReminderLabel, isRepeatInactive, hasMultipleTimes } from "./views/repeat.js";
import { repeatSummary, beijingDate } from "./utils/repeat.js";
import { setupLifestyle, renderLifestyle } from "./views/lifestyle.js";
import { bindCycleUI } from "./views/cycle.js";
import { cycleSuggestions } from "./utils/cycle.js";
import { requestOccurrenceDate } from "./views/occurrence.js";
import { bindSnoozePanel } from "./services/snooze.js";
import { categoryOptions, DEFAULT_CATEGORIES } from "./utils/reminder-categories.js";
import { APP_META, APP_THEMES, DEFAULT_THEME, REMINDER_FILTERS } from "./config.js";
import {
  addReminder,
  manageRepeat,
  previewRepeatResume,
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
let editingRepeatScope = "once";
let editingOccurrenceDate = "";
let repeatUI = null;
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
let detailOccurrenceDate = "";
let detailOccurrenceTime = "";
let detailPinnedOccurrence = false;
let detailActionBusy = false;
let detailSnoozeKey = "";
let repeatResumeTarget = null;
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
    setupRecovery(root);
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
  setupRecovery(root);
  setupLifestyle(root);
  clockoutUI=setupClockout(root,{getState,save:updateClockout,sync:flushAccountSync});

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
  clearTimeout(dueRefreshTimer);
  const refreshClockViews = () => {
    clockoutUI?.render();
    if (document.visibilityState !== 'visible' || !activeAccount) return;
    renderDashboard(getState(), refs);
    renderReminderBoard(getState(), refs);
    renderOverviewReminderPreview(getState(), refs);
    cycleUI?.renderSuggestions();
    renderLifestyle(getState());
    const isEditingDetail = document.querySelector('#occurrenceDialog')?.open || document.querySelector('#repeatScopeDialog')?.open
      || document.querySelector('#snoozePanel details')?.open;
    if (detailReminderId && !detailActionBusy && !routeLoading && !isEditingDetail) {
      const reminder = getState().reminders.find(item => item.id === detailReminderId);
      if (reminder) renderReminderDetailContents(reminder);
    }
  };
  const scheduleClockRefresh = () => {
    clearTimeout(dueRefreshTimer);
    dueRefreshTimer = setTimeout(() => { refreshClockViews(); scheduleClockRefresh(); }, 60000 - Date.now() % 60000 + 25);
  };
  scheduleClockRefresh();
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
    if (document.visibilityState !== "visible") return;
    refreshClockViews(); scheduleClockRefresh();
    if (routeLoading || detailReminderId) return;
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
    root.querySelector(".auth-card__head h2").textContent = step === "login" ? "输入密码" : step === "setup" ? "创建账号" : "输入手机号";
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
  repeatUI = bindRepeatSettings(root, refs, () => syncReminderDateDisplay(refs));

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
    if (!repeatUI?.isRepeating()) reminderTimeDefault.apply(refs, editingReminderId !== null);
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
    let repeat;
    try { repeat = repeatUI.get(); }
    catch(error) { refs.reminderSaveState.textContent = error.message; return; }
    const payload = {
      title: refs.reminderTitleInput.value.trim(),
      date: refs.reminderDateInput.value,
      category: refs.reminderCategoryInput.value,
      leadDays: hasMultipleTimes(repeat) ? 0 : Number(refs.reminderLeadDaysInput.value) || 0,
      hour: Number(refs.reminderHourSelect.value) || 0,
      notificationEnabled: wantsNotification,
      notes: refs.reminderNotesInput.value.trim(),
      repeat
    };
    const isEditing = Boolean(editingReminderId);
    const savedReminderId = editingReminderId;

    if (isEditing) {
      try { updateReminder(editingReminderId, payload, editingRepeatScope, {occurrenceDate: editingOccurrenceDate}); }
      catch(error) { refs.reminderSaveState.textContent = `保存失败：${error.message}`; return; }
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

    const remainsInactive = savedReminderId && isRepeatInactive(getState().reminders.find(item => item.id === savedReminderId));
    if (remainsInactive) setReminderFilter(REMINDER_FILTERS.inactive);
    resetReminderForm(refs);
    refs.reminderSaveState.textContent = remainsInactive ? "修改已保存，仍保持停用。" : isEditing ? "事项已更新。" : "事项已保存。";
    renderAll(refs);
    try { await flushAccountSync(); }
    catch(error) {
      refs.reminderBoardState.textContent = `已保存在本机，尚未同步：${error.message}`;
      setActiveView(refs, "reminders"); return;
    }

    if (!remainsInactive && wantsNotification && !getState().salary.notification.enabled) {
      const enabled = await enablePushAndSync(refs);
      refs.reminderSaveState.textContent = enabled
        ? isEditing ? "事项已更新，通知已同步。" : "事项已保存，通知已同步。"
        : isEditing ? "事项已更新，但通知尚未同步。请在设置中检查状态。" : "事项已保存，但通知尚未同步。请在设置中检查状态。";
      setActiveView(refs, enabled ? "reminders" : "settings");
      return;
    }

    await syncExistingPushSubscription(refs);
    if (remainsInactive) refs.reminderBoardState.textContent = "修改已保存，仍保持停用。准备好后可以重新启用。";
    setActiveView(refs, "reminders");
  });

  refs.pushHourSelect.addEventListener("change", async () => {
    updateSalary({ notification: { ...getState().salary.notification, hour: Number(refs.pushHourSelect.value) } });
    try {
      await flushAccountSync();
      await syncExistingPushSubscription(refs);
    } catch(error) { refs.dailyCountdownNote.textContent = error.message; }
  });

  refs.dailyCountdownInput.addEventListener("change", async () => {
    refs.dailyCountdownInput.dataset.syncing = "true";
    refs.dailyCountdownInput.disabled = true;
    try {
      updateSalary({ notification: {
        ...getState().salary.notification,
        dailyCountdownEnabled: refs.dailyCountdownInput.checked
      } });
      await flushAccountSync();
      await syncExistingPushSubscription(refs);
    } catch(error) {
      refs.dailyCountdownNote.textContent = error.message;
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

    if (action === "repeat-resume") {
      await openReminderDetail(refs, id);
      if (detailReminderId === id) openRepeatResume(refs, id);
      return;
    }

    const rawReminder = getState().reminders.find((entry) => entry.id === id);
    const occurrenceDate = actionButton.closest('[data-reminder-detail]')?.dataset.occurrence || '';
    const occurrenceTime = actionButton.closest('[data-reminder-detail]')?.dataset.slot || '';
    const reminder = action === 'delete' ? rawReminder : rawReminder ? displayReminder(rawReminder, {occurrenceDate, occurrenceTime, reminders:getState().reminders, resolveHistory:action !== 'edit'}) : null;
    if (!reminder) {
      return;
    }

    if (action === "delete") {
      const warning = reminder.repeat && reminder.repeat.status !== 'history' ? `确定删除“${reminder.title}”并停止整个循环吗？历史期次保留，此操作无法恢复。` : `确定删除“${reminder.title}”吗？此操作无法恢复。`;
      if (!window.confirm(warning)) {
        return;
      }
      deleteReminder(id);
      renderAll(refs);
      await syncExistingPushSubscription(refs);
      refs.reminderBoardState.textContent = "事项已删除。";
      return;
    }

    if (action === "edit") {
      await openReminderEditor(refs, reminder);
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
      else { if (reminder.repeat) return; setReminderCompletion(id, false); }
      renderAll(refs);
      try {
        await flushAccountSync();
        await syncExistingPushSubscription(refs);
        refs.reminderBoardState.textContent = completed
          ? reminder.repeat ? hasMultipleTimes(reminder.repeat) ? "当天已完成，剩余提醒继续按计划进行。" : "本次已完成；下一期按循环规则安排，可在待处理列表查看。" : "事项已归档到“已完成”，不会再计为逾期或继续推送。"
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

async function openReminderEditor(refs, reminder) {
  const frozenOccurrence = reminder.repeat?.scheduledDate || '';
  if (reminder.repeat?.status === 'history' || reminder.repeat && reminder.completed) return;
  const inactive = isRepeatInactive(reminder);
  const scope = inactive ? 'series' : reminder.repeat ? await repeatUI.chooseScope(reminder.repeat) : 'once';
  if (!scope) return;
  if (!getState().reminders.some(item => item.id === reminder.id)) return;
  editingRepeatScope = scope;
  editingOccurrenceDate = inactive ? '' : frozenOccurrence;
  editingReminderId = reminder.id;
  refs.reminderDateNotice.textContent = "";
  refs.reminderTitleInput.value = reminder.title;
  refs.reminderDateInput.value = reminder.date;
  renderCategoryOptions(refs, reminder.category, reminder.category);
  refs.reminderLeadDaysInput.value = String(reminder.leadDays);
  refs.reminderHourSelect.value = String(reminder.hour);
  refs.reminderNotificationInput.checked = reminder.notificationEnabled;
  refs.reminderNotesInput.value = reminder.notes;
  repeatUI.set(reminder.repeat, {lock: Boolean(reminder.repeat) && scope === "once", inactive});
  suggestionUI?.refresh();
  refs.reminderFormHeading.textContent = "编辑事项";
  refs.reminderFormDescription.textContent = inactive ? "修改循环设置，历史记录保持不变。保存后仍为停用状态，不会恢复提醒。" : reminder.repeat ? (scope === "once" ? hasMultipleTimes(reminder.repeat) ? "仅修改当天的内容和推送开关；当天时段与后续计划保持不变，历史保持不变。" : "仅修改本次；后续仍按原计划，历史保持不变。" : "修改当前事项及未来计划，历史保持不变。") : "更新日期、提醒或备注后，保存即可生效。";
  refs.reminderSubmitButton.textContent = "保存修改";
  refs.reminderSaveState.textContent = "";
  syncReminderDateDisplay(refs);
  setActiveView(refs, "compose");
}

function resetReminderForm(refs) {
  cycleDraft = null;
  editingReminderId = null;
  editingRepeatScope = "once";
  editingOccurrenceDate = "";
  repeatUI?.set(null);
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
  clockoutUI?.render();
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
    document.querySelector('.workspace')?.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? "instant" : "smooth"
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

  // Do not reload on controllerchange: repeated controller changes can restart
  // a reload loop because in-memory guards disappear on every navigation.
  // Keep the current page and drafts; the explicit refresh action applies updates.
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
  if (reminder.repeat && reminder.repeat.status !== 'active') return false;
  const accountId = activeAccount?.id;
  const requestedDate = requestOccurrenceDate(reminder);
  if (reminder.repeat) document.querySelector('#occurrenceTitle').textContent = hasMultipleTimes(reminder.repeat)
    ? `${reminder.title} · 当天事项日期 ${formatDateLong(reminder.date)}（北京时间）。只记录一天的完成历史，剩余提醒继续。`
    : `${reminder.title} · 本次事项日期 ${formatDateLong(reminder.date)} ${reminder.repeat.time}（北京时间）`;
  const occurredOn = await requestedDate;
  if (!occurredOn) return false;
  const current = getState().reminders.find(item => item.id === reminder.id);
  // Do not apply a stale dialog after a restore, deletion, or account change.
  if (activeAccount?.id !== accountId || !current || current.completed !== reminder.completed || current.completedAt !== reminder.completedAt) return false;
  if (current.repeat && !(current.repeat.status === 'active' || current.repeat.mode === 'fixed' && current.repeat.status === 'calendar_wait')) return false;
  try {
    if (reminder.repeat) manageRepeat(reminder.id, 'complete', {occurredOn, occurrenceDate:reminder.repeat.scheduledDate});
    else setReminderCompletion(reminder.id, true, occurredOn);
    return true;
  } catch(error) {
    document.querySelector('#reminderDetailState').textContent = error.message;
    document.querySelector('#reminderBoardState').textContent = error.message;
    return false;
  }
}

function renderDetailOccurrence(reminder) {
  document.querySelector("#reminderDetailOccurrence").textContent = reminder.repeatOutcome === "skipped" ? hasMultipleTimes(reminder.repeat) ? "当天已跳过，取消当天全部提醒；原有完成历史保留" : "本次已跳过，不记作完成" : reminder.completed
    ? (reminder.occurredOn ? `实际发生于 ${formatDateLong(reminder.occurredOn)}` : "实际发生日期未确认") : "";
  const edit = document.querySelector("#reminderDetailOccurrenceEdit");
  edit.hidden = !reminder.completed || Boolean(reminder.repeat);
  edit.textContent = reminder.occurredOn ? "修改实际发生日期" : "补填实际发生日期";
}

function openRepeatResume(refs, id) {
  const reminder = getState().reminders.find(item => item.id === id);
  if (!reminder?.repeat || reminder.completed || reminder.repeat.status === 'history') return;
  repeatResumeTarget = { id, accountId:activeAccount?.id };
  const input = document.querySelector('#repeatResumeDate');
  const now = new Date(), rule = reminder.repeat;
  const lead = reminder.notificationEnabled ? Number(reminder.leadDays || 0) : 0;
  let earliest = beijingDate(new Date(now.getTime() + lead * 86400000));
  if (Date.parse(`${earliest}T${rule.time}:00+08:00`) - lead * 86400000 <= now.getTime()) {
    earliest = new Date(Date.parse(`${earliest}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  }
  input.min = [earliest,rule.startDate].sort().at(-1);
  input.max = rule.endDate || '';
  input.value = [input.min,reminder.date].sort().at(-1);
  document.querySelector('#repeatResumeDateField').hidden = rule.mode !== 'after';
  document.querySelector('#repeatResumeEdit').hidden = false;
  updateRepeatResumePreview();
  document.querySelector('#repeatResumeDialog').showModal();
}

function updateRepeatResumePreview() {
  const target = repeatResumeTarget;
  const reminder = target && getState().reminders.find(item => item.id === target.id);
  const error = document.querySelector('#repeatResumeError');
  const preview = document.querySelector('#repeatResumePreview');
  const button = document.querySelector('#repeatResumeConfirm');
  error.textContent = ''; preview.textContent = ''; button.disabled = true;
  if (!reminder || target.accountId !== activeAccount?.id) { error.textContent = '事项已变化，请关闭后重新打开。'; return; }
  document.querySelector('#repeatResumeNote').textContent = reminder.repeat.mode === 'after'
    ? '确认首次事项日期，完成本次后再按间隔安排下一次。已有历史记录保持不变。'
    : '沿原来的周期继续，停用期间的提醒不补发。需要调整周期或结束日期时，请先编辑。';
  document.querySelector('#repeatResumeNote').textContent += ' 已经发送过的同一期提醒不会重复发送。';
  try {
    const proposed = previewRepeatResume(target.id, { firstDate:document.querySelector('#repeatResumeDate').value });
    preview.textContent = `${formatDateLong(proposed.date)} · 事项日期\n${nextReminderLabel(proposed.dueAt, proposed.notificationEnabled)}`;
    if (!proposed.notificationEnabled) preview.textContent += ' · 仅记录，不推送';
    button.disabled = false;
  } catch(e) { error.textContent = e.message; }
}

function bindRepeatResume(refs) {
  const dialog = document.querySelector('#repeatResumeDialog');
  for (const id of ['repeatResumeClose','repeatResumeCancel']) document.querySelector(`#${id}`).addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{ if (!dialog.open) repeatResumeTarget = null; });
  document.querySelector('#repeatResumeDate').addEventListener('input',updateRepeatResumePreview);
  document.querySelector('#repeatResumeDate').addEventListener('change',updateRepeatResumePreview);
  document.querySelector('#repeatResumeEdit').addEventListener('click',async()=>{
    const target = repeatResumeTarget;
    const reminder = target && getState().reminders.find(item=>item.id===target.id);
    dialog.close(); document.querySelector('#reminderDetail').close();
    if (reminder) await openReminderEditor(refs,displayReminder(reminder));
  });
  document.querySelector('#repeatResumeConfirm').addEventListener('click',async()=>{
    const target = repeatResumeTarget;
    if (!target || detailActionBusy || target.accountId !== activeAccount?.id) return;
    const button=document.querySelector('#repeatResumeConfirm');
    const error=document.querySelector('#repeatResumeError');
    detailActionBusy=true; button.disabled=true;
    let saved=false;
    try {
      const options={firstDate:document.querySelector('#repeatResumeDate').value,now:new Date()};
      const proposed = previewRepeatResume(target.id,options);
      const result = manageRepeat(target.id,'resume',options);
      saved=true;
      setReminderFilter(REMINDER_FILTERS.all);
      detailPinnedOccurrence=false; detailOccurrenceDate=''; detailOccurrenceTime='';
      renderAll(refs);
      if (detailReminderId===target.id) renderReminderDetailContents(result);
      await flushAccountSync();
      if (proposed.notificationEnabled && !getState().salary.notification.enabled) await enablePushAndSync(refs);
      else await syncExistingPushSubscription(refs);
      const push=getState().salary.notification;
      refs.reminderBoardState.textContent = push.lastError ? `循环已启用；提醒同步失败：${push.lastError}`
        : proposed.notificationEnabled && !push.enabled ? '循环已启用。设备通知尚未开启，可到“我的”开启通知。'
          : proposed.notificationEnabled ? '循环已重新启用，下一次提醒已安排。' : '循环已重新启用，下一次计划已安排；仅记录，不推送。';
      dialog.close(); document.querySelector('#reminderDetail').close(); setActiveView(refs,'reminders');
    } catch(e) {
      if (saved) {
        dialog.close(); document.querySelector('#reminderDetail').close(); setActiveView(refs,'reminders');
        refs.reminderBoardState.textContent=`循环已保存在本机，尚未同步：${e.message}。联网并刷新后重试同步。`;
      } else { updateRepeatResumePreview(); error.textContent=e.message; }
    } finally { detailActionBusy=false; }
  });
}

function bindReminderNavigation(refs) {
  const dialog = document.querySelector("#reminderDetail");
  showSnoozePanel = bindSnoozePanel(dialog, flushAccountSync);
  bindRepeatResume(refs);
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
  dialog.addEventListener("close", () => { if (!dialog.open) { detailReminderId = null; detailOccurrenceDate = ""; detailOccurrenceTime = ""; detailPinnedOccurrence = false; detailSnoozeKey = ""; } });
  document.querySelector("#reminderDetailClose").addEventListener("click", () => dialog.close());
  document.querySelector("#reminderDetailEdit").addEventListener("click", async () => {
    const raw = getState().reminders.find((item) => item.id === detailReminderId);
    const reminder = raw ? displayReminder(raw, {occurrenceDate:isRepeatInactive(raw) ? '' : detailOccurrenceDate, occurrenceTime:detailOccurrenceTime, reminders:getState().reminders, resolveHistory:detailPinnedOccurrence}) : null;
    dialog.close();
    if (reminder) await openReminderEditor(refs, reminder);
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
    const raw = getState().reminders.find(item => item.id === id);
    if (!raw || detailActionBusy) return;
    const frozenDate = detailOccurrenceDate;
    const frozenTime = detailOccurrenceTime;
    const reminder = displayReminder(raw, {occurrenceDate:frozenDate, occurrenceTime:frozenTime, reminders:getState().reminders});
    const button = document.querySelector("#reminderDetailComplete");
    const status = document.querySelector("#reminderDetailState");
    detailActionBusy = true;
    try {
      if (!reminder.completed && !await confirmOccurrence(reminder)) return;
      detailPinnedOccurrence = Boolean(reminder.repeat?.mode === 'fixed');
      detailOccurrenceDate = frozenDate;
      detailOccurrenceTime = frozenTime;
      button.disabled = true;
      status.textContent = "正在同步完成状态…";
      renderAll(refs);
      renderReminderDetailContents(getState().reminders.find(item => item.id === id));
      await flushAccountSync();
      await syncExistingPushSubscription(refs);
      if (detailReminderId !== id) return;
      const pushError = getState().salary.notification.lastError;
      status.textContent = pushError ? `本次已保存；提醒规则同步失败：${pushError}` : reminder.repeat
        ? hasMultipleTimes(reminder.repeat) ? '当天已完成并同步。当天只记一条完成历史，剩余提醒继续按计划进行。' : reminder.repeat.mode === 'fixed' ? '本次已完成并同步。固定周期继续按计划提醒，完成记录不会改变后续安排。' : '本次已完成并同步。下一期按完成后的间隔安排。'
        : "事项已完成并同步。";
      if (pushError) { button.textContent = "重试提醒同步"; button.disabled = false; }
      else dialog.close();
    } catch(error) {
      if (detailReminderId !== id) return;
      status.textContent = `本次操作尚未同步：${error.message}`;
      button.textContent = "重试同步"; button.disabled = false;
    } finally { detailActionBusy = false; }
  });
  document.querySelector("#repeatManagement").addEventListener("click", async event => {
    const button = event.target.closest('[data-repeat-action]');
    const reminder = getState().reminders.find(item => item.id === detailReminderId);
    if (!button || button.disabled || !reminder?.repeat || detailActionBusy) return;
    const action = button.dataset.repeatAction, id = reminder.id;
    if (action === 'resume') { openRepeatResume(refs,id); return; }
    if (['pause','end'].includes(action) && !window.confirm('停用这个循环？将移出待处理并停止提醒。内容和历史记录保留，可以在“已停用”中编辑或重新启用。')) return;
    if (action === 'skip' && !window.confirm(hasMultipleTimes(reminder.repeat) ? `跳过${formatDateLong(detailOccurrenceDate)}当天？取消当天全部提醒，原有完成历史保留，后续日期按原计划继续。` : reminder.repeat.mode === 'after' ? '跳过本次？从今天重新计算间隔，不记作完成。' : '跳过本次并接续未来计划？本次不记作完成。')) return;
    const status = document.querySelector('#reminderDetailState');
    const frozenDate = detailOccurrenceDate;
    detailActionBusy = true; button.disabled = true;
    try {
      if (action !== 'sync') manageRepeat(id, action, {occurrenceDate:frozenDate});
      if (reminder.repeat.mode === 'fixed') { detailPinnedOccurrence = action === 'skip'; detailOccurrenceDate = frozenDate; }
      renderAll(refs);
      renderReminderDetailContents(getState().reminders.find(item => item.id === id));
      status.textContent = '正在同步循环状态…';
      await flushAccountSync(); await syncExistingPushSubscription(refs);
      if (detailReminderId !== id) return;
      const pushError = getState().salary.notification.lastError;
      status.textContent = pushError ? `循环状态已保存；提醒同步失败：${pushError}` : ['pause','end'].includes(action) ? '已停用。可以在“已停用”中编辑或重新启用，历史记录保持不变。' : '循环状态已同步。停用期间不补发提醒。';
      document.querySelector('[data-repeat-action="sync"]').hidden = !pushError;
    } catch(error) {
      status.textContent = `操作未同步：${error.message}`;
      document.querySelector('[data-repeat-action="sync"]').hidden = false;
    } finally { detailActionBusy = false; button.disabled = false; }
  });
}

async function openNotificationReminder(refs) {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.has("cycle")) return openCycleNotification(refs, params.get("cycle"));
  if (!params.has("reminder")) return;
  return openReminderDetail(refs, params.get("reminder"), { consumeRoute: true, occurrenceDate:params.get("occurrence") || "", occurrenceTime:params.get("slot") || "" });
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

async function openReminderDetail(refs, id, { consumeRoute = false, occurrenceDate = "", occurrenceTime = "" } = {}) {
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
    if (!remote.snapshot) throw new Error("云端事项尚未初始化，已保留本机事项，请稍后重试。");
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
    detailOccurrenceDate = occurrenceDate;
    detailOccurrenceTime = occurrenceTime;
    detailPinnedOccurrence = Boolean(occurrenceDate);
    detailSnoozeKey = "";
    renderReminderDetailContents(reminder);
    document.querySelector("#reminderDetailState").textContent = '';
    refs.reminderBoardState.textContent = "";
    dialog.showModal();
  } catch (error) {
    if (version === routeVersion) {
      setActiveView(refs, "reminders");
      refs.reminderBoardState.textContent = `暂时无法打开提醒事项：${error.message}`;
    }
  } finally {
    if (version === routeVersion) routeLoading = false;
  }
}

function renderReminderDetailContents(rawReminder) {
  if (!rawReminder) return;
  const reminder = displayReminder(rawReminder, {occurrenceDate:detailPinnedOccurrence ? detailOccurrenceDate : '', occurrenceTime:detailPinnedOccurrence ? detailOccurrenceTime : '', reminders:getState().reminders});
  detailOccurrenceDate = reminder.repeat?.scheduledDate || '';
  detailOccurrenceTime = reminder.notificationSlot || reminder.repeat?.time || '';
  const rule = reminder.repeat;
  const multiple = hasMultipleTimes(rule);
  const inactive = rule && rule.status !== 'active';
  const stopped = isRepeatInactive(reminder);
  const historical = rule?.status === 'history';
  document.querySelector('#reminderDetailTitle').textContent = reminder.title;
  document.querySelector('#reminderDetailMeta').textContent = `${stopped ? '' : `${formatDateLong(reminder.date)} · `}${reminder.category || '事项'} · ${rule ? repeatStatusLabel(reminder) : reminder.completed ? '已完成' : '待处理'}${multiple && detailPinnedOccurrence && detailOccurrenceTime ? ` · 本条提醒 ${detailOccurrenceTime} 北京时间` : ''}`;
  const summary = document.querySelector('#reminderDetailRepeat');
  summary.hidden = !rule;
  summary.textContent = rule ? `↻ 循环 · ${repeatSummary(rule)} · ${multiple ? '' : `${rule.time} `}北京时间${rule.endDate ? ` · 至${rule.endDate}` : ''}` : '';
  const next = document.querySelector('#reminderDetailNext');
  next.hidden = !reminder.nextReminderAt;
  next.textContent = nextReminderLabel(reminder.nextReminderAt, reminder.nextNotificationEnabled);
  renderDetailOccurrence(reminder);
  if (reminder.recordedOutcome) document.querySelector('#reminderDetailOccurrence').textContent = multiple ? '当天已记录完成，剩余提醒继续按计划进行。' : '本次已记录完成，提醒仍按原计划进行。';
  document.querySelector('#reminderDetailNotes').textContent = reminder.notes || '暂无备注';
  const complete = document.querySelector('#reminderDetailComplete');
  complete.hidden = Boolean(stopped);
  complete.disabled = Boolean(reminder.completed || inactive || reminder.recordedOutcome);
  complete.textContent = reminder.recordedOutcome ? multiple ? '当天已记录' : '本次已记录' : reminder.completed ? repeatStatusLabel(reminder) || '已完成' : rule ? multiple ? '完成当天' : '完成本次' : '完成事项';
  document.querySelector('#reminderDetailEdit').hidden = Boolean(historical);
  document.querySelector('#repeatManagement').hidden = !rule;
  document.querySelector('[data-repeat-action="skip"]').hidden = !rule || inactive;
  document.querySelector('[data-repeat-action="skip"]').textContent = multiple ? '跳过当天' : '跳过本次';
  document.querySelector('[data-repeat-action="pause"]').hidden = !rule || !['active','calendar_wait'].includes(rule.status);
  document.querySelector('[data-repeat-action="resume"]').hidden = !rule || !(stopped || rule.status === 'calendar_wait');
  document.querySelector('[data-repeat-action="end"]').hidden = true;
  document.querySelector('[data-repeat-action="sync"]').hidden = true;
  document.querySelector('#repeatDetailNote').textContent = !rule ? '' : rule.status === 'calendar_wait'
    ? '工作日日历待更新，更新后可恢复循环。当前不排期、不发送提醒。' : rule.status === 'history'
      ? '这是历史期次，不能恢复或重新开启循环。后续计划请在待处理列表查看。' : stopped
        ? '已停止提醒，内容、循环设置和历史记录已保留。可以编辑；保存后仍保持停用，重新启用前会确认下一次安排。'
          : multiple ? `同一天仍是一项。完成当天只记一次历史，剩余提醒继续；跳过当天取消当天全部提醒。${reminder.nextNotificationEnabled ? '下次提醒是计划时间，不代表已发送；推送可能延迟几分钟。' : '下次计划仅记录，不推送。'}` : rule.mode === 'fixed' ? reminder.nextNotificationEnabled ? '固定周期无需点完成，到点自动继续。完成只记录历史，跳过只取消所选这一次。下次提醒是计划时间，不代表已发送；推送可能延迟几分钟。' : '固定周期无需点完成，到点自动继续。完成只记录历史，跳过只取消所选这一次。下次计划仅记录，不推送。'
            : '完成或跳过后接续下一期。循环按北京时间安排，同步后生效；到点可能延迟几分钟送达。';
  const snoozeKey = `${reminder.id}:${detailOccurrenceDate}:${detailOccurrenceTime}:${rule?.status || ''}:${reminder.completed}:${reminder.recordedOutcome || ''}`;
  if (snoozeKey !== detailSnoozeKey) {
    detailSnoozeKey = snoozeKey;
    showSnoozePanel(inactive || reminder.recordedOutcome ? { ...reminder, completed:true } : reminder);
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
    if (activeAccount) await flushAccountSync();
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
    if (activeAccount) await flushAccountSync();
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
