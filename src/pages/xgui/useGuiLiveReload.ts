/**
 * useGuiLiveReload — the React glue for F13's external-edit sync. Subscribes to
 * the backend's `gui-changed` Tauri event (emitted by the `gui/` filesystem
 * watcher AFTER it invalidates its caches, so re-fetches read fresh data) and
 * reconciles each change against the shared open-component store, REUSING F11's
 * trust model: a clean open document live-reloads; a DIRTY one is never stomped —
 * it gets a non-destructive notice instead.
 *
 * The pure decision (which of the three branches) and the selection remap across
 * the re-parse live in {@link decideLiveReload} / {@link remapSelection}; this
 * hook only wires the event, the re-fetches, and the dispatches.
 *
 * The hook owns:
 *  - the `gui-changed` listener (cleaned up on unmount),
 *  - the "open file changed under unsaved edits" notice state + its Reload/Keep
 *    handlers (Reload performs the deliberate, draft-discarding re-read).
 *
 * It is given `reloadTree` (the component list's `get_gui_tree` refetch) so EVERY
 * change refreshes the list — external add/delete/rename must appear regardless
 * of the open document's state.
 *
 * @see design/xgui_ta.md — section 7 "Warn on switch" (the trust model mirrored).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { invalidateComponents } from "../../lib/guiComponentCache";
import { serializeGui } from "../../lib/guiNode";
import { useEditorStore } from "./editorState";
import { getPersistedLocks, nodeIdsForKeys } from "./elementLockStore";
import { GUI_CHANGED_EVENT } from "./guiEvents";
import type { GuiComponentRef } from "./guiTree";
import { classifyOpenChange, onGuiChangedAlways, remapSelection } from "./liveReload";
import { buildOpenComponent } from "./openComponent";
import { isOwnControllerSaveEcho, isOwnSaveEcho } from "./saveComponent";

export type GuiLiveReload = {
  /** Basename of the open component whose disk file changed under unsaved edits,
   *  or `null` when there's no pending disk-change notice to show. */
  diskChangeNotice: string | null;
  /** Reload the open component from disk, discarding the local draft (deliberate). */
  reloadFromDisk: () => void;
  /** Dismiss the notice and keep the local draft (the safe default). */
  keepLocalChanges: () => void;
};

/**
 * Wire the `gui-changed` event to the open-component store.
 *
 * @param reloadTree Re-fetch the component list (`get_gui_tree`). Called on EVERY
 *   change so external add/delete/rename always surfaces. Should be referentially
 *   stable (a `useCallback`); only its latest value is used via a ref.
 */
export function useGuiLiveReload(reloadTree: () => Promise<unknown>): GuiLiveReload {
  const { state, dispatch } = useEditorStore();
  const [diskChangeNotice, setDiskChangeNotice] = useState<string | null>(null);

  // The listener is long-lived (registered once); read the LATEST state/inputs
  // through refs so the closure never goes stale without re-subscribing on every
  // keystroke (which would race the async listen() registration).
  const stateRef = useRef(state);
  stateRef.current = state;
  const reloadTreeRef = useRef(reloadTree);
  reloadTreeRef.current = reloadTree;

  // Re-read + re-parse the open component from disk. Returns the rebuilt component
  // alongside the `open` it was read for (so a caller can detect the open doc
  // changing mid-read), or `null` when there's nothing to seat — no open doc, a
  // read error (keep what the user has), an external delete (don't blank the
  // editor), or externally-saved malformed XML (don't replace a good tree with a
  // parse error). Shared by the explicit Reload button and the event reconciler.
  const readOpenFromDisk = useCallback(async () => {
    const open = stateRef.current.open;
    if (!open) return null;
    const ref: GuiComponentRef = {
      name: open.name,
      fileName: `${open.name}.xml`,
      path: open.path,
      // kind/controllerFileName only seed display + controller fallback; the parse
      // reconciles the authoritative <View controller> attr, and kind is unused by
      // buildOpenComponent. A best-effort widget default is fine here.
      kind: "widget",
      controllerFileName: open.controllerFileName,
    };
    let xml: string | null;
    try {
      xml = await invoke<string | null>("get_component", { name: open.name });
    } catch {
      return null;
    }
    if (xml == null) return null;
    try {
      return { component: buildOpenComponent(ref, xml), open };
    } catch {
      return null;
    }
  }, []);

  // Seat a freshly-read component into the store, preserving the selection if the
  // selected node still exists after the re-parse. Bails if the open doc changed
  // during the async read (the change no longer applies to what's open now).
  const seatReload = useCallback(
    (component: ReturnType<typeof buildOpenComponent>, openPath: string) => {
      const cur = stateRef.current.open;
      if (!cur || cur.path !== openPath) return;
      const selectedNodeId = remapSelection(
        cur.root,
        component.root,
        stateRef.current.selectedNodeId,
      );
      // Re-resolve persisted locks against the re-parsed tree (nodeIds were
      // re-minted), so a live external edit doesn't drop the user's locks.
      const lockedNodeIds = nodeIdsForKeys(component.root, getPersistedLocks(component.path));
      dispatch({ type: "reloadOpen", component, selectedNodeId, lockedNodeIds });
    },
    [dispatch],
  );

  // The explicit Reload button: force a re-seat from disk, discarding the draft.
  const performReload = useCallback(async () => {
    const res = await readOpenFromDisk();
    if (res) seatReload(res.component, res.open.path);
  }, [readOpenFromDisk, seatReload]);

  // The event-driven reconcile when the OPEN component's file changed. Distinct
  // from the button: it must (1) ignore the editor's OWN save echoing back through
  // the watcher, and (2) never stomp a dirty draft — surface the notice instead.
  //
  // `kind` selects WHICH file changed: an `.xml` edit echo-checks the serialized
  // tree; a controller `.lua` edit re-reads the `.lua` via `get_script` and
  // echo-checks that. Either way we still `readOpenFromDisk` first — the reload
  // (`seatReload` → `reloadOpen`) re-seats the whole component and resets
  // `controllerText` to null so the ControllerTab lazily re-reads the fresh `.lua`.
  const reconcileOpenChange = useCallback(
    async (kind: "xml" | "controller") => {
      const res = await readOpenFromDisk();
      if (!res) return;
      const cur = stateRef.current.open;
      if (!cur || cur.path !== res.open.path) return;
      // Our OWN save (the watcher can't distinguish it from an external edit): the
      // re-read content matches what we wrote → nothing changed externally.
      if (kind === "xml") {
        if (isOwnSaveEcho(res.open.path, serializeGui(res.component.root))) return;
      } else {
        const fileName = cur.controllerFileName;
        if (fileName == null) return;
        let lua: string | null;
        try {
          lua = await invoke<string | null>("get_script", { name: fileName });
        } catch {
          return;
        }
        if (isOwnControllerSaveEcho(res.open.path, lua ?? "")) return;
      }
      if (stateRef.current.dirty) {
        // A genuine external change while the user has unsaved edits — don't stomp;
        // surface the conflict and let them choose (Reload / Keep).
        setDiskChangeNotice(cur.name);
        return;
      }
      seatReload(res.component, res.open.path);
    },
    [readOpenFromDisk, seatReload],
  );

  const reloadFromDisk = useCallback(() => {
    setDiskChangeNotice(null);
    void performReload();
  }, [performReload]);

  const keepLocalChanges = useCallback(() => setDiskChangeNotice(null), []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<string | null>(GUI_CHANGED_EVENT, (event) => {
      const changedPath = event.payload ?? null;
      // ALWAYS, regardless of branch: refresh the component list (external
      // add/delete/rename) AND drop the frontend child-mount cache entry for the
      // CHANGED child so components that mount it via <Component src> re-fetch the
      // fresh child. The cache drop is safe here because `gui-changed` fires AFTER
      // the backend caches are invalidated, so re-fetches read fresh data. Targeted
      // by design: only the changed stem is dropped, so saving a screen that embeds
      // other components no longer flashes those untouched children (task 523). A
      // null (unattributable) payload falls back to a whole-cache clear.
      onGuiChangedAlways(() => void reloadTreeRef.current(), invalidateComponents, changedPath);
      const s = stateRef.current;
      const kind = classifyOpenChange(
        {
          openName: s.open?.name ?? null,
          openPath: s.open?.path ?? null,
          openControllerFileName: s.open?.controllerFileName ?? null,
          dirty: s.dirty,
        },
        changedPath,
      );
      // An "xml" or "controller" change means the OPEN document's file changed;
      // the reconciler re-reads disk to suppress our own save echo and then
      // branches on dirtiness (re-seat when clean, notice when dirty). The dirty
      // flag is re-read there, so passing through one path is correct. "other" is
      // already handled by the unconditional reloadTree above.
      if (kind !== "other") {
        void reconcileOpenChange(kind);
      }
    }).then((fn) => {
      // listen() resolves async; if we already unmounted, detach immediately.
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reconcileOpenChange]);

  // If the open component is closed or switched while a notice is pending, drop
  // the stale notice (it referred to a document that's no longer open).
  const openName = state.open?.name ?? null;
  useEffect(() => {
    if (diskChangeNotice != null && diskChangeNotice !== openName) {
      setDiskChangeNotice(null);
    }
  }, [openName, diskChangeNotice]);

  return { diskChangeNotice, reloadFromDisk, keepLocalChanges };
}
