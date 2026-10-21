import { repeatSummary, beijingDate } from "../utils/repeat.js";
import { repeatStatusLabel, displayReminder, nextReminderLabel, isRepeatInactive, hasMultipleTimes } from "./repeat.js";
import { isWeatherFresh } from "../utils/lifestyle.js";
import { renderMoon, renderOutfit } from "./lifestyle.js";
import { isReminderDue } from "../utils/snooze.js";
import { APP_THEMES, REMINDER_FILTERS, WEATHER_CODES } from "../config.js";
import {
  formatCountdown,
  formatDateLong,
  formatDateWithWeekday,
  formatTime,
  getDaysUntil,
  getNextSalaryDate,
  getReminderTone
} from "../utils/date.js";
import { escapeHtml, formatAccount, formatAmount, formatTemperature } from "../utils/format.js";

export function createRefs(root) {
  return {
    views: Array.from(root.querySelectorAll("[data-view]")),
    tabButtons: Array.from(root.querySelectorAll("[data-tab-button]")),
    pushSummaryValue: root.querySelector("#pushSummaryValue"),
    pushSummaryMeta: root.querySelector("#pushSummaryMeta"),
    pushNudge: root.querySelector("#pushNudge"),
    pushNudgeTitle: root.querySelector("#pushNudgeTitle"),
    pushNudgeText: root.querySelector("#pushNudgeText"),
    todayLabel: root.querySelector("#todayLabel"),
    salaryStatus: root.querySelector("#salaryStatus"),
    salaryCountdown: root.querySelector("#salaryCountdown"),
    salaryCountdownUnit: root.querySelector("#salaryCountdownUnit"),
    salaryDate: root.querySelector("#salaryDate"),
    salaryAmountDisplay: root.querySelector("#salaryAmountDisplay"),
    salaryAccountDisplay: root.querySelector("#salaryAccountDisplay"),
    salaryForm: root.querySelector("#salaryForm"),
    salaryDaySelect: root.querySelector("#salaryDaySelect"),
    salaryAmountInput: root.querySelector("#salaryAmountInput"),
    salaryAccountInput: root.querySelector("#salaryAccountInput"),
    pushStatusBadge: root.querySelector("#pushStatusBadge"),
    pushSupportNote: root.querySelector("#pushSupportNote"),
    pushLeadDaysInput: root.querySelector("#pushLeadDaysInput"),
    pushHourSelect: root.querySelector("#pushHourSelect"),
    dailyCountdownInput: root.querySelector("#dailyCountdownInput"),
    pushPermissionLabel: root.querySelector("#pushPermissionLabel"),
    pushEnableButton: root.querySelector("#pushEnableButton"),
    pushTestButton: root.querySelector("#pushTestButton"),
    pushDisableButton: root.querySelector("#pushDisableButton"),
    pushSyncState: root.querySelector("#pushSyncState"),
    reminderForm: root.querySelector("#reminderForm"),
    reminderTitleInput: root.querySelector("#reminderTitleInput"),
    reminderDateNotice: root.querySelector("#reminderDateNotice"),
    reminderDateInput: root.querySelector("#reminderDateInput"),
    reminderDateDisplay: root.querySelector("#reminderDateDisplay"),
    reminderCategoryInput: root.querySelector("#reminderCategoryInput"),
    reminderLeadDaysInput: root.querySelector("#reminderLeadDaysInput"),
    reminderHourSelect: root.querySelector("#reminderHourSelect"),
    reminderNotificationInput: root.querySelector("#reminderNotificationInput"),
    reminderNotesInput: root.querySelector("#reminderNotesInput"),
    reminderSaveState: root.querySelector("#reminderSaveState"),
    reminderSubmitButton: root.querySelector("#reminderSubmitButton"),
    reminderFormHeading: root.querySelector("#reminderFormHeading"),
    reminderFormDescription: root.querySelector("#reminderFormDescription"),
    reminderCount: root.querySelector("#reminderCount"),
    overviewReminderCount: root.querySelector("#overviewReminderCount"),
    overviewReminderList: root.querySelector("#overviewReminderList"),
    reminderList: root.querySelector("#reminderList"),
    boardPanel: root.querySelector("#reminderBoard"),
    reminderFilters: root.querySelector(".filters"),
    filters: Array.from(root.querySelectorAll("[data-filter]")),
    overviewWeather: Array.from(root.querySelectorAll("[data-weather-slot]")),
    overviewMonth: root.querySelector("#overviewMonth"),
    salaryReminderDate: root.querySelector("#salaryReminderDate"),
    salaryReminderState: root.querySelector("#salaryReminderState"),
    reminderSummaryValue: root.querySelector("#reminderSummaryValue"),
    reminderSummaryMeta: root.querySelector("#reminderSummaryMeta"),
    reminderBoardMeta: root.querySelector("#reminderBoardMeta"),
    accountStatusBadge: root.querySelector("#accountStatusBadge"),
    accountUsername: root.querySelector("#accountUsername"),
    changePasswordForm: root.querySelector("#changePasswordForm"),
    currentPasswordInput: root.querySelector("#currentPasswordInput"),
    newPasswordInput: root.querySelector("#newPasswordInput"),
    newPasswordConfirmInput: root.querySelector("#newPasswordConfirmInput"),
    changePasswordState: root.querySelector("#changePasswordState"),
    logoutButton: root.querySelector("#logoutButton"),
    clearAppCacheButton: root.querySelector("#clearAppCacheButton"),
    appMaintenanceState: root.querySelector("#appMaintenanceState"),
    themeStatusBadge: root.querySelector("#themeStatusBadge"),
    themeButtons: Array.from(root.querySelectorAll("[data-theme-option]")),
    customThemeImageInput: root.querySelector("#customThemeImageInput"),
    customThemeCreateButton: root.querySelector("#customThemeCreateButton"),
    customThemeGallery: root.querySelector("#customThemeGallery"),
    customThemeDeleteCurrentButton: root.querySelector("#customThemeDeleteCurrentButton"),
    customThemeState: root.querySelector("#customThemeState"),
    reminderBoardState: root.querySelector("#reminderBoardState")
  };
}

export function renderAppearancePanel(state, refs) {
  const theme = state.preferences.theme;
  refs.themeStatusBadge.textContent = APP_THEMES[theme]?.label || APP_THEMES.forest.label;
  refs.themeButtons.forEach((button) => {
    const isActive = button.dataset.themeOption === theme;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  const customThemes = state.preferences.customThemes || [];
  const activeCustomTheme = customThemes.find((entry) => entry.id === state.preferences.activeCustomThemeId) || null;
  const customImage = activeCustomTheme?.imageDataUrl || "";
  const customButton = refs.themeButtons.find((button) => button.dataset.themeOption === "custom");
  if (customButton) {
    customButton.classList.toggle("has-custom-image", Boolean(customImage));
    customButton.querySelector(".theme-option__preview")?.style.setProperty(
      "--theme-preview-image",
      customImage ? `url("${customImage}")` : ""
    );
  }
  refs.customThemeGallery.hidden = customThemes.length === 0;
  refs.customThemeGallery.innerHTML = customThemes
    .map((entry) => customThemeLibraryItem(entry, entry.id === state.preferences.activeCustomThemeId))
    .join("");
  refs.customThemeDeleteCurrentButton.hidden = !activeCustomTheme;
  refs.customThemeDeleteCurrentButton.disabled = !activeCustomTheme;
  refs.customThemeState.textContent = customImage
    ? `当前使用：${activeCustomTheme.recommendation || "已根据照片配色"}。最多可保存 3 张照片主题，仅保存在当前设备。`
    : "从相册选择一张照片，系统会识别主色和明暗，智能生成外观。最多可保存 3 张。";
}

function customThemeLibraryItem(theme, isActive) {
  const preview = ` style="--custom-theme-preview: url(&quot;${theme.imageDataUrl}&quot;)"`;
  return `
    <article class="custom-theme-library__item${isActive ? " is-active" : ""}">
      <button class="custom-theme-library__select" data-custom-theme-action="select" data-custom-theme-id="${escapeHtml(theme.id)}" type="button" aria-pressed="${String(isActive)}">
        <span class="custom-theme-library__preview"${preview} aria-hidden="true"></span>
        <span><strong>${escapeHtml(theme.recommendation || "智能照片主题")}</strong><small>${isActive ? "正在使用" : "轻点切换"}</small></span>
      </button>
      <button class="custom-theme-library__delete" data-custom-theme-action="delete" data-custom-theme-id="${escapeHtml(theme.id)}" type="button" aria-label="删除照片主题 ${escapeHtml(theme.recommendation || "智能照片主题")}">${getThemeDeleteIcon()}<span>删除</span></button>
    </article>
  `;
}

function getThemeDeleteIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;
}

export function populateSalaryOptions(select, currentDay) {
  if (select.childElementCount > 0) {
    select.value = String(currentDay);
    return;
  }

  for (let day = 1; day <= 28; day += 1) {
    const option = document.createElement("option");
    option.value = String(day);
    option.textContent = `${day} 日`;
    if (day === currentDay) {
      option.selected = true;
    }
    select.append(option);
  }
}

export function renderDashboard(state, refs) {
  refs.todayLabel.textContent = formatDateWithWeekday(new Date());
  if (refs.overviewMonth) {
    refs.overviewMonth.textContent = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long"
    }).format(new Date());
  }

  if (refs.reminderSummaryValue && refs.reminderSummaryMeta) {
    const pending = state.reminders.map(entry => displayReminder(entry, {reminders: state.reminders})).filter((entry) => !entry.completed && !isRepeatInactive(entry) && (!entry.repeat || entry.repeat.status === "active"));
    const upcoming = pending.filter((entry) => reminderDaysUntil(entry) >= 0);
    refs.reminderSummaryValue.textContent = String(pending.length);
    refs.reminderSummaryMeta.textContent = pending.length
      ? upcoming.length
        ? "近期需要处理"
        : "有事项已经逾期"
      : "暂时没有待办";
  }
}

export function renderSalaryPanel(state, refs, reference = new Date()) {
  const nextSalaryDate = getNextSalaryDate(state.salary.day, reference);
  const daysUntil = nextSalaryDate ? getDaysUntil(nextSalaryDate, reference) : null;
  const reminderDate = nextSalaryDate ? new Date(nextSalaryDate) : null;
  if (reminderDate) reminderDate.setDate(reminderDate.getDate() - state.salary.notification.leadDays);

  refs.salaryStatus.textContent = `每月 ${state.salary.day} 日`;
  refs.salaryDate.textContent = nextSalaryDate ? formatDateWithWeekday(nextSalaryDate) : "工作日日历待更新";
  if (refs.salaryReminderDate) {
    refs.salaryReminderDate.textContent = reminderDate ? formatDateLong(reminderDate) : "待日历更新后确定";
  }
  if (refs.salaryReminderState) {
    refs.salaryReminderState.textContent = !nextSalaryDate && state.salary.notification.enabled
      ? "暂停：工作日日历待更新" : state.salary.notification.enabled ? "已开启" : "未开启";
  }
  refs.salaryAmountDisplay.textContent = formatAmount(state.salary.amount);
  refs.salaryAccountDisplay.textContent = formatAccount(state.salary.account);

  if (refs.salaryCountdown && refs.salaryCountdownUnit) {
    if (daysUntil === null) {
      refs.salaryCountdown.textContent = "--";
      refs.salaryCountdownUnit.textContent = "待更新";
    } else if (daysUntil === 0) {
      refs.salaryCountdown.textContent = "0";
      refs.salaryCountdownUnit.textContent = "今天";
    } else if (daysUntil < 0) {
      refs.salaryCountdown.textContent = String(Math.abs(daysUntil));
      refs.salaryCountdownUnit.textContent = "天前";
    } else {
      refs.salaryCountdown.textContent = String(daysUntil);
      refs.salaryCountdownUnit.textContent = "天";
    }
  }

  refs.salaryDaySelect.value = String(state.salary.day);
  refs.salaryAmountInput.value = state.salary.amount;
  refs.salaryAccountInput.value = state.salary.account;
}

export function renderPushPanel(state, refs, capabilities) {
  const notification = state.salary.notification;
  const permissionText =
    notification.permission === "granted"
      ? "权限已允许"
      : notification.permission === "denied"
        ? "权限已拒绝"
        : "权限未请求";

  refs.pushLeadDaysInput.value = String(notification.leadDays);
  refs.pushHourSelect.value = String(notification.hour);
  refs.dailyCountdownInput.checked = notification.dailyCountdownEnabled === true;
  refs.dailyCountdownInput.disabled = refs.dailyCountdownInput.dataset.syncing === "true";
  refs.pushPermissionLabel.textContent = permissionText;
  refs.pushEnableButton.textContent = notification.enabled ? "重新同步提醒" : "开启通知并同步";
  refs.pushEnableButton.disabled = !capabilities.supported;
  refs.pushTestButton.disabled = !capabilities.supported;
  refs.pushDisableButton.disabled = !notification.enabled && !notification.endpoint;

  if (refs.pushSummaryValue && refs.pushSummaryMeta) {
    refs.pushSummaryValue.textContent = !capabilities.supported
      ? "不支持"
      : notification.enabled
        ? "已开启"
        : notification.lastError
          ? "失败"
          : "未开启";
    refs.pushSummaryMeta.textContent = notification.enabled
      ? `${notification.leadDays} 天前 · ${formatHour(notification.hour)}`
      : "设置工资与事项的推送时刻";
  }

  renderPushNudge(refs, capabilities, notification, state);

  if (!capabilities.supported) {
    refs.pushStatusBadge.textContent = "当前不支持";
    refs.pushSupportNote.textContent = "当前环境不支持推送。";
    refs.pushSyncState.textContent = "不影响本地记录和看板使用。";
    return;
  }

  refs.pushSupportNote.textContent = capabilities.standalone
    ? "可直接申请通知权限。"
    : "iPhone 需先添加到主屏幕后再申请通知。";

  if (notification.lastError) {
    refs.pushStatusBadge.textContent = "同步失败";
    refs.pushSyncState.textContent = `设置尚未确认生效：${notification.lastError}。请点击重新同步提醒重试。`;
    return;
  }

  if (notification.enabled) {
    refs.pushStatusBadge.textContent = "提醒已同步";
    const syncText = notification.lastSyncedAt
      ? `已同步到推送服务，最近一次同步时间：${formatTime(notification.lastSyncedAt)}`
      : "工资和自定义事项提醒已开启。";
    refs.pushSyncState.textContent = notification.lastTestedAt
      ? `${syncText} 最近一次本机测试通知：${formatTime(notification.lastTestedAt)}`
      : syncText;
    return;
  }

  refs.pushStatusBadge.textContent = notification.lastError ? "同步失败" : "未开启";
  refs.pushSyncState.textContent = notification.lastError
    ? notification.lastTestedAt
      ? `${notification.lastError} 最近一次本机测试通知：${formatTime(notification.lastTestedAt)}`
      : notification.lastError
    : "开启后会同步当前设备的工资和自定义事项提醒。";
}

function renderPushNudge(refs, capabilities, notification, state) {
  if (!refs.pushNudge || !refs.pushNudgeTitle || !refs.pushNudgeText) {
    return;
  }

  const hasNotifiedReminders = state.reminders.some((entry) => entry.notificationEnabled && !entry.completed && !isRepeatInactive(entry) && (!entry.repeat || entry.repeat.status === 'active'));
  const shouldShow = !notification.enabled || !capabilities.supported;
  refs.pushNudge.hidden = !shouldShow;

  if (!capabilities.supported) {
    refs.pushNudgeTitle.textContent = "当前环境不支持通知";
    refs.pushNudgeText.textContent = "请从 iPhone 主屏幕打开此应用后再开启提醒。";
    return;
  }

  if (notification.permission === "denied") {
    refs.pushNudgeTitle.textContent = "通知权限已关闭";
    refs.pushNudgeText.textContent = "请在 iPhone 设置中允许“星期”发送通知。";
    return;
  }

  refs.pushNudgeTitle.textContent = hasNotifiedReminders ? "有事项等待开启通知" : "通知尚未准备好";
  refs.pushNudgeText.textContent = hasNotifiedReminders
    ? "开启一次即可同步这些事项，并按设定时间提醒。"
    : "需要提醒时，在新事项中打开“推送提醒”即可。";
}

export function renderOverviewWeather(state, refs) {
  if (!refs.overviewWeather?.length) {
    return;
  }

  refs.overviewWeather.forEach((slot) => renderWeatherSlot(state, slot));
}

function renderWeatherSlot(state, slot) {
  const isOverviewCard = Boolean(slot.closest(".xm-weather-card"));
  const renderDetailState = (title, detail, { action = false, loading = false } = {}) => {
    const tag = action ? "button" : "div";
    const attributes = action ? 'data-refresh-weather type="button"' : 'role="status"';
    slot.innerHTML = `
      <${tag} class="weather-detail-state${loading ? " is-loading" : ""}" ${attributes}>
        <span class="weather-detail-state__icon${loading ? " weather-widget__icon--loading" : ""}" aria-hidden="true">${getWeatherIconSvg(null)}</span>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(detail)}</span>
      </${tag}>
    `;
  };

  if (state.weather.status === "loading") {
    if (isOverviewCard) {
      slot.innerHTML = `
        <button class="xm-weather-card__content is-loading" data-refresh-weather type="button" aria-label="正在获取当前位置天气">
          <span class="xm-weather-card__icon weather-widget__icon--loading" aria-hidden="true">${getWeatherIconSvg(null)}</span>
          <span class="xm-weather-card__copy"><strong>正在定位</strong><small>获取你身边的天气</small></span>
        </button>
      `;
      return;
    }
    renderDetailState("正在获取实况", "重新定位并同步最新天气…", { loading: true });
    return;
  }

  if (state.weather.status === "error") {
    if (isOverviewCard) {
      slot.innerHTML = `
        <button class="xm-weather-card__content" data-refresh-weather type="button">
          <span class="xm-weather-card__icon" aria-hidden="true">${getWeatherIconSvg(null)}</span>
          <span class="xm-weather-card__copy"><strong>天气暂不可用</strong><small>轻点重新定位</small></span>
        </button>
      `;
      return;
    }
    renderDetailState("天气暂不可用", state.weather.error || "请检查定位和网络后重试。", { action: true });
    return;
  }

  if (!state.weather.payload) {
    if (isOverviewCard) {
      slot.innerHTML = `
        <button class="xm-weather-card__content" data-refresh-weather type="button">
          <span class="xm-weather-card__icon" aria-hidden="true">${getWeatherIconSvg(null)}</span>
          <span class="xm-weather-card__copy"><strong>查看当前天气</strong><small>轻点允许定位</small></span>
        </button>
      `;
      return;
    }
    renderDetailState("查看当前位置天气", "轻点后允许定位，即可获得实况和出行建议。", { action: true });
    return;
  }

  const payload = state.weather.payload;
  if (isOverviewCard) {
    const condition = WEATHER_CODES[payload.weatherCode] || "天气更新";
    const city = payload.city || "当前位置";
    slot.closest(".xm-weather-card")?.querySelector(".xm-weather-card__location")?.replaceChildren(
      document.createTextNode(city),
      createLocationIcon()
    );
    slot.innerHTML = `
      <button class="xm-weather-card__content" data-refresh-weather type="button" aria-label="刷新${escapeHtml(city)}天气">
        <span class="xm-weather-card__icon" aria-hidden="true">${getWeatherIconSvg(payload.weatherCode, payload.isDay)}</span>
        <span class="xm-weather-card__copy">
          <strong>${escapeHtml(condition)} ${formatTemperature(payload.temperature)}</strong>
          <small>${escapeHtml(getOverviewWeatherHint(payload))}</small>
        </span>
      </button>
    `;
    return;
  }
  renderWeatherDetail(state, slot, payload);
}

function renderWeatherDetail(state, slot, payload) {
  const fresh = isWeatherFresh(payload);
  const condition = WEATHER_CODES[payload.weatherCode] || "天气更新";
  const city = payload.city || "当前位置";
  const today = payload.dailyForecast?.[0] || {};
  const advice = Array.isArray(payload.advice) ? payload.advice : [];
  const forecast = Array.isArray(payload.dailyForecast) ? payload.dailyForecast : [];
  const rainProbability = payload.rainProbability ?? today.rainProbability;
  const wind = [formatMetric(payload.windSpeed, "km/h"), formatWindDirection(payload.windDirection)]
    .filter((value) => value !== "—")
    .join(" ") || "—";
  const updateText = formatWeatherUpdateTime(payload.observedAt || state.weather.updatedAt);
  const refreshLabel = `重新定位并刷新${city}天气，当前${condition}${formatTemperature(payload.temperature)}`;

  slot.innerHTML = `
    <div class="weather-detail">
      <section class="weather-hero" aria-labelledby="weatherCondition">
        <div class="weather-hero__topline">
          <span class="weather-hero__location">${getLocationIconSvg()}${escapeHtml(city)}</span>
          <span class="weather-hero__live">${fresh ? "实况" : "待更新"}</span>
        </div>
        <div class="weather-hero__main">
          <span class="weather-hero__icon" aria-hidden="true">${getWeatherIconSvg(payload.weatherCode, payload.isDay)}</span>
          <div>
            <p id="weatherCondition" class="weather-hero__condition">${escapeHtml(condition)}</p>
            <strong class="weather-hero__temp">${formatTemperature(payload.temperature)}</strong>
            <p class="weather-hero__feels">体感 ${formatTemperature(payload.apparentTemperature)}</p>
          </div>
        </div>
        <div class="weather-hero__footer">
          <span>今日 ${formatTemperature(today.high)} / ${formatTemperature(today.low)}</span>
          <button class="weather-refresh-control" data-refresh-weather type="button" aria-label="${escapeHtml(refreshLabel)}">
            ${getRefreshIconSvg()}<span>${escapeHtml(updateText)}</span>
          </button>
        </div>
      </section>

      ${fresh ? renderOutfit(payload) : '<p class="form-note">天气数据已过期或时间未知，请刷新后查看当前UV和穿衣建议。</p>'}
      <section class="weather-section"><h2>追月亮</h2>${renderMoon(payload)}</section>
      <section class="weather-section" aria-labelledby="weatherAdviceTitle">
        <div class="weather-section__heading">
          <div><span>出门前</span><h2 id="weatherAdviceTitle">生活建议</h2></div>
          <span class="weather-section__badge">${advice.length || 1} 条</span>
        </div>
        <div class="weather-advice-list">
          ${(advice.length ? advice : [{ kind: "outing", title: "天气已更新", detail: "出门前可再轻点刷新一次。" }])
            .map((item) => `
              <article class="weather-advice">
                <span class="weather-advice__icon weather-advice__icon--${escapeHtml(item.kind)}" aria-hidden="true">${getAdviceIconSvg(item.kind)}</span>
                <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></div>
              </article>
            `).join("")}
        </div>
      </section>

      <section class="weather-section" aria-labelledby="weatherMetricsTitle">
        <div class="weather-section__heading"><div><span>现在</span><h2 id="weatherMetricsTitle">天气详情</h2></div></div>
        <div class="weather-detail__metrics">
          ${renderWeatherMetric("降水概率", formatMetric(rainProbability, "%"), "umbrella")}
          ${renderWeatherMetric("相对湿度", formatMetric(payload.humidity, "%"), "humidity")}
          ${renderWeatherMetric("风速风向", wind, "wind")}
          ${renderWeatherMetric("当前UV", formatUvIndex(fresh ? payload.uvIndex : null), "sun")}
          ${renderWeatherMetric("今日最高UV", formatUvIndex(today.uvIndex), "sun")}
        </div>
      </section>

      ${forecast.length ? `
        <section class="weather-section" aria-labelledby="weatherForecastTitle">
          <div class="weather-section__heading"><div><span>接下来</span><h2 id="weatherForecastTitle">未来四天</h2></div></div>
          <div class="weather-forecast-list" role="list">
            ${forecast.map((day, index) => renderForecastDay(day, index)).join("")}
          </div>
        </section>
      ` : ""}

      <p class="weather-source">${escapeHtml(payload.source || "天气服务")} · ${escapeHtml(updateText)} · 轻点时间可重新定位</p>
    </div>
  `;
}

function renderWeatherMetric(label, value, icon) {
  return `
    <article class="weather-detail-metric">
      <span class="weather-detail-metric__icon" aria-hidden="true">${getAdviceIconSvg(icon)}</span>
      <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    </article>
  `;
}

function renderForecastDay(day, index) {
  const condition = WEATHER_CODES[day.weatherCode] || "天气变化";
  return `
    <article class="weather-forecast-day" role="listitem">
      <div class="weather-forecast-day__date"><strong>${escapeHtml(formatForecastDay(day.date, index))}</strong><span>${escapeHtml(condition)}</span></div>
      <span class="weather-forecast-day__icon" aria-hidden="true">${getWeatherIconSvg(day.weatherCode, true)}</span>
      <span class="weather-forecast-day__rain">${getAdviceIconSvg("umbrella")}${formatMetric(day.rainProbability, "%")}</span>
      <span class="weather-forecast-day__temp"><strong>${formatTemperature(day.high)}</strong><span>${formatTemperature(day.low)}</span></span>
    </article>
  `;
}

function getOverviewWeatherHint(payload) {
  const advice = payload.advice?.[1] || payload.advice?.[0];
  return advice?.title ? `${advice.title} · 轻点刷新` : "实况天气 · 轻点刷新";
}

function formatMetric(value, suffix) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}${suffix}` : "—";
}

function formatUvIndex(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 8) return `${number.toFixed(1)} · 很强`;
  if (number >= 6) return `${number.toFixed(1)} · 较强`;
  if (number >= 3) return `${number.toFixed(1)} · 中等`;
  return `${number.toFixed(1)} · 较弱`;
}

function formatWindDirection(degrees) {
  if (degrees === null || degrees === undefined || degrees === "") return "—";
  const number = Number(degrees);
  if (!Number.isFinite(number)) return "—";
  const directions = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return directions[Math.round(number / 45) % directions.length];
}

function formatWeatherUpdateTime(value) {
  if (!value) return "刚刚更新";
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return `${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)} 更新`;
}

function formatForecastDay(value, index) {
  if (index === 0) return "今天";
  if (index === 1) return "明天";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "未来";
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
}

function createLocationIcon() {
  const wrapper = document.createElement("span");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.innerHTML = getLocationIconSvg();
  return wrapper;
}

function getLocationIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
}

function getRefreshIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>`;
}

function getAdviceIconSvg(kind) {
  const icons = {
    clothing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4 4 6l-2 5 4 2v8h12v-8l4-2-2-5-4-2a4 4 0 0 1-8 0Z"/></svg>`,
    umbrella: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13a9 9 0 0 1 18 0H3Z"/><path d="M12 4v15a2 2 0 0 0 4 0"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 18h.01"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    wind: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg>`,
    humidity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12Z"/><path d="M9 16c.7 1.3 1.8 2 3.2 2"/></svg>`,
    outing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19c4-7 8-10 16-14"/><path d="m13 5 7-1-1 7M5 15l4 4M9 10l5 5"/></svg>`
  };
  return icons[kind] || icons.outing;
}

export function renderReminderBoard(state, refs) {
  const sorted = getSortedReminders(state.reminders.map(entry => displayReminder(entry, {reminders: state.reminders})));
  const filtered = applyFilter(sorted, state.preferences.reminderFilter);

  refs.reminderCount.textContent = `${filtered.length} 条`;
  refs.reminderCount.hidden = sorted.length === 0;
  if (refs.boardPanel) {
    refs.boardPanel.hidden = false;
  }
  if (refs.reminderFilters) {
    refs.reminderFilters.hidden = sorted.length === 0;
  }
  if (refs.reminderBoardMeta) {
    refs.reminderBoardMeta.textContent = state.preferences.reminderFilter === REMINDER_FILTERS.inactive
      ? '停用的循环保留在这里，可编辑后重新启用。'
      : sorted.length ? `共 ${sorted.length} 条，历史与停用的事项保留在相应筛选中` : "把要做的事都放在这里";
  }

  refs.filters.forEach((button) => {
    if (button.dataset.filter === REMINDER_FILTERS.completed) button.textContent = sorted.some(entry => entry.repeatOutcome === 'skipped') ? '已完成/跳过' : '已完成';
    button.classList.toggle("is-active", button.dataset.filter === state.preferences.reminderFilter);
    button.setAttribute('aria-selected', String(button.dataset.filter === state.preferences.reminderFilter));
  });

  if (!filtered.length) {
    refs.reminderList.innerHTML = `
      <div class="empty-state empty-state--quiet">
        <p class="empty-state__title">${getEmptyReminderTitle(sorted, state.preferences.reminderFilter)}</p>
        <p class="empty-state__hint">${sorted.length ? "换个筛选条件看看。" : "轻点右上角的加号，安排第一件事。"}</p>
      </div>
    `;
    return;
  }

  if (state.preferences.reminderFilter === REMINDER_FILTERS.inactive) {
    refs.reminderList.innerHTML = filtered.map(renderInactiveReminderItem).join('');
    return;
  }

  const groups = new Map();
  for (const entry of filtered) {
    const days = reminderDaysUntil(entry);
    const label = days < 0 ? '过去' : days === 0 ? '今天' : days === 1 ? '明天' : '之后';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entry);
  }
  refs.reminderList.innerHTML = [...groups].map(([label, entries]) =>
    `<section class="reminder-time-group"><h3>${label}</h3>${entries.map(renderReminderItem).join("")}</section>`).join("");
}

export function renderOverviewReminderPreview(state, refs) {
  const pending = getSortedReminders(state.reminders.map(entry => displayReminder(entry, {reminders: state.reminders})).filter((entry) => !entry.completed && !isRepeatInactive(entry) && (!entry.repeat || entry.repeat.status === "active")));
  const preview = pending.slice(0, 3);
  refs.overviewReminderCount.textContent = `${pending.length} 条`;
  refs.overviewReminderCount.hidden = pending.length === 0;
  refs.overviewReminderList.innerHTML = preview.length
    ? preview.map((entry) => renderReminderItem(entry, { preview: true })).join("")
    : `<div class="empty-state empty-state--quiet"><p class="empty-state__title">还没有待处理事项</p><p class="empty-state__hint">轻点“新建”，安排第一件事。</p></div>`;
}

function renderReminderItem(entry, { preview = false } = {}) {
  if (isRepeatInactive(entry)) return renderInactiveReminderItem(entry);
  const days = reminderDaysUntil(entry);
  const due = isReminderDue(entry);
  const inactive = entry.repeat && entry.repeat.status !== 'active';
  const historical = entry.repeat && ['history','ended'].includes(entry.repeat.status);
  const multiple = hasMultipleTimes(entry.repeat);
  const tone = entry.completed || inactive ? "completed" : due ? "due" : getReminderTone(days);
  const schedule = entry.repeatOutcome === 'skipped' ? `${formatDateWithWeekday(entry.date)} · ${multiple ? '当天已跳过' : '本次已跳过'}`
    : inactive && !entry.completed ? `${formatDateWithWeekday(entry.date)} · ${repeatStatusLabel(entry)}` : entry.completed
    ? (entry.occurredOn ? `实际发生于 ${formatDateWithWeekday(entry.occurredOn)}` : "已完成 · 实际发生日期未确认")
    : days < 0
      ? `${formatDateWithWeekday(entry.date)} · 已逾期`
      : days === 0
        ? `${formatDateWithWeekday(entry.date)} · 今天`
        : formatDateWithWeekday(entry.date);
  const notification = entry.nextReminderAt ? `${nextReminderLabel(entry.nextReminderAt, entry.nextNotificationEnabled)}${entry.nextNotificationEnabled ? '' : ' · 仅记录，不推送'}` : multiple && entry.repeat.status === 'history' ? entry.repeatOutcome === 'skipped' ? '当天全部提醒已取消' : '当天完成记录；提醒安排请查看当前循环' : inactive ? `${repeatStatusLabel(entry)}，不再推送` : entry.completed
    ? "已完成，不再推送"
    : entry.notificationEnabled
      ? `推送 ${entry.leadDays ? `提前 ${entry.leadDays} 天 · ` : "当天 · "}${entry.repeat ? `${entry.repeat.time} 北京时间` : formatHour(entry.hour)}`
      : "仅记录，不推送";
  const completionAction = entry.repeat && (entry.completed || inactive || entry.recordedOutcome) ? "" : entry.completed
    ? `<button class="reminder-complete-button is-completed" data-action="restore" data-id="${escapeHtml(entry.id)}" type="button" aria-label="恢复事项 ${escapeHtml(entry.title)}">${getRestoreIcon()}</button>`
    : `<button class="reminder-complete-button" data-action="complete" data-id="${escapeHtml(entry.id)}" type="button" aria-label="${multiple ? '完成当天事项' : '标记事项'} ${escapeHtml(entry.title)}${multiple ? '' : ' 为已完成'}">${getCompleteIcon()}</button>`;
  const deleteAction = `<button class="reminder-delete-button" data-action="delete" data-id="${escapeHtml(entry.id)}" type="button" aria-label="删除事项 ${escapeHtml(entry.title)}">${getDeleteIcon()}</button>`;
  const itemActions = preview
    ? `<button class="button button--link" data-action="detail" data-id="${escapeHtml(entry.id)}" type="button">查看</button>`
    : `${historical ? "" : `<button class="button button--link" data-action="edit" data-id="${escapeHtml(entry.id)}" type="button">编辑</button>`}<button class="button button--link" data-action="export" data-id="${escapeHtml(entry.id)}" type="button">导出</button>`;

  return `
    <article class="reminder-item reminder-item--${tone}" data-reminder-detail="${escapeHtml(entry.id)}" data-occurrence="${escapeHtml(entry.repeat?.scheduledDate || '')}" data-slot="${escapeHtml(multiple ? entry.repeat.time : '')}">
      <div class="reminder-item__icon" aria-hidden="true">${getCategoryIcon(entry.category)}</div>
      <div class="reminder-item__body" role="button" tabindex="0" aria-label="查看事项 ${escapeHtml(entry.title)}">
        <div class="reminder-item__title-row">
          <span class="badge">${escapeHtml(entry.category)}</span>
          <h3 class="reminder-item__title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</h3>
          ${entry.repeat ? `<span class="repeat-badge">↻ 循环</span>` : ""}
        </div>
        <p class="reminder-item__meta">${due ? '<strong class="reminder-due-label">到点未完成 · </strong>' : ""}${escapeHtml(schedule)}</p>
        <p class="reminder-item__notification">${escapeHtml(notification)}</p>
        ${entry.repeat ? `<p class="reminder-item__repeat">${escapeHtml(repeatSummary(entry.repeat))}${entry.recordedOutcome ? multiple ? " · 当天已记录" : " · 本次已记录" : ""}</p>` : ""}
        ${entry.completed && !entry.repeat ? `<button class="button button--link" data-action="occurrence" data-id="${escapeHtml(entry.id)}" type="button">${entry.occurredOn ? "修改发生日期" : "补填发生日期"}</button>` : ""}
        ${entry.notes ? `<p class="reminder-item__notes">${escapeHtml(entry.notes)}</p>` : ""}
      </div>
      <div class="reminder-item__side">
        ${preview ? "" : `<div class="reminder-primary-actions">${completionAction}${deleteAction}</div>`}
        <strong class="countdown">${escapeHtml(inactive ? repeatStatusLabel(entry) : entry.completed ? "已完成" : formatCountdown(days))}</strong>
        <div class="reminder-item__actions">${itemActions}</div>
      </div>
    </article>
  `;
}

function renderInactiveReminderItem(entry) {
  const id = escapeHtml(entry.id), title = escapeHtml(entry.title);
  return `<article class="reminder-item reminder-item--inactive" data-reminder-detail="${id}" data-occurrence="">
    <div class="reminder-item__icon" aria-hidden="true">${getCategoryIcon(entry.category)}</div>
    <div class="reminder-item__body" role="button" tabindex="0" aria-label="查看已停用循环 ${title}">
      <div class="reminder-item__title-row"><span class="badge">${escapeHtml(entry.category)}</span><h3 class="reminder-item__title" title="${title}">${title}</h3><span class="repeat-badge">↻ 循环</span></div>
      <p class="reminder-item__meta">已停用，不再安排提醒</p>
      <p class="reminder-item__repeat">${escapeHtml(repeatSummary(entry.repeat))}</p>
      ${entry.notes ? `<p class="reminder-item__notes">${escapeHtml(entry.notes)}</p>` : ''}
    </div>
    <div class="reminder-item__side"><button class="reminder-delete-button" data-action="delete" data-id="${id}" type="button" aria-label="删除已停用循环 ${title}">${getDeleteIcon()}</button></div>
    <div class="repeat-inactive-actions">
      <button class="button button--secondary button--compact" data-action="edit" data-id="${id}" type="button">编辑</button>
      <button class="button button--primary button--compact" data-action="repeat-resume" data-id="${id}" type="button">重新启用</button>
    </div>
  </article>`;
}

function formatHour(hour) {
  return `${String(Number(hour) || 0).padStart(2, "0")}:00`;
}

export function reminderDaysUntil(entry, now = new Date()) {
  const date = !entry.completed && entry.nextReminderAt ? beijingDate(new Date(entry.nextReminderAt)) : entry.date;
  return entry.repeat ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${beijingDate(now)}T00:00:00Z`)) / 86400000) : getDaysUntil(entry.date, now);
}
function reminderMinutes(entry) {
  if (!entry.repeat) return Number(entry.hour) * 60;
  const [hour, minute] = entry.repeat.time.split(':').map(Number);
  return hour * 60 + minute;
}

function getSortedReminders(reminders) {
  return [...reminders].sort((left, right) => {
    if (left.completed !== right.completed) {
      return left.completed ? 1 : -1;
    }
    if (left.completed) {
      return String(right.completedAt || "").localeCompare(String(left.completedAt || ""));
    }
    const dueOrder = Number(isReminderDue(right)) - Number(isReminderDue(left));
    return dueOrder || (left.nextReminderAt && right.nextReminderAt ? left.nextReminderAt.localeCompare(right.nextReminderAt) : left.date.localeCompare(right.date)) || reminderMinutes(left) - reminderMinutes(right);
  });
}

export function applyFilter(reminders, filter) {
  if (filter === REMINDER_FILTERS.inactive) return reminders.filter(entry => isRepeatInactive(entry));
  if (filter === REMINDER_FILTERS.overdue) {
    return reminders.filter((entry) => !entry.completed && !isRepeatInactive(entry) && (!entry.repeat || entry.repeat.status === "active") && reminderDaysUntil(entry) < 0);
  }

  if (filter === REMINDER_FILTERS.completed) {
    return reminders.filter((entry) => entry.completed);
  }

  return reminders.filter((entry) => !entry.completed && !isRepeatInactive(entry));
}

function getEmptyReminderTitle(reminders, filter) {
  if (filter === REMINDER_FILTERS.inactive) return "还没有已停用循环";
  if (!reminders.length) return "还没有提醒";
  if (filter === REMINDER_FILTERS.completed) return "还没有已完成事项";
  if (filter === REMINDER_FILTERS.overdue) return "没有逾期事项";
  return "没有待处理事项";
}

function getCompleteIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`;
}

function getRestoreIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>`;
}

function getDeleteIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;
}

function getWeatherIconSvg(code, isDay = true) {
  if (code === null || code === undefined) {
    return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 32a8 8 0 1 1 0-16 7 7 0 0 1 13.5 2.5A6 6 0 1 1 34 32H14z"/></svg>`;
  }

  if ((code === 0 || code === 1) && !isDay) {
    return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M34 31.5A15 15 0 0 1 16.5 14 13 13 0 1 0 34 31.5Z"/><path d="M34 11v4M32 13h4"/></svg>`;
  }

  if (code === 0 || code === 1) {
    return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="24" cy="24" r="8"/><path d="M24 6v4M24 38v4M6 24h4M38 24h4M10.9 10.9l2.8 2.8M34.3 34.3l2.8 2.8M10.9 37.1l2.8-2.8M34.3 13.7l2.8-2.8"/></svg>`;
  }

  if (code <= 3) {
    return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 34a8 8 0 1 1 0-16 7 7 0 0 1 13.5 2.5A6 6 0 1 1 34 34H14z"/></svg>`;
  }

  if (code <= 48) {
    return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 30a8 8 0 1 1 0-16 7 7 0 0 1 13.5 2.5A6 6 0 1 1 34 30H14z"/><path d="M10 38h28M16 42h16"/></svg>`;
  }

  if (code <= 67 || (code >= 80 && code <= 82)) {
    return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 28a8 8 0 1 1 0-16 7 7 0 0 1 13.5 2.5A6 6 0 1 1 34 28H14z"/><path d="M22 32v10M30 32v10M18 36h16"/></svg>`;
  }

  if (code <= 77 || (code >= 85 && code <= 86)) {
    return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 28a8 8 0 1 1 0-16 7 7 0 0 1 13.5 2.5A6 6 0 1 1 34 28H14z"/><circle cx="20" cy="36" r="1.5" fill="currentColor"/><circle cx="28" cy="40" r="1.5" fill="currentColor"/><circle cx="36" cy="36" r="1.5" fill="currentColor"/></svg>`;
  }

  return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 28a8 8 0 1 1 0-16 7 7 0 0 1 13.5 2.5A6 6 0 1 1 34 28H14z"/><path d="M26 32l-4 8M30 32l4 8"/></svg>`;
}

function getCategoryIcon(category) {
  const icons = {
    账单: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>`,
    会员: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    证件: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 9h4M15 13h4"/></svg>`,
    合同: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>`,
    家庭: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`,
    其他: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`
  };

  return icons[category] || icons.其他;
}
