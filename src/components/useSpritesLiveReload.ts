/**
 * useSpritesLiveReload — the app-wide glue that keeps on-screen sprites in sync
 * with external image edits.
 *
 * When a `.png` under `Sprites/` or `gui/` changes on disk outside the editor, the
 * backend watcher invalidates its Rust sprite cache and emits `sprites-changed`
 * (see `src-tauri/src/dal/mod.rs`, `SPRITES_CHANGED_EVENT`). This hook is the one
 * frontend listener: on that event it clears the module-level sprite cache
 * ({@link clearSpriteCache}), which drops every memoized data URL and re-fetches
 * across all ~11 consumers (the object list, sprite picker, data-table dialogs,
 * the XGUI preview, …). Without it the browser `Map` would outlive the Rust cache
 * and keep serving pre-edit pixels until a window reload.
 *
 * Mount it ONCE, app-wide (App.tsx) — the sprite cache is a single shared store,
 * so one listener covers every consumer. No self-echo dedup is needed (unlike the
 * gui-changed handling): the editor never authors PNGs, so a `sprites-changed`
 * event is always a genuine external edit.
 */

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { clearSpriteCache } from "./spriteCache";

/**
 * The Tauri event name the backend emits after invalidating its sprite cache on
 * an external `.png` edit. MUST match the Rust `SPRITES_CHANGED_EVENT` constant.
 * Coarse — no payload — because the frontend cache is keyed by logical name and
 * reverse-mapping a path to its name(s) isn't worth it; the listener clears the
 * whole cache.
 */
export const SPRITES_CHANGED_EVENT = "sprites-changed";

/** Wire `sprites-changed` to a wholesale sprite-cache clear. Mount once, app-wide. */
export function useSpritesLiveReload(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen(SPRITES_CHANGED_EVENT, () => clearSpriteCache()).then((fn) => {
      // listen() resolves async; if we already unmounted, detach immediately.
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
