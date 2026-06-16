/**
 * guiPalette — module-cached access to the GUI color palette for the XGUI preview.
 *
 * The palette is a flat `name → "r,g,b,a"` map persisted to game data
 * (`Data/gui_palette.json`) and read via the `get_palette` Tauri command. The
 * preview resolves palette names through it so colors render true; recoloring an
 * entry in the Registry must update every GUI that references it by name.
 *
 * Like {@link import("../components/Sprite").Sprite} does for sprites, the fetch
 * is cached at MODULE level so the palette is loaded once and shared across every
 * preview box — resolving a color must not fire a Tauri call per box per render.
 * Unlike sprites (immutable art keyed by name), the palette is EDITABLE: when the
 * user recolors an entry, {@link invalidatePalette} clears the cache and bumps a
 * version so subscribed previews re-fetch and re-render. (B2's palette save and
 * the watcher own WHEN to invalidate; this module owns the cache + notify.)
 *
 * The hook stays framework-thin: it exposes the resolved `name → code` map (empty
 * until loaded, empty on error — a missing palette is a legitimate empty state per
 * the backend contract) for the pure resolver in `guiBinding.ts` to consume.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Palette } from "./guiBinding";

export type { Palette } from "./guiBinding";

/** Module-level cache of the in-flight (or settled) palette fetch. */
let paletteCache: Promise<Palette> | null = null;

/**
 * A monotonically increasing version, bumped on every {@link invalidatePalette}.
 * Subscribed hooks include it in their effect deps so a recolor triggers a
 * re-fetch + re-render without a full remount.
 */
let paletteVersion = 0;

/** Subscribers (the `setState` of each mounted {@link usePalette}). */
const listeners = new Set<() => void>();

/** Fetch the palette once, caching the promise. Errors resolve to an empty map. */
function loadPalette(): Promise<Palette> {
  if (!paletteCache) {
    paletteCache = invoke<Palette>("get_palette").catch(() => ({}) as Palette);
  }
  return paletteCache;
}

/**
 * Drop the cached palette and notify subscribers so the next read re-fetches.
 * Call after a palette SAVE (recolor/rename/add/remove) or on an external file
 * change, so the preview reflects the new colors. Exposed for B2's save flow and
 * the Registry palette editor.
 */
export function invalidatePalette(): void {
  paletteCache = null;
  paletteVersion += 1;
  for (const notify of listeners) notify();
}

/**
 * Subscribe a component to the module-cached palette.
 *
 * Returns the current resolved `name → code` map (empty until the first fetch
 * settles, and empty on error). Re-fetches whenever {@link invalidatePalette} is
 * called, so recoloring a palette entry updates every preview using this hook.
 */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>({});
  // Subscribe to the module store's version via useSyncExternalStore — the
  // idiomatic way to read an external mutable source. The version is the load
  // effect's trigger: when invalidatePalette() bumps it, the effect re-runs
  // against the freshly-cleared cache and re-fetches.
  const version = useSyncExternalStore(subscribePalette, getPaletteVersion);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the re-fetch trigger — when invalidatePalette() bumps it the effect must re-run against the cleared cache, even though the body doesn't read it
  useEffect(() => {
    let cancelled = false;
    loadPalette().then((p) => {
      if (!cancelled) setPalette(p);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return palette;
}

/** {@link useSyncExternalStore} subscribe: register a listener, return cleanup. */
function subscribePalette(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** {@link useSyncExternalStore} snapshot: the current palette version. */
function getPaletteVersion(): number {
  return paletteVersion;
}
