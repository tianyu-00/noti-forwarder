// Mirrors the server's filters so live messages can be checked client-side.
export function matchesView(message, { selected, filters }) {
  if (selected && message.deviceId !== selected) return false;
  if (filters.type && message.type !== filters.type) return false;
  if (filters.app && message.app !== filters.app) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    const haystack = [message.body, message.sender, message.app]
      .join("\n")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}
