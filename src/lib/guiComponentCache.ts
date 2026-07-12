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
 *   - a child referenced from many places is fetched once and shared.
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
 * save), {@link invalidateComponents} drops the changed child (or the whole cache
 * on a coarse signal) and bumps a version so subscribed previews re-evaluate — same
 * notify pattern as the palette cache. A TARGETED drop lets untouched children
 * re-render from {@link peekComponent} without a `loading` flash.
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
 * Synchronously-readable mirror of the cache: basename → its SETTLED value, written
 * when {@link loadComponent}'s promise resolves. Lets {@link useComponent} re-read a
 * still-cached child WITHOUT a loading flicker on a version bump that didn't touch
 * it (see {@link peekComponent}). Kept in lockstep with `cache`:
 *   - dropped together in {@link invalidateComponents} (per-key or clear-all);
 *   - the settle-time write is guarded by promise identity so an invalidation
 *     mid-fetch can't resurrect a stale value.
 */
const settled = new Map<string, SettledEntry>();

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
    // Mirror the settled value into `settled` for synchronous peeks — but ONLY while
    // this exact promise is still the cached one. An invalidation between fetch and
    // settle deletes the cache entry; without the identity guard the racing settle
    // would resurrect a stale value the next mount would peek instead of re-fetching.
    const thisEntry = entry;
    void entry.then((result) => {
      if (cache.get(basename) === thisEntry) settled.set(basename, result);
    });
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
 * Synchronously read a basename's SETTLED cache entry, or `undefined` if it isn't
 * cached yet (never fetched, still in flight, or just invalidated). Lets
 * {@link useComponent} keep showing a surviving child on a version bump instead of
 * flashing to `loading` and re-fetching. Never triggers a fetch — that's
 * {@link loadComponent}'s job on a genuine miss.
 */
export function peekComponent(basename: string): SettledEntry | undefined {
  return settled.get(basename);
}

/**
 * Drop cached child components and notify subscribers so the next read re-fetches.
 * Call after a component SAVE or on an external gui-file change (B1's recursive
 * watcher), so a renamed/edited child reflects in mounting previews.
 *
 *  - `basename` given: drop ONLY that one entry (targeted) — the file that actually
 *    changed re-fetches; every OTHER mounted child keeps its cached value and, via
 *    {@link peekComponent}, re-renders without a loading flash. `basename` is the
 *    bare STEM the cache is keyed by (what `srcBasename` produces), NOT a `.xml`
 *    filename — the caller normalizes the changed path first.
 *  - omitted / `null`: clear the WHOLE cache — the conservative fallback for a
 *    coarse "something changed" signal we can't attribute to one file.
 *
 * Both paths bump the version so subscribed previews re-evaluate.
 */
export function invalidateComponents(basename?: string | null): void {
  if (basename == null) {
    cache.clear();
    settled.clear();
  } else {
    cache.delete(basename);
    settled.delete(basename);
  }
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
  // Seed from the cache synchronously: a child that's already settled shows its
  // value on the FIRST render (a second mount of an already-loaded child never
  // flashes `loading`). Falls back to `loading`/`missing` only when nothing's cached.
  const [entry, setEntry] = useState<ComponentEntry>(() =>
    basename ? (peekComponent(basename) ?? { status: "loading" }) : { status: "missing" },
  );
  // Subscribe to the module store's version so an invalidation re-runs the effect.
  const ver = useSyncExternalStore(subscribe, getVersion);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ver` is the re-fetch trigger — when invalidateComponents() bumps it the effect must re-run and re-peek/re-fetch, even though the body doesn't read it directly (matches usePalette)
  useEffect(() => {
    if (!basename) {
      setEntry({ status: "missing" });
      return;
    }
    // A TARGETED invalidation drops only the changed basename, so most version bumps
    // leave THIS entry intact. Re-read it synchronously and keep showing the settled
    // value — no loading flicker for a child that didn't change.
    const cached = peekComponent(basename);
    if (cached) {
      setEntry(cached);
      return;
    }
    // Genuine cache MISS (first mount, or this exact entry was just invalidated):
    // show `loading` and fetch. This is the only path that flashes — and only for
    // the file that actually changed.
    let cancelled = false;
    setEntry({ status: "loading" });
    loadComponent(basename).then((result) => {
      if (!cancelled) setEntry(result);
    });
    return () => {
      cancelled = true;
    };
    // `ver` is the re-fetch trigger: when invalidateComponents() bumps it the effect
    // re-runs, re-peeks the (possibly-dropped) entry, and re-fetches only on a miss.
    // `basename` re-peeks/re-fetches on change.
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
