// In-process pub/sub for live dashboard updates. Single server process only.
export function createEventHub() {
  const subscribers = new Set();
  return {
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    publish(type, data) {
      for (const fn of subscribers) fn({ type, data });
    },
  };
}
