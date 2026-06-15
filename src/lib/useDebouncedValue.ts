import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that only updates after it has stopped changing for
 * `delayMs`. Useful for throttling an expensive consumer (e.g. a chart redraw)
 * while the source updates instantly — a burst of rapid changes collapses into a
 * single trailing update.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
