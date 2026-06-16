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
import { useEditorStore } from "./editorState";
import { GUI_CHANGED_EVENT } from "./guiEvents";
import type { GuiComponentRef } from "./guiTree";
import { decideLiveReload, remapSelection } from "./liveReload";
import { buildOpenComponent } from "./openComponent";

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

  // Re-read + re-parse the open component from disk and seat it live, preserving
  // the selection if the selected node still exists after the re-parse. Shared by
  // the clean-path auto-reload and the dirty-path explicit Reload button.
  const performReload = useCallback(async () => {
    const open = stateRef.current.open;
    if (!open) return;
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
      // A failed re-read leaves the editor as-is (the user keeps what they have);
      // the next change re-attempts. Nothing to stomp on a read error.
      return;
    }
    // File vanished (external delete) — leave the open doc; the list refresh shows
    // it's gone, and we don't blank the editor out from under the user.
    if (xml == null) return;
    let component: ReturnType<typeof buildOpenComponent>;
    try {
      component = buildOpenComponent(ref, xml);
    } catch {
      // Externally-saved malformed XML: don't replace a good tree with a parse
      // error. Leave the editor; the user can re-save the file to fix it.
      return;
    }
    const selectedNodeId = remapSelection(
      open.root,
      component.root,
      stateRef.current.selectedNodeId,
    );
    dispatch({ type: "reloadOpen", component, selectedNodeId });
  }, [dispatch]);

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
      // ALWAYS refresh the list so external add/delete/rename appears.
      void reloadTreeRef.current();
      const s = stateRef.current;
      const decision = decideLiveReload(
        { openName: s.open?.name ?? null, openPath: s.open?.path ?? null, dirty: s.dirty },
        changedPath,
      );
      if (decision === "reload-open") {
        void performReload();
      } else if (decision === "notice-dirty") {
        // Don't stomp the draft — surface the conflict; the user chooses.
        setDiskChangeNotice(s.open?.name ?? null);
      }
      // "refresh-only" already handled by the unconditional reloadTree above.
    }).then((fn) => {
      // listen() resolves async; if we already unmounted, detach immediately.
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [performReload]);

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
