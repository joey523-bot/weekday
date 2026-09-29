import { APP_THEMES } from "../config.js";

export function createShell() {
  return `
    <div class="page-noise"></div>

    <div class="app-shell">
      <header class="app-header">
        <div class="brand-lockup">
          <button class="brand" data-switch-view="overview" type="button" aria-label="返回星期首页">
            <span class="brand__mark" aria-hidden="true"><img src="./assets/icons/app-icon-star-192.png?v=20260928.2" alt="" width="38" height="38" /></span>
            <span>星期</span>
          </button>
          <p id="todayLabel">--</p>
        </div>
        <button class="icon-button" data-switch-view="compose" type="button" aria-label="新增事项">
          ${iconPlus()}
        </button>
      </header>

      <main class="workspace">
        <section class="view view--overview is-active" data-view="overview">
          <header class="overview-intro sr-only">
            <p id="overviewMonth">--</p>
            <h1>今日生活概览</h1>
          </header>

          <div class="overview-stack">
            <article class="salary-snapshot">
              <div class="salary-snapshot__header">
                <div>
                  <p class="salary-snapshot__eyebrow">距离下次发薪</p>
                  <p id="salaryStatus">--</p>
                </div>
              </div>
              <div class="salary-snapshot__main">
                <div class="salary-snapshot__countdown">
                  <strong id="salaryCountdown">--</strong><span id="salaryCountdownUnit">天</span>
                </div>
                <div class="salary-snapshot__calendar" aria-hidden="true">${iconCalendar()}</div>
                <span class="salary-snapshot__date" id="salaryDate">--</span>
              </div>
              <div class="salary-snapshot__details">
                <div><span>收入</span><strong id="salaryAmountDisplay">--</strong></div>
                <div><span>到账账户</span><strong id="salaryAccountDisplay">--</strong></div>
              </div>
            </article>

            <article class="notification-nudge" id="pushNudge" hidden>
              <span class="notification-nudge__icon" aria-hidden="true">${iconBell()}</span>
              <div>
                <strong id="pushNudgeTitle">通知尚未准备好</strong>
                <p id="pushNudgeText">开启后，带有通知的事项才会准时推送。</p>
              </div>
              <button class="button button--secondary button--compact" data-switch-view="settings" type="button">去开启</button>
            </article>

            <section id="cycleSuggestions" aria-label="周期建议" hidden></section>
            <p id="cycleFeedback" class="form-note" role="status" hidden></p>
            <article class="journal-card reminders-card" id="board">
              <div class="section-head">
                <div>
                  <h2 class="section-title">临近事项</h2>
                  <p id="reminderSummaryMeta" class="section-head__meta">暂时没有待办</p>
                </div>
                <div class="section-head__actions">
                  <span id="overviewReminderCount" class="soft-chip">0 条</span>
                  <button class="button button--secondary button--compact reminder-create-button" data-switch-view="compose" type="button">${iconPlus()}<span>新建</span></button>
                  <button class="section-arrow" data-switch-view="reminders" type="button" aria-label="查看全部事项">${iconChevron()}</button>
                </div>
              </div>
              <span id="reminderSummaryValue" class="sr-only">0</span>
              <div id="overviewReminderList" class="reminder-list"></div>
            </article>

            <article class="xm-weather-card" aria-labelledby="overviewWeatherTitle">
              <div class="xm-weather-card__head">
                <h2 id="overviewWeatherTitle">天气</h2>
                <button class="xm-weather-card__location" data-switch-view="weather" type="button">查看详情 ${iconLocation()}</button>
              </div>
              <div class="xm-weather-card__slot" data-weather-slot></div>
            </article>
          </div>
        </section>

        <dialog id="occurrenceDialog" class="reminder-detail" aria-labelledby="occurrenceHeading">
          <form class="stack-form">
            <h2 id="occurrenceHeading">确认实际发生日期</h2>
            <p id="occurrenceTitle" class="reminder-detail__notes"></p>
            <label for="occurrenceDate">这件事是哪天做的？</label>
            <input id="occurrenceDate" class="input" type="date" required autofocus />
            <p class="form-note">补记时可以选择过去的日期。原计划日期保持不变。</p>
            <p role="status" class="form-note" aria-live="polite"></p>
            <button id="occurrenceSubmit" type="submit" class="button button--primary">确认完成</button>
            <button id="occurrenceCancel" type="button" class="button button--secondary">取消</button>
          </form>
        </dialog>
        <dialog id="reminderDetail" class="reminder-detail" aria-labelledby="reminderDetailTitle">
          <button id="reminderDetailClose" class="reminder-detail__close" type="button" aria-label="关闭" title="关闭"><span aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></span></button>
          <div class="stack-form">
            <h2 id="reminderDetailTitle" tabindex="-1" autofocus></h2>
            <p id="reminderDetailMeta" class="form-note"></p>
            <p id="reminderDetailOccurrence" class="form-note"></p>
            <button id="reminderDetailOccurrenceEdit" class="button button--link" type="button" hidden>补填实际发生日期</button>
            <p id="reminderDetailNotes" class="reminder-detail__notes"></p>
            <p id="reminderDetailState" class="form-note" aria-live="polite"></p>
            <button id="reminderDetailComplete" class="button button--primary" type="button">完成事项</button>
            <button id="reminderDetailEdit" class="button button--secondary" type="button">编辑事项</button>
            <section id="snoozePanel" class="snooze-panel" aria-label="稍后提醒">
              <p id="snoozeStatus" class="form-note" aria-live="polite"></p>
              <details>
                <summary>稍后提醒</summary>
                <div class="snooze-options">
                  <div class="snooze-presets">
                    <button type="button" class="button button--secondary" data-snooze="10">10分钟后</button>
                    <button type="button" class="button button--secondary" data-snooze="30">30分钟后</button>
                    <button type="button" class="button button--secondary" data-snooze="60">1小时后</button>
                  </div>
                  <label for="snoozeAt">自选日期时间（北京时间）</label>
                  <input id="snoozeAt" class="input" type="datetime-local" />
                  <button type="button" class="button button--secondary" data-snooze="custom">按所选时间提醒一次</button>
                  <label for="snoozeUntil">每小时提醒，截止到（北京时间）</label>
                  <input id="snoozeUntil" class="input" type="datetime-local" />
                  <button type="button" class="button button--secondary" data-snooze="hourly">开启每小时提醒</button>
                  <p class="form-note">首次在1小时后提醒。默认截止今天22点；22点后请自选截止时间。完成事项或停止循环后不再补提醒。到点后可能延迟几分钟送达。</p>
                </div>
              </details>
              <button id="snoozeStop" class="button button--link" type="button" data-snooze="stop" hidden>停止循环</button>
            </section>
          </div>
        </dialog>

        <section class="view view--reminders" data-view="reminders" hidden>
          <header class="page-intro">
            <div class="section-kicker"><span>事项</span><span class="section-kicker__line"></span></div>
            <h1>事项清单</h1>
            <p>查看待处理、已逾期和已完成的所有事项。</p>
          </header>
          <article class="journal-card reminders-card reminders-card--all" id="reminderBoard">
            <div class="section-head">
              <div>
                <h2 class="section-title">全部事项</h2>
                <p id="reminderBoardMeta" class="section-head__meta">把要做的事都放在这里</p>
              </div>
              <div class="section-head__actions">
                <span id="reminderCount" class="soft-chip">0 条</span>
                <button class="button button--primary button--compact reminder-create-button" data-switch-view="compose" type="button">${iconPlus()}<span>新建</span></button>
              </div>
            </div>
            <div class="filters" role="tablist" aria-label="事项筛选">
              <button class="filter is-active" data-filter="all" type="button">待处理</button>
              <button class="filter" data-filter="overdue" type="button">已逾期</button>
              <button class="filter" data-filter="completed" type="button">已完成</button>
            </div>
            <p id="reminderBoardState" class="form-note reminder-board-state" aria-live="polite"></p>
            <div id="reminderList" class="reminder-list"></div>
          </article>
        </section>

        <section class="view view--compose" data-view="compose" hidden>
          <header class="page-intro">
            <div class="section-kicker"><span>事项</span><span class="section-kicker__line"></span></div>
            <h1 id="reminderFormHeading">新建事项</h1>
            <p id="reminderFormDescription">记下日期和提醒时刻，到点让小星轻轻提醒你。</p>
          </header>
          <article class="journal-card graph-paper form-card">
            <form id="reminderForm" class="stack-form">
              <label class="field">
                <span class="field__label">事情</span>
                <input id="reminderTitleInput" name="title" class="input" type="text" placeholder="例如：手机套餐续费" role="combobox" aria-autocomplete="list" aria-controls="reminderSuggestions" aria-expanded="false" maxlength="80" required />
              </label>
              <div id="reminderSuggestions" class="reminder-suggestions" role="listbox" aria-label="历史事项快捷建议" hidden></div>
              <div class="split-grid">
                <label class="field">
                  <span class="field__label">事项日期</span>
                  <span class="date-input-shell">
                    <span id="reminderDateDisplay" class="date-input-shell__value" data-empty="true">选择日期</span>
                    <span class="date-input-shell__icon" aria-hidden="true">${iconCalendar()}</span>
                    <input id="reminderDateInput" name="date" class="date-input-shell__native" type="date" aria-label="事项日期" aria-describedby="reminderDateNotice" required />
                  </span>
                  <span id="reminderDateNotice" role="status"></span>
                </label>
                <label class="field">
                  <span class="field__label">分类</span>
                  <select id="reminderCategoryInput" name="category" class="select">
                    <option value="带东西">带东西</option><option value="买东西">买东西</option>
                    <option value="售后">售后</option><option value="其他">其他</option>
                  </select>
                </label>
              </div>
              <button id="addCategoryButton" class="button button--ghost" type="button" aria-expanded="false" aria-controls="newCategoryPanel">新增分类</button>
              <div id="newCategoryPanel" hidden>
                <label class="field"><span class="field__label">新分类名称</span><input id="newCategoryInput" class="input" placeholder="例如：运动" /></label>
                <button id="saveCategoryButton" class="button" type="button">保存分类</button>
                <button id="cancelCategoryButton" class="button button--ghost" type="button">取消</button>
              </div>
              <p id="categoryState" role="status"></p>
              <fieldset class="reminder-timing">
                <legend>提醒安排</legend>
                <label class="reminder-switch">
                  <input id="reminderNotificationInput" type="checkbox" checked />
                  <span class="reminder-switch__control" aria-hidden="true"></span>
                  <span><strong>推送提醒</strong><small>需要先在设置中允许通知</small></span>
                </label>
                <div class="split-grid">
                  <label class="field">
                    <span class="field__label">提醒日期</span>
                    <select id="reminderLeadDaysInput" name="leadDays" class="select">${leadDayOptions()}</select>
                  </label>
                  <label class="field">
                    <span class="field__label">推送时刻</span>
                    <select id="reminderHourSelect" name="reminderHour" class="select">${hourOptions()}</select>
                  </label>
                </div>
                <p class="timing-hint">“当天”表示在事项日期当天提醒；若定时任务延迟，会在该小时内自动补发一次。</p>
              </fieldset>
              <label class="field">
                <span class="field__label">备注</span>
                <textarea id="reminderNotesInput" name="notes" class="textarea" placeholder="金额、联系人、续费规则..." maxlength="300"></textarea>
              </label>
              <button id="reminderSubmitButton" class="button button--primary button--block" type="submit">保存事项</button>
              <p id="reminderSaveState" class="form-note" aria-live="polite"></p>
            </form>
          </article>
        </section>

        <section class="view view--weather" data-view="weather" hidden>
          <header class="page-intro">
            <div class="section-kicker"><span>当前位置</span><span class="section-kicker__line"></span></div>
            <h1>天气</h1>
            <p>查看实况、降雨概率和生活建议，轻点即可更新。</p>
          </header>
          <article class="journal-card graph-paper weather-page-card">
            <div class="weather-page-card__slot" data-weather-slot></div>
            <p class="weather-privacy">位置仅用于查询天气和城市名，不会保存在应用内。</p>
          </article>
        </section>

        <section class="view view--settings" data-view="settings" hidden>
          <header class="page-intro">
            <div class="section-kicker"><span>个人设置</span><span class="section-kicker__line"></span></div>
            <h1>我的</h1>
            <p>管理发薪规则、通知，以及数据保存方式。</p>
          </header>

          <section class="settings-grid">
            <article class="journal-card cycle-settings-card">
              <h2 class="section-title">周期建议</h2>
              <p class="form-note">根据你确认的实际发生日期，在规律稳定时建议下一次。首页保留建议；开启推送后会主动问你是否安排，不自动创建事项。</p>
              <label><input id="cycleEnabled" type="checkbox" /> 开启周期建议</label>
              <label><input id="cyclePushEnabled" type="checkbox" /> 周期建议推送</label>
              <p class="form-note">默认关闭。开启后约每5分钟检查，满足条件就尽快推送；每台已开启通知的设备，同一轮最多一次。</p>
              <details id="cycleSettings"><summary>管理同类事项与学习记录</summary>
                <div id="cycleControls" class="stack-form"></div>
              </details>
              <p id="cycleSettingsState" class="form-note" role="status"></p>
            </article>
            <article class="journal-card appearance-card" aria-labelledby="appearanceTitle">
              <div class="card-heading">
                <div>
                  <h2 id="appearanceTitle">外观与主题</h2>
                  <p>一键换肤，选择会自动保存在这台设备。</p>
                </div>
                <span id="themeStatusBadge" class="soft-chip">默认绿</span>
              </div>
              <div class="theme-picker" role="group" aria-label="选择应用主题">
                ${Object.entries(APP_THEMES).map(([id, theme]) => themeOption(id, theme)).join("")}
              </div>
              <input id="customThemeImageInput" class="sr-only" type="file" accept="image/*" aria-label="从相册选择主题照片" />
              <button id="customThemeCreateButton" class="button button--primary button--block appearance-card__create" type="button">新增照片主题</button>
              <div id="customThemeGallery" class="custom-theme-library" aria-label="照片主题库" hidden></div>
              <button id="customThemeDeleteCurrentButton" class="button button--danger button--block appearance-card__delete-current" type="button" hidden>删除当前照片主题</button>
              <p id="customThemeState" class="appearance-card__note" aria-live="polite">照片仅保存在当前设备，不会上传或同步到云端。</p>
            </article>

            <article class="journal-card graph-paper form-card">
              <div class="card-heading"><div><h2>发薪设置</h2><p>修改后会立即保存在本机</p></div></div>
              <form id="salaryForm" class="stack-form">
                <label class="field"><span class="field__label">发薪日</span><select id="salaryDaySelect" name="salaryDay" class="select"></select></label>
                <div class="split-grid">
                  <label class="field"><span class="field__label">收入</span><input id="salaryAmountInput" name="salaryAmount" class="input" type="text" placeholder="15,000 元" autocomplete="off" /></label>
                  <label class="field"><span class="field__label">账户</span><input id="salaryAccountInput" name="salaryAccount" class="input" type="text" placeholder="工资卡" autocomplete="off" /></label>
                </div>
                <button class="button button--primary button--block" type="submit">保存发薪设置</button>
                <p class="form-note">设置会自动同步到当前账号；“刷新应用资源”不会删除它。</p>
              </form>
            </article>

            <article class="journal-card graph-paper form-card">
              <div class="card-heading"><div><h2>通知设置</h2><p id="pushSupportNote">开启一次后，工资和自定义事项都会使用此通知权限。</p></div><span id="pushStatusBadge" class="soft-chip">未开启</span></div>
              <div class="settings-list">
                <label class="settings-list__row"><span class="settings-list__label">提前天数</span><input id="pushLeadDaysInput" name="pushLeadDays" class="input settings-list__input" type="number" min="0" max="7" value="0" /></label>
                <label class="settings-list__row"><span class="settings-list__label">工资推送时刻</span><select id="pushHourSelect" name="pushHour" class="select settings-list__input">${hourOptions()}</select></label>
                <label class="settings-list__row"><span class="settings-list__label">工作日10:00发薪倒计时</span><input id="dailyCountdownInput" type="checkbox" aria-describedby="dailyCountdownNote" /></label>
                <div class="settings-list__row"><span class="settings-list__label">权限</span><span id="pushPermissionLabel">未请求</span></div>
              </div>
              <div class="notification-panel__actions">
                <button id="pushEnableButton" class="button button--primary" type="button">开启通知并同步</button>
                <button id="pushTestButton" class="button button--secondary" type="button">测试通知</button>
                <button id="pushDisableButton" class="button button--secondary" type="button">关闭所有提醒</button>
              </div>
              <p id="dailyCountdownNote" class="form-note">默认关闭，仅本设备生效。开启后按北京时间在实际工作日10:00提醒，含调休；不影响原工资和事项提醒。未开启通知时，请先开启通知并同步。</p>
              <p id="pushSyncState" class="form-note">--</p>
            </article>

            <article class="journal-card graph-paper form-card cloud-backup-card">
              <div class="card-heading">
                <div>
                  <h2>账号与同步</h2>
                  <p>登录后，工资设置和事项会自动同步到你的其他设备。</p>
                </div>
                <span id="accountStatusBadge" class="soft-chip">已登录</span>
              </div>
              <p id="accountUsername" class="form-note">--</p>
              <form id="changePasswordForm" class="stack-form">
                <label class="field">
                  <span class="field__label">当前密码</span>
                  <input id="currentPasswordInput" class="input" type="password" autocomplete="current-password" required />
                </label>
                <label class="field">
                  <span class="field__label">新密码</span>
                  <input id="newPasswordInput" class="input" type="password" autocomplete="new-password" required />
                </label>
                <label class="field">
                  <span class="field__label">确认新密码</span>
                  <input id="newPasswordConfirmInput" class="input" type="password" autocomplete="new-password" required />
                </label>
                <button class="button button--secondary" type="submit">修改密码</button>
                <p id="changePasswordState" class="form-note" aria-live="polite">密码不支持找回，请妥善保管。</p>
              </form>
              <button id="logoutButton" class="button button--danger button--block" type="button">退出登录并清除此设备数据</button>
            </article>

            <article class="data-note">
              <span class="data-note__icon">${iconDatabase()}</span>
              <div>
                <h2>刷新应用资源不会删除设置</h2>
                <p>这里仅刷新页面代码和图片缓存，不会退出登录或关闭提醒。Safari 的“清除网站数据”会清除登录状态。</p>
                <div class="maintenance-actions">
                  <button id="clearAppCacheButton" class="button button--secondary" type="button">刷新应用资源</button>
                  <span id="appMaintenanceState" class="form-note">遇到页面异常时使用；不会关闭提醒。</span>
                </div>
              </div>
            </article>
          </section>
        </section>
      </main>

      <nav class="bottom-tabs" aria-label="主导航">
        <button class="bottom-tabs__item is-active" data-switch-view="overview" data-tab-button type="button" aria-current="page">${iconHome()}<span>首页</span></button>
        <button class="bottom-tabs__item" data-switch-view="reminders" data-tab-button type="button">${iconChecklist()}<span>事项</span></button>
        <button class="bottom-tabs__item" data-switch-view="weather" data-tab-button type="button">${iconWeather()}<span>天气</span></button>
        <button class="bottom-tabs__item" data-switch-view="settings" data-tab-button type="button">${iconUser()}<span>我的</span></button>
      </nav>
    </div>
  `;
}

export function createAuthShell() {
  return `
    <div class="page-noise"></div>
    <main class="auth-screen" aria-labelledby="authTitle">
      <section class="auth-screen__intro">
        <div class="auth-brand"><span class="auth-brand__mark"><img src="./assets/icons/app-icon-star-192.png?v=20260928.2" alt="" width="42" height="42" /></span><span>星期</span></div>
        <p class="auth-screen__eyebrow">使用前请先登录</p>
        <h1 id="authTitle">先登录，<br /><em>再开启星期。</em></h1>
        <p class="auth-screen__lead">记录发薪日、重要事项和提醒；登录后自动同步到你的其他设备。</p>
        <ol class="auth-route" aria-label="账号同步流程">
          <li><span>01</span><div><strong>输入手机号</strong><small>系统自动判断你的账号状态</small></div></li>
          <li><span>02</span><div><strong>开始记录</strong><small>新账号设置昵称后即可使用</small></div></li>
          <li><span>03</span><div><strong>自动同步</strong><small>打开应用会持续保持登录</small></div></li>
        </ol>
      </section>
      <section class="auth-card" aria-label="账号登录与注册">
        <div class="auth-card__head"><p>开启星期</p><h2>输入手机号</h2></div>
        <form id="accountStartForm" class="stack-form auth-form">
          <p class="auth-form__hint">输入手机号后，我们会自动带你进入登录或创建账号流程。</p>
          <label class="field"><span class="field__label">手机号</span><input id="accountPhoneInput" class="input" type="tel" inputmode="numeric" autocomplete="tel" maxlength="11" placeholder="请输入 11 位手机号" required /></label>
          <button class="button button--primary button--block" type="submit">继续</button>
          <p id="accountStartState" class="form-note" aria-live="polite">不会发送验证码，仅用于识别你的星期账号。</p>
        </form>
        <form id="loginForm" class="stack-form auth-form" hidden>
          <button class="auth-back" data-auth-back type="button">‹ 更换手机号</button>
          <p class="auth-form__hint">账号已存在，输入密码继续。</p>
          <p class="auth-phone" data-account-phone>--</p>
          <label class="field"><span class="field__label">密码</span><input id="loginPassword" class="input" type="password" autocomplete="current-password" required /></label>
          <button class="button button--primary button--block" type="submit">进入星期</button>
          <p id="loginState" class="form-note" aria-live="polite">密码暂不支持找回。</p>
        </form>
        <form id="accountSetupForm" class="stack-form auth-form" hidden>
          <button class="auth-back" data-auth-back type="button">‹ 更换手机号</button>
          <p class="auth-form__hint">这是第一次使用星期。填写一个自己喜欢的称呼，就可以开始记录。</p>
          <p class="auth-phone" data-account-phone>--</p>
          <label class="field"><span class="field__label">怎么称呼你</span><input id="nicknameInput" class="input" type="text" maxlength="20" autocomplete="nickname" required /></label>
          <label class="field"><span class="field__label">设置密码</span><input id="setupPassword" class="input" type="password" autocomplete="new-password" required /></label>
          <label class="field"><span class="field__label">确认密码</span><input id="setupPasswordConfirm" class="input" type="password" autocomplete="new-password" required /></label>
          <button class="button button--primary button--block" type="submit">创建账号并开启星期</button>
          <p id="setupState" class="form-note" aria-live="polite">密码暂不支持找回，请自行保存。</p>
        </form>
      </section>
    </main>
  `;
}

function hourOptions() {
  return Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, "0");
    const selected = hour === 9 ? " selected" : "";
    return `<option value="${hour}"${selected}>${value}:00</option>`;
  }).join("");
}

function leadDayOptions() {
  return Array.from({ length: 31 }, (_, day) => {
    const label = day === 0 ? "当天" : `提前 ${day} 天`;
    return `<option value="${day}">${label}</option>`;
  }).join("");
}

function themeOption(id, theme) {
  const artworkStyle = theme.artwork ? ` style="--theme-preview-image: url('${theme.artwork}')"` : "";
  return `
    <button class="theme-option theme-option--${id}${theme.artwork ? " theme-option--artwork" : ""}" data-theme-option="${id}" type="button" aria-pressed="false">
      <span class="theme-option__preview"${artworkStyle} aria-hidden="true"></span>
      <span class="theme-option__copy"><strong>${theme.label}</strong><small>${theme.description}</small></span>
      <span class="theme-option__tag">${theme.tag}</span>
    </button>
  `;
}

function iconCalendar() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h6"/></svg>`;
}
function iconChevron() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
}
function iconLocation() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
}
function iconBell() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 22h4"/></svg>`;
}
function iconWeather() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 17.5a4 4 0 1 1 .4-8A5.5 5.5 0 0 1 18 11a3.3 3.3 0 1 1-.5 6.5H7Z"/><path d="M9 21l1-1.5M14 21l1-1.5"/></svg>`;
}
function iconDatabase() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>`;
}
function iconHome() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z"/></svg>`;
}
function iconPlus() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
}
function iconChecklist() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11l1.5 1.5L14 9M9 16h6"/></svg>`;
}
function iconUser() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.1 3.5-6 8-6s7.2 1.9 8 6"/></svg>`;
}
