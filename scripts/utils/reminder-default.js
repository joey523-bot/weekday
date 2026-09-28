import { formatLocalDateInput } from "./date.js";

// Each form session owns its defaults; explicit hours and edits are never replaced.
export function createReminderTimeDefault() {
  let manual = false;
  let lastDate = "";
  return {
    reset() { manual = false; lastDate = ""; },
    markManual() { manual = true; },
    apply(refs, editing = false, now = new Date()) {
      const date = refs.reminderDateInput.value;
      if (editing || date === lastDate) return;
      lastDate = date;
      refs.reminderDateNotice.textContent = "";
      if (manual) return;
      let hour = 9;
      if (date === formatLocalDateInput(now)) {
        const next = new Date(now);
        next.setHours(now.getHours() + 1, 0, 0, 0);
        hour = next.getHours();
        const nextDate = formatLocalDateInput(next);
        if (nextDate !== date) {
          refs.reminderDateInput.value = nextDate;
          lastDate = nextDate;
          refs.reminderDateNotice.textContent = `今天已无下一整点，已自动改为次日（${nextDate}）00:00，可手动修改。`;
        }
      }
      refs.reminderHourSelect.value = String(hour);
    }
  };
}
