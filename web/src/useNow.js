import { useEffect, useState } from 'react';

/** The current time in milliseconds, refreshed on an interval so "5 min ago" labels stay true. */
export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
