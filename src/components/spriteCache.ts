/**
 * spriteCache — the module-level, app-wide memo of resolved sprite data URLs,
 * plus its invalidation store.
 *
 * A sprite is fetched through the `get_sprite` Tauri command at most once across
 * the whole app: `<Sprite>`, `useSprite` (the XGUI preview's textured boxes), the
 * data-table dialogs, the sprite picker, the Workbench object list — every
 * consumer shares this one cache, keyed by logical sprite name.
 *
 * Invalidation: when a `.png` changes on disk outside the editor, the backend
 * watcher invalidates its own Rust sprite cache and emits `sprites-changed` (see
 * `src-tauri/src/dal/mod.rs`, `SPRITES_CHANGED_EVENT`). A single app-wide listener
 * (`useSpritesLiveReload`) calls {@link clearSpriteCache}, which drops every
 * memoized URL and bumps a version so subscribed consumers re-fetch fresh bytes —
 * the same notify pattern as {@link import("../lib/guiComponentCache")}. Without
 * this the browser `Map` would outlive the Rust cache and keep serving pre-edit
 * pixels until a window reload.
 */

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

// Keyed by sprite name; the value is the in-flight (or settled) promise of its
// data URL (null = no art). A name is fetched once and shared until the cache is
// cleared by {@link clearSpriteCache}.
const spriteCache = new Map<string, Promise<string | null>>();

/**
 * A monotonically increasing version, bumped on every {@link clearSpriteCache}.
 * Subscribed consumers thread it into their fetch effect's deps so a cache clear
 * re-runs the fetch (against the now-empty cache) and re-paints fresh art.
 */
let version = 0;

/** Subscribers — the store-change callbacks of each mounted sprite consumer. */
const listeners = new Set<() => void>();

/**
 * Fetch a sprite's data URL through `get_sprite`, memoized in {@link spriteCache}
 * so a name is fetched at most once across the whole app. Resolves to `null` for
 * art that is missing or fails to load.
 */
export function loadSprite(name: string): Promise<string | null> {
  let pending = spriteCache.get(name);
  if (!pending) {
    pending = invoke<string | null>("get_sprite", { name }).catch(() => null);
    spriteCache.set(name, pending);
  }
  return pending;
}

/**
 * Evict every memoized sprite and notify subscribers so live `<Sprite>` /
 * `useSprite` consumers re-fetch. Called when the backend signals an external
 * image edit (`sprites-changed`); could also back a future install-path change.
 * Wholesale by design — the cache is keyed by logical name and reverse-mapping a
 * changed path back to its name(s) isn't worth it (one file can resolve under
 * multiple logical names). Only on-screen sprites actually re-fetch, so the clear
 * is cheap.
 */
export function clearSpriteCache(): void {
  spriteCache.clear();
  version += 1;
  for (const notify of listeners) notify();
}

/** The cache's current version — bumped by {@link clearSpriteCache}. */
export function spriteCacheVersion(): number {
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
 * Subscribe to sprite-cache clears. Returns a version number that changes on
 * every {@link clearSpriteCache}; thread it into a fetch effect's deps so the
 * effect re-runs and re-fetches after an external image edit.
 */
export function useSpriteCacheVersion(): number {
  return useSyncExternalStore(subscribe, spriteCacheVersion);
}
