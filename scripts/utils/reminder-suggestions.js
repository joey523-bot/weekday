// Count saved occurrences, not clicks or edits; never persist a second history.
export function rankReminderTitles(reminders = [], query = "") {
  const groups = new Map();
  for (const item of reminders) {
    const title = String(item.title || "").trim();
    if (!title) continue;
    const entry = groups.get(title) || { title, count: 0, recent: 0 };
    entry.count++;
    entry.recent = Math.max(entry.recent, Date.parse(item.createdAt) || 0);
    groups.set(title, entry);
  }
  const needle = query.trim().toLocaleLowerCase();
  return [...groups.values()].filter(item => item.title.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.count - a.count || b.recent - a.recent || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, 5).map(item => item.title);
}

export function bindReminderSuggestions(input, list, getHistory) {
  let titles = [], active = -1, dismissed = false;
  function paint() {
    list.replaceChildren();
    list.hidden = !titles.length || dismissed;
    input.setAttribute('aria-expanded', String(!list.hidden));
    input.removeAttribute('aria-activedescendant');
    titles.forEach((title, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.role = 'option'; button.id = `reminder-suggestion-${index}`;
      button.className = 'reminder-suggestion'; button.textContent = title;
      button.setAttribute('aria-selected', String(index === active));
      button.addEventListener('click', () => accept(index));
      list.append(button);
      if (index === active && !list.hidden) input.setAttribute('aria-activedescendant', button.id);
    });
  }
  function refresh() {
    titles = rankReminderTitles(getHistory(), input.value);
    active = input.value ? -1 : (titles.length ? 0 : -1);
    dismissed = false;
    paint();
  }
  function accept(index) {
    input.value = titles[index];
    active = -1; dismissed = true; paint(); input.focus();
    // focus can refresh the list when accepting by pointer; keep it closed.
    dismissed = true; active = -1; paint();
  }
  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { dismissed = true; active = -1; paint(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!titles.length) return;
      event.preventDefault(); dismissed = false;
      active = active < 0 ? (event.key === 'ArrowDown' ? 0 : titles.length - 1)
        : (active + (event.key === 'ArrowDown' ? 1 : -1) + titles.length) % titles.length;
      paint();
    } else if (event.key === 'Enter' && active >= 0 && !dismissed) {
      event.preventDefault(); accept(active);
    }
  });
  refresh();
  return { refresh };
}
