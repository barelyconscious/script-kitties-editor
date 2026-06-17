/**
 * dataModelStore — EDITOR-LOCAL persistence for each component's Data Model JSON
 * (task 484).
 *
 * The Data Model panel is scratch input the preview resolves `{token}` bindings
 * against. It is NEVER written to game data — it is purely the editor's working
 * state. Task 482 scaffolds a fresh model on open; without persistence, switching
 * components (or restarting the app) throws away the user's edits. This module
 * persists the panel text PER COMPONENT, keyed by the component's stable path
 * (`open.path`), in localStorage so it survives both.
 *
 * Shape on disk: a SINGLE JSON object under one key (`xgui.dataModels`) mapping
 * `componentPath → modelText`. One key keeps the storage tidy and lets a single
 * parse load the whole map; per-path writes rewrite that one object.
 *
 * Defensive by design: every read/parse and every write is wrapped so a corrupt,
 * oversized, or unavailable store (private-mode quota, disabled storage, malformed
 * JSON) degrades to "no persisted model" rather than throwing into the React tree.
 * On a corrupt read the caller falls back to scaffold-fresh, exactly as if nothing
 * were stored.
 *
 * The core map<->text logic is PURE (operates on an injected `Storage`), so it is
 * unit-tested off the browser with a tiny in-memory stand-in.
 */

/** The single localStorage key holding the whole `path → modelText` map. */
export const DATA_MODELS_KEY = "xgui.dataModels";

/**
 * The minimal `Storage` surface this module uses — `getItem`/`setItem`. Both the
 * real `window.localStorage` and the test stand-in satisfy it, so the logic never
 * depends on the DOM directly.
 */
export type ModelStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Resolve the storage to use: the injected one, else `globalThis.localStorage` when
 * present (browser), else `null` (node/test without a DOM, or storage disabled).
 * Accessing `localStorage` can itself throw in locked-down environments, so even
 * the lookup is guarded.
 */
function resolveStorage(storage?: ModelStorage): ModelStorage | null {
  if (storage) return storage;
  try {
    const ls = (globalThis as { localStorage?: ModelStorage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

/**
 * Read and parse the whole `path → modelText` map. Returns an empty map when the
 * store is absent, empty, unreadable, malformed, or not a plain string-valued
 * object — never throws. Non-string entries are dropped defensively so a single bad
 * value can't poison the rest of the map.
 */
function readMap(storage?: ModelStorage): Record<string, string> {
  const store = resolveStorage(storage);
  if (!store) return {};
  let raw: string | null;
  try {
    raw = store.getItem(DATA_MODELS_KEY);
  } catch {
    return {};
  }
  if (raw == null || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * The persisted model text for one component path, or `undefined` when none is
 * stored (or the store is unreadable). `undefined` is the caller's signal to
 * scaffold fresh.
 */
export function getPersistedModel(path: string, storage?: ModelStorage): string | undefined {
  return readMap(storage)[path];
}

/**
 * Persist one component's model text under its path, preserving every other path's
 * entry. A write failure (quota, disabled storage) is swallowed — persistence is a
 * best-effort convenience, never a correctness requirement, so a full store must
 * not break editing.
 */
export function setPersistedModel(path: string, text: string, storage?: ModelStorage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  const map = readMap(store);
  map[path] = text;
  try {
    store.setItem(DATA_MODELS_KEY, JSON.stringify(map));
  } catch {
    // Best-effort: a full/disabled store just means this edit isn't persisted.
  }
}
