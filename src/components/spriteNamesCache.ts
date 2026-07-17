/**
 * spriteNamesCache — the module-level, app-wide memo of the sprite-picker's list of
 * available sprite NAMES (distinct from {@link import("./spriteCache")}, which memoizes
 * the resolved image data URLs).
 *
 * The list comes from `list_sprites`, which reads the asset manifest (`assets.json`).
 * It changes rarely within a session, so it is fetched once and shared across every
 * {@link import("./data-tables/SpritePicker").SpritePicker}.
 *
 * Invalidation: the manifest changes when the user runs "Update assets" (the
 * `update_asset_manifest` command rewrites `assets.json`). {@link clearSpriteNames}
 * drops the memoized list and bumps a version so subscribed pickers re-fetch the fresh
 * names — the same notify pattern as {@link import("./spriteCache")}. Without this the
 * browser would keep serving the pre-rescan name list until a window reload.
 */

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

// The in-flight (or settled) promise of the sprite-name list, shared until cleared by
// {@link clearSpriteNames}. Fetches at most once across the whole app.
let namesCache: Promise<string[]> | null = null;

/** Monotonic version, bumped on every {@link clearSpriteNames} so consumers re-fetch. */
let version = 0;

/** Subscribers — the store-change callbacks of each mounted picker. */
const listeners = new Set<() => void>();

/**
 * Fetch the sprite-name list through `list_sprites`, memoized so it is fetched at most
 * once across the whole app (until {@link clearSpriteNames}). Resolves to `[]` on error.
 */
export function loadSpriteNames(): Promise<string[]> {
  if (!namesCache) {
    namesCache = invoke<string[]>("list_sprites").catch(() => []);
  }
  return namesCache;
}

/**
 * Drop the memoized name list and notify subscribers so mounted pickers re-fetch. Called
 * after an asset rescan ("Update assets"), which can add/remove sprites in the manifest.
 */
export function clearSpriteNames(): void {
  namesCache = null;
  version += 1;
  for (const notify of listeners) notify();
}

/** The cache's current version — bumped by {@link clearSpriteNames}. */
export function spriteNamesVersion(): number {
  return version;
}

/** {@link useSyncExternalStore} subscribe: register a listener, return cleanup. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/**
 * Subscribe to name-cache clears. Returns a version that changes on every
 * {@link clearSpriteNames}; thread it into a fetch effect's deps so the effect re-runs
 * and re-fetches after a rescan.
 */
export function useSpriteNamesVersion(): number {
  return useSyncExternalStore(subscribe, spriteNamesVersion);
}
