import { cycleSuggestions, cycleGroups, normalizeCycle, mergeCycleGroups } from "../utils/cycle.js";
import { escapeHtml as esc } from "../utils/format.js";
import { formatDateLong } from "../utils/date.js";

export function bindCycleUI({ getState, save, sync, compose, ready, enablePush }) {
  const panel = document.querySelector("#cycleSuggestions"), controls = document.querySelector("#cycleControls");
  const enabled = document.querySelector("#cycleEnabled"), status = document.querySelector("#cycleSettingsState");
  const pushToggle = document.querySelector("#cyclePushEnabled");
  const prefs = () => normalizeCycle(getState().preferences.cycle);
  let current = [], groups = [];
  let pushBusy = false, pushDesired = false;
  const renderSuggestions = () => {
    current = ready() ? cycleSuggestions(getState().reminders, prefs()) : [];
    panel.hidden = !current.length;
    panel.innerHTML = current.map((item,i) => `<article class="journal-card cycle-card">
      <h2 class="section-title">要再安排一次“${esc(item.title)}”吗？</h2>
      <p>依据最近${item.dates.length}个发生日，间隔约${item.median}天，预计${esc(formatDateLong(item.expected))}。</p>
      <details><summary>查看依据</summary><p>实际发生日：${esc(item.dates.join("、"))}</p><p>相邻间隔：${esc(item.gaps.join("、"))}天。日期是估计，你可以调整。</p></details>
      <div class="cycle-actions"><button type="button" class="button button--primary" data-cycle-action="accept" data-index="${i}">安排提醒</button>
      <button type="button" class="button button--secondary" data-cycle-action="ignore" data-index="${i}">本次忽略</button>
      <button type="button" class="button button--link" data-cycle-action="disable" data-index="${i}">不再建议这类事项</button></div>
    </article>`).join("");
  };
  const render = () => {
    renderSuggestions(); enabled.checked = prefs().enabled; enabled.disabled = !ready();
    pushToggle.checked = pushBusy ? pushDesired : prefs().pushEnabled; pushToggle.disabled = pushBusy || !ready();
    if (!ready()) { controls.innerHTML = '<p>加载账号记录后可管理。</p>'; return; }
    const state = getState(); groups = cycleGroups(state.reminders, prefs());
    const titles = [...new Set(state.reminders.map(item => item.title))].sort();
    const options = titles.map(title => `<option value="${esc(title)}">${esc(title)}</option>`).join("");
    controls.innerHTML = `<p class="form-note">相同标题默认同类。只有确认是同一件事，才合并不同名称；分类相同不会自动合并。</p>
      <label>第一个名称<select class="select" id="cycleFirst"><option value="">请选择</option>${options}</select></label>
      <label>第二个名称<select class="select" id="cycleSecond"><option value="">请选择</option>${options}</select></label>
      <button type="button" class="button button--secondary" data-cycle-setting="merge">确认合并为同类</button>
      <div>${groups.map((group,i) => `<div class="cycle-group"><span>${esc(group.titles.join(" / "))}</span>
        <button type="button" class="button button--link" data-cycle-setting="toggle" data-index="${i}">${group.disabled ? "恢复建议" : "关闭这类建议"}</button>
        ${group.titles.length > 1 ? `<button type="button" class="button button--link" data-cycle-setting="split" data-index="${i}">取消合并</button>` : ""}</div>`).join("")}</div>
      <details><summary>排除测试或不用于学习的事项</summary><p class="form-note">勾选的记录不会用于周期计算，原事项保留。</p>
        ${state.reminders.map(item => `<label class="cycle-exclusion"><input type="checkbox" data-cycle-exclude="${esc(item.id)}" ${prefs().excludedIds.includes(item.id) ? "checked" : ""}/> ${esc(item.title)} · ${esc(item.occurredOn || item.date || "未定日期")}</label>`).join("") || "暂无事项"}</details>
      <button type="button" class="button button--secondary" data-cycle-setting="clear">清除学习结果</button>
      <p class="form-note">清除后保留全部事项；现有记录不再用于学习，从此后新建并确认发生的事项重新积累。</p>`;
  };
  const persist = async (value, fromCard = false) => {
    const feedback = document.querySelector("#cycleFeedback");
    const message = text => { status.textContent = text; if (fromCard) { feedback.hidden = false; feedback.textContent = text; } };
    try {
      save(value); render(); message("正在保存…");
      await sync(); message("周期建议设置已保存。");
    } catch(error) { message(`尚未同步，请联网后重试：${error.message}`); }
  };
  pushToggle.addEventListener("change", async () => {
    const turnOn = pushToggle.checked;
    pushBusy = true; pushDesired = turnOn; pushToggle.disabled = true;
    try {
      if (turnOn && !await enablePush()) { render(); status.textContent = "尚未开启周期推送，请先允许当前设备的通知。"; return; }
      await persist({ ...prefs(), pushEnabled: turnOn });
    } finally { pushBusy = false; render(); }
  });
  enabled.addEventListener("change", () => persist({ ...prefs(), enabled: enabled.checked }));
  panel.addEventListener("click", async event => {
    const button = event.target.closest("[data-cycle-action]"); if (!button) return;
    const item = current[Number(button.dataset.index)]; if (!item) return;
    // Recheck time, pending items, and feedback before acting on a visible card.
    const fresh = cycleSuggestions(getState().reminders, prefs()).find(candidate => candidate.id === item.id);
    if (!fresh) { render(); return; }
    if (button.dataset.cycleAction === "accept") { compose(fresh); return; }
    if (button.dataset.cycleAction === "ignore") await persist({ ...prefs(), handledTokens: [...prefs().handledTokens,...fresh.tokens] }, true);
    else await persist({ ...prefs(), groups: cycleGroups(getState().reminders,prefs()).map(group => group.id === fresh.id ? {...group,disabled:true} : group) }, true);
  });
  controls.addEventListener("click", async event => {
    const button = event.target.closest("[data-cycle-setting]"); if (!button) return;
    const action = button.dataset.cycleSetting, p = prefs();
    if (action === "merge") {
      try { await persist(mergeCycleGroups(getState().reminders, p, document.querySelector("#cycleFirst").value, document.querySelector("#cycleSecond").value)); }
      catch(error) { status.textContent = error.message; }
    } else if (action === "clear") {
      if (!window.confirm("清除同类分组和学习结果？现有事项会保留，但不再用于周期学习。")) return;
      await persist({ enabled: p.enabled, pushEnabled: p.pushEnabled, clearedIds: [...p.clearedIds,...getState().reminders.map(item=>item.id)] });
    } else {
      const group = groups[Number(button.dataset.index)]; if (!group) return;
      await persist({ ...p, groups: action === "split" ? groups.filter(item=>item.id !== group.id).concat(group.titles.map(title=>({id:`title:${title}`,titles:[title],disabled:group.disabled}))) : groups.map(item=>item.id === group.id ? {...item,disabled:!item.disabled}:item) });
    }
  });
  controls.addEventListener("change", event => {
    const id = event.target.dataset.cycleExclude; if (!id) return;
    const p=prefs(); persist({...p,excludedIds:event.target.checked ? [...p.excludedIds,id] : p.excludedIds.filter(value=>value!==id)});
  });
  return { render, renderSuggestions, openSuggestion: compose };
}
