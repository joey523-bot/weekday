// Preserve confirmed dates when an older client omits the new field.
// An explicit clear, restore, or deletion must not resurrect a sample.
export function preserveMissingOccurrences(incoming, stored) {
  if (!Array.isArray(incoming.reminders)) return incoming;
  const previous = new Map((stored?.reminders || []).map(item => [item.id, item]));
  return { ...incoming, reminders: incoming.reminders.map(item => {
    if (Object.hasOwn(item, "occurredOn")) return item;
    const old = previous.get(item.id);
    return { ...item, occurredOn: item.completed && old?.completed ? old.occurredOn || "" : "" };
  }) };
}
