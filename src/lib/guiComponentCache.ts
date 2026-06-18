/**
 * guiComponentCache — module-cached async fetch + parse of nested GUI components
 * for the XGUI preview (F6b).
 *
 * Mounting a `<Component src="bag_slot.xml">` needs the child's PARSED tree. The
 * child XML is fetched via the `get_component` Tauri command (B5: resolves a bare
 * basename through the asset manifest) and parsed with F1's {@link parseGui}. Like
 * {@link import("./guiPalette").usePalette} does for the palette, the fetch+parse
 * is cached at MODULE level and keyed by basename, so:
 *
 *   - the preview does NOT refetch a child on every keystroke (editing the Data
 *     Model re-renders the parent, but the child trees are stable);
 *   - a child referenced from many places (or many `forEach` instances) is fetched
 *     once and shared.
 *
 * Each cache entry settles to one of three states, mirroring `get_component`'s
 * three outcomes — surfaced to the renderer as a small tagged result so the mount
 * step can decide mount-vs-placeholder synchronously after the fetch settles:
 *
 *   - `{ status: "ok", root }`       — the child parsed; mount its subtree.
 *   - `{ status: "missing" }`        — `get_component` returned `null` (not in the
 *                                      manifest) OR errored (broken install) OR the
 *                                      XML failed to parse. ALL collapse to the
 *                                      shared `missing:` placeholder — the preview's
 *                                      job is render-robustness, never a crash, and
 *                                      a child that can't be shown is "missing" to
 *                                      the author regardless of the precise cause.
 *   - `{ status: "loading" }`        — the synchronous read while the fetch is in
 *                                      flight; the renderer shows nothing yet (no
 *                                      flash of placeholder) and re-renders when the
 *                                      promise settles via the version bump.
 *
 * Invalidation: when a gui file changes (B1's recursive watcher, or a component
 * save), {@link invalidateComponents} clears the cache and bumps a version so
 * subscribed previews re-fetch — same notify pattern as the palette cache.
 *
 * @see design/xgui_ta.md — "(3) `<Component src>` resolution".
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { type GuiNode, GuiParseError, parseGui } from "./guiNode";

/**
 * A settled (or in-flight) child-component lookup, as the renderer reads it.
 *
 * `loading` is the transient pre-settle state; `ok` carries the parsed tree;
 * `missing` is the single failure bucket (absent / broken / unparseable) that maps
 * to the shared `missing:` placeholder.
 */
export type ComponentEntry =
  | { status: "loading" }
  | { status: "ok"; root: GuiNode }
  | { status: "missing" };

/** The settled result of a fetch+parse, stored in the cache (no `loading`). */
export type SettledEntry = { status: "ok"; root: GuiNode } | { status: "missing" };

/** Module-level cache: basename → in-flight (or settled) fetch+parse promise. */
const cache = new Map<string, Promise<SettledEntry>>();

/**
 * Map a `get_component` body to a settled cache entry — the PURE failure-bucketing
 * step, exported for unit testing without a fetch:
 *
 *   - `null` (not in the manifest)        → `missing`
 *   - a body that fails F1's {@link parseGui} → `missing` (unparseable child XML)
 *   - a body that parses                  → `ok` with the tree
 *
 * ALL failures collapse to the single `missing:` placeholder bucket — the preview's
 * job is render-robustness, never a crash. A non-`GuiParseError` throw is logged
 * (unexpected) but still bucketed as missing so the preview stays alive. The
 * broken-install case (`get_component` ERRORS) is handled by the promise `.catch`
 * in {@link loadComponent}; it does not reach here.
 */
export function parseComponentXml(xml: string | null): SettledEntry {
  if (xml === null) return { status: "missing" };
  try {
    return { status: "ok", root: parseGui(xml) };
  } catch (err) {
    if (!(err instanceof GuiParseError)) {
      console.error("Unexpected error parsing component XML:", err);
    }
    return { status: "missing" };
  }
}

/**
 * A monotonically increasing version, bumped on every {@link invalidateComponents}.
 * Subscribed hooks include it so a gui-file change re-fetches + re-renders without
 * a full remount.
 */
let version = 0;

/** Subscribers (the store-change callbacks of each mounted {@link useComponent}). */
const listeners = new Set<() => void>();

/**
 * Fetch + parse one child component by basename, caching the promise. The promise
 * NEVER rejects — every failure (absent → `null`, broken install → Err, unparseable
 * XML → throw) is mapped to `{ status: "missing" }` so the renderer always gets a
 * renderable result and never an unhandled rejection.
 */
function loadComponent(basename: string): Promise<SettledEntry> {
  let entry = cache.get(basename);
  if (!entry) {
    entry = invoke<string | null>("get_component", { name: basename })
      .then(parseComponentXml)
      .catch((): SettledEntry => ({ status: "missing" })); // broken install / IPC error
    cache.set(basename, entry);
  }
  return entry;
}

/**
 * Fetch + parse one component by basename, returning its parsed tree or `null`
 * (absent / broken / unparseable — the same single failure bucket). Shares the
 * module cache + invalidation with the preview's {@link useComponent}, so loading
 * the whole set for the data-model registry never double-fetches a child the
 * preview already pulled. A blank basename short-circuits to `null`.
 */
export async function loadComponentTree(basename: string): Promise<GuiNode | null> {
  if (!basename) return null;
  const entry = await loadComponent(basename);
  return entry.status === "ok" ? entry.root : null;
}

/** The module cache's current version — bumped by {@link invalidateComponents}. */
export function componentsVersion(): number {
  return version;
}

/** Subscribe to cache invalidations (re-export of the internal store subscribe). */
export function subscribeComponents(onChange: () => void): () => void {
  return subscribe(onChange);
}

/**
 * Drop all cached child components and notify subscribers so the next read
 * re-fetches. Call after a component SAVE or on an external gui-file change (B1's
 * recursive watcher), so a renamed/edited child reflects in mounting previews.
 */
export function invalidateComponents(): void {
  cache.clear();
  version += 1;
  for (const notify of listeners) notify();
}

/**
 * Subscribe a component to the module-cached child-component fetch for `basename`.
 *
 * Returns a {@link ComponentEntry}: `loading` until the fetch+parse settles, then
 * `ok`/`missing`. A `null`/empty `basename` short-circuits to `missing` without a
 * fetch (a blank `src` is "missing" — though the renderer usually decides that via
 * {@link import("./guiComponentMount").mountDecision} before calling this). Re-fetches
 * whenever {@link invalidateComponents} bumps the version.
 */
export function useComponent(basename: string | null): ComponentEntry {
  const [entry, setEntry] = useState<ComponentEntry>({ status: "loading" });
  // Subscribe to the module store's version so an invalidation re-runs the effect.
  const ver = useSyncExternalStore(subscribe, getVersion);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ver` is the re-fetch trigger — when invalidateComponents() bumps it the effect must re-run against the cleared cache, even though the body doesn't read it (matches usePalette)
  useEffect(() => {
    if (!basename) {
      setEntry({ status: "missing" });
      return;
    }
    let cancelled = false;
    setEntry({ status: "loading" });
    loadComponent(basename).then((settled) => {
      if (!cancelled) setEntry(settled);
    });
    return () => {
      cancelled = true;
    };
    // `ver` is the re-fetch trigger: when invalidateComponents() bumps it the
    // effect re-runs against the cleared cache. `basename` re-fetches on change.
  }, [basename, ver]);

  return entry;
}

/** {@link useSyncExternalStore} subscribe: register a listener, return cleanup. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** {@link useSyncExternalStore} snapshot: the current cache version. */
function getVersion(): number {
  return version;
}
