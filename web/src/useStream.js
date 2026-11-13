import { useEffect, useRef } from "react";

// Subscribes to the server's live stream. Handlers may change every render
// without reconnecting; the latest ones are always used.
export function useStream(handlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const source = new EventSource("/api/v1/stream");
    const listeners = Object.keys(latest.current).map((type) => {
      const fn = (e) => latest.current[type](JSON.parse(e.data));
      source.addEventListener(type, fn);
      return [type, fn];
    });
    return () => {
      for (const [type, fn] of listeners) source.removeEventListener(type, fn);
      source.close();
    };
  }, []);
}
