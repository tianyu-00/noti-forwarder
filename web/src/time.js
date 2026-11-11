export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function isOnline(lastSeen, now = Date.now()) {
  return Boolean(lastSeen) && now - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;
}

export function timeAgo(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
