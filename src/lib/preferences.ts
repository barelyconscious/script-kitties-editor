import { useCallback, useSyncExternalStore } from "react";

/**
 * Central access layer for small, app-wide UI preferences (pane collapse states,
 * toggles, …). Consumers NEVER read or write the underlying storage directly —
 * they go through {@link usePreference} / {@link getPreference} / {@link
 * setPreference}, so the backing can change in ONE place.
 *
 * Today the backing is in-memory: a preference lives for the session and
 * survives page/tool switches (the consumers' React tree never unmounts), but
 * resets on app restart. To persist across restarts later, swap the `backing`
 * read/write seam below for the central localStorage layer — no consumer changes.
 */

/** The typed set of known preferences and their value shapes. Add new keys (and
 *  a default) here so every consumer shares one source of truth. */
export type Preferences = {
  "workbench.objectListCollapsed": boolean;
};

const DEFAULTS: Preferences = {
  "workbench.objectListCollapsed": false,
};

// --- Backing store (the swappable seam) ------------------------------------
// In-memory only for now. A future localStorage-backed implementation replaces
// just these two functions (read/write), keeping the reactive layer below and
// every consumer untouched.
const memory = new Map<keyof Preferences, unknown>();

const backing = {
  read<K extends keyof Preferences>(key: K): Preferences[K] {
    return (memory.has(key) ? memory.get(key) : DEFAULTS[key]) as Preferences[K];
  },
  write<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    memory.set(key, value);
  },
};

// --- Reactive layer --------------------------------------------------------
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read one preference imperatively (outside React, or for the freshest value
 *  inside an event handler to avoid stale closures). */
export function getPreference<K extends keyof Preferences>(key: K): Preferences[K] {
  return backing.read(key);
}

/** Write one preference. Accepts a value or a useState-style updater. */
export function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K] | ((prev: Preferences[K]) => Preferences[K]),
): void {
  const next =
    typeof value === "function"
      ? (value as (prev: Preferences[K]) => Preferences[K])(backing.read(key))
      : value;
  backing.write(key, next);
  for (const listener of listeners) listener();
}

/**
 * Subscribe a component to one preference. Returns `[value, setValue]`, mirroring
 * `useState` (the setter accepts a value or an updater). Re-renders only when
 * this key's value actually changes.
 */
export function usePreference<K extends keyof Preferences>(
  key: K,
): [Preferences[K], (value: Preferences[K] | ((prev: Preferences[K]) => Preferences[K])) => void] {
  const value = useSyncExternalStore(subscribe, () => backing.read(key));
  const setValue = useCallback(
    (next: Preferences[K] | ((prev: Preferences[K]) => Preferences[K])) => setPreference(key, next),
    [key],
  );
  return [value, setValue];
}
