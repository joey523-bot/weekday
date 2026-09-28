import { chinaInput, defaultSnoozeCutoff } from '../utils/snooze.js';
async function request(id, body) {
  const response = await fetch(`/api/push/snooze?id=${encodeURIComponent(id)}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? {body: JSON.stringify({id, ...body})} : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '稍后提醒暂时不可用');
  return data;
}
export function bindSnoozePanel(dialog, flush) {
  const panel = dialog.querySelector('#snoozePanel');
  const status = dialog.querySelector('#snoozeStatus');
  const stop = dialog.querySelector('#snoozeStop');
  const until = dialog.querySelector('#snoozeUntil');
  const custom = dialog.querySelector('#snoozeAt');
  let current = null, version = 0, busy = false;
  const format = stamp => chinaInput(new Date(stamp)).replace('T',' ');
  function display(rule) {
    stop.hidden = !rule;
    status.textContent = !rule ? '尚未设置稍后提醒' : rule.mode === 'hourly'
      ? `每小时提醒 · ${rule.nextAt ? `下次 ${format(rule.nextAt)}` : '本轮结束后无下一次'} · 截止 ${format(rule.untilAt)}`
      : rule.attempted ? '本次稍后提醒已尝试发送，可重新设置' : `稍后提醒：${format(rule.nextAt)}`;
    stop.textContent = rule?.mode === 'hourly' ? '停止循环' : '取消稍后提醒';
  }
  async function refresh(id, v) {
    try { const data = await request(id); if (version === v) display(data.rule); }
    catch (error) { if (version === v) status.textContent = error.message; }
  }
  panel.addEventListener('click', async event => {
    const button = event.target.closest('button[data-snooze]');
    if (!button || !current || busy) return;
    const id = current, v = version;
    let payload;
    if (button.dataset.snooze === 'stop') payload = {action:'stop'};
    else if (button.dataset.snooze === 'hourly') payload = {mode:'hourly', until:until.value};
    else if (button.dataset.snooze === 'custom') payload = {mode:'once', at:custom.value};
    else payload = {mode:'once', minutes:Number(button.dataset.snooze)};
    busy = true;
    panel.querySelectorAll('button').forEach(b => b.disabled = true);
    status.textContent = '正在保存…';
    try {
      await flush();
      await request(id, payload);
      if (version === v) await refresh(id, v);
    } catch (error) { if (version === v) status.textContent = `未保存：${error.message}`; }
    finally { if (version === v) { busy = false; panel.querySelectorAll('button').forEach(b => b.disabled = false); } }
  });
  return function show(reminder) {
    const v = ++version;
    current = reminder?.completed ? null : reminder?.id;
    busy = false;
    panel.querySelectorAll('button').forEach(b => b.disabled = false);
    panel.hidden = !current;
    panel.querySelector('details').open = false;
    stop.hidden = true;
    until.value = defaultSnoozeCutoff();
    custom.value = chinaInput(new Date(Date.now()+3600000));
    custom.min = chinaInput(); until.min = chinaInput();
    status.textContent = '正在读取稍后提醒…';
    if (current) refresh(current, v);
  };
}
