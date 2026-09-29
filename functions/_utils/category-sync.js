// Older clients do not know this field. Preserve the server's category names
// when such a client saves its otherwise valid account snapshot.
export function preserveMissingCategories(incoming, stored) {
  if (Object.hasOwn(incoming.preferences || {}, 'customCategories')) return incoming;
  return { ...incoming, preferences: { ...incoming.preferences,
    customCategories: stored?.preferences?.customCategories || [] } };
}
