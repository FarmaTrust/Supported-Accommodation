export type SoundNotification = { id: number; readAt: number | null };

export function unreadNotificationIds(items: SoundNotification[]) {
  return items.filter(item => !item.readAt).map(item => item.id).sort((left, right) => left - right);
}

/** Existing alerts establish the baseline; only later unread IDs should ping. */
export function newUnreadNotificationIds(previous: number[] | null, items: SoundNotification[]) {
  const current = unreadNotificationIds(items);
  if (previous === null) return { current, added: [] as number[] };
  const known = new Set(previous);
  return { current, added: current.filter(id => !known.has(id)) };
}
