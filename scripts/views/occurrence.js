import { formatLocalDateInput } from "../utils/date.js";
import { isOccurrenceDate } from "../utils/occurrence.js";
import { beijingDate, validRepeatDate } from "../utils/repeat.js";

export function requestOccurrenceDate(reminder) {
  const dialog = document.querySelector("#occurrenceDialog");
  if (dialog.open) return Promise.resolve(null);
  const form = dialog.querySelector("form");
  const input = dialog.querySelector("input");
  const error = dialog.querySelector("[role=status]");
  document.querySelector("#occurrenceTitle").textContent = reminder.title;
  document.querySelector("#occurrenceSubmit").textContent = reminder.completed ? "保存日期" : "确认完成";
  input.max = reminder.repeat ? beijingDate() : formatLocalDateInput(new Date());
  input.value = reminder.occurredOn || input.max;
  error.textContent = "";
  return new Promise(resolve => {
    let result = null;
    const submit = event => {
      event.preventDefault();
      const valid = reminder.repeat ? validRepeatDate(input.value) && input.value <= beijingDate() : isOccurrenceDate(input.value);
      if (!valid) { error.textContent = "请选择今天或之前的有效日期。"; return; }
      result = input.value;
      dialog.close();
    };
    const close = () => {
      form.removeEventListener("submit", submit);
      resolve(result);
    };
    form.addEventListener("submit", submit);
    dialog.addEventListener("close", close, { once: true });
    document.querySelector("#occurrenceCancel").onclick = () => dialog.close();
    dialog.showModal();
  });
}
