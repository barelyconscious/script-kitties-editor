/**
 * useDataLiveReload — the app-wide glue that keeps entity data in sync with
 * external edits to the game's data files.
 *
 * When a watched DATA file changes on disk outside the editor — a `Data/*.json`
 * domain file, `Data/palette.json`, or the root `assets.json` — the backend
 * watcher invalidates its Rust cache and emits `data-changed` with the domain's
 * kind string (see `src-tauri/src/dal/mod.rs`, `DATA_CHANGED_EVENT`). This hook
 * is the one frontend listener; it routes the kind into the matching frontend
 * notify mechanism:
 *
 *  - entity kinds (`"abilities"`, `"creatures"`, …) → {@link bumpEntityVersion},
 *    the SAME signal in-app saves already fire — so every surface subscribed via
 *    `useEntityVersion` re-fetches on disk edits and in-app saves alike,
 *  - `"palette"` → {@link invalidatePalette}, so XGUI previews re-resolve colors,
 *  - `"assets"` → drop the sprite-name list AND the resolved-sprite cache (the
 *    manifest maps names to paths, so a manifest change can both add/remove
 *    names and repoint existing ones).
 *
 * Mount it ONCE, app-wide (App.tsx), alongside `useSpritesLiveReload`. No
 * self-echo dedup here: an own-save echo just re-bumps the version, and
 * consumers re-fetch data equal to what they hold — a record-level no-op.
 */

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { bumpEntityVersion, isEntityKind } from "@/lib/entities/dataVersion";
import { invalidatePalette } from "@/lib/guiPalette";
import { clearSpriteCache } from "./spriteCache";
import { clearSpriteNames } from "./spriteNamesCache";

/**
 * The Tauri event name the backend emits after invalidating its cache on an
 * external data-file edit. MUST match the Rust `DATA_CHANGED_EVENT` constant.
 * Payload: the changed domain's kind string.
 */
export const DATA_CHANGED_EVENT = "data-changed";

/**
 * Route one `data-changed` payload to the matching frontend invalidation.
 * Exported for tests; unknown kinds are ignored (a forward-compat no-op, so an
 * older frontend never throws on a newer backend's kinds).
 */
export function applyDataChanged(kind: string): void {
  if (isEntityKind(kind)) {
    bumpEntityVersion(kind);
    return;
  }
  if (kind === "palette") {
    invalidatePalette();
    return;
  }
  if (kind === "assets") {
    clearSpriteNames();
    clearSpriteCache();
  }
}

/** Wire `data-changed` to the frontend notify mechanisms. Mount once, app-wide. */
export function useDataLiveReload(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<string>(DATA_CHANGED_EVENT, (event) => applyDataChanged(event.payload)).then(
      (fn) => {
        // listen() resolves async; if we already unmounted, detach immediately.
        if (disposed) fn();
        else unlisten = fn;
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
