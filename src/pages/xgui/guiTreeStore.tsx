/**
 * guiTreeStore — the shared component-LIST state for the XGUI page, lifted out of
 * {@link ComponentList} so two siblings can act on it: the list itself (renders
 * the tree, drives open/create) and F13's live-reload glue (must refresh the list
 * on every external change, and must surface a disk-change notice on the MAIN
 * editor pane, not the left panel).
 *
 * It owns the `get_gui_tree` fetch + tree/loading/error state, and runs
 * {@link useGuiLiveReload} (feeding it `reload` so external edits refresh the
 * list) so the resulting disk-change notice is available to MainContent. Mounting
 * it once at the page top, under the editor store provider, keeps a single tree
 * and a single live-reload subscription for the whole page.
 *
 * @see design/xgui_ta.md — "Component list (leftmost, collapsible)".
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GuiFolder } from "./guiTree";
import { type GuiLiveReload, useGuiLiveReload } from "./useGuiLiveReload";

const EMPTY_TREE: GuiFolder = { name: "", path: "", folders: [], components: [] };

export type GuiTreeStore = {
  /** The current `gui/` tree (empty root until the first load resolves). */
  tree: GuiFolder;
  /** True while a `get_gui_tree` fetch is in flight. */
  loading: boolean;
  /** The last load error, or `null`. */
  error: string | null;
  /** Re-fetch the tree; resolves the fresh tree, or `null` on failure. */
  reload: () => Promise<GuiFolder | null>;
  /** F13 live-reload: disk-change notice for the open component + its actions. */
  live: GuiLiveReload;
};

const GuiTreeContext = createContext<GuiTreeStore | null>(null);

/** Provider for the shared component-list + live-reload store. Mount once. */
export function GuiTreeStoreProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<GuiFolder>(EMPTY_TREE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // True once the FIRST load has resolved. After that, refreshes (external edits,
  // our own save echoing through the watcher) are background reconciles that must
  // NOT blank the list into the "Loading…" placeholder — doing so flashes the
  // whole panel on every save. Only the initial load, when there's nothing on
  // screen yet, is allowed to show the loading state.
  const loadedRef = useRef(false);

  const reload = useCallback(async (): Promise<GuiFolder | null> => {
    if (!loadedRef.current) setLoading(true);
    setError(null);
    try {
      const result = await invoke<GuiFolder>("get_gui_tree");
      setTree(result);
      loadedRef.current = true;
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the gui/ tree.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribe to external `gui/` edits; every change refreshes the list via reload.
  const live = useGuiLiveReload(reload);

  const store = useMemo<GuiTreeStore>(
    () => ({ tree, loading, error, reload, live }),
    [tree, loading, error, reload, live],
  );
  return <GuiTreeContext.Provider value={store}>{children}</GuiTreeContext.Provider>;
}

/** Access the shared tree + live-reload store. Must be under the provider. */
export function useGuiTreeStore(): GuiTreeStore {
  const store = useContext(GuiTreeContext);
  if (!store) {
    throw new Error("useGuiTreeStore must be used within a GuiTreeStoreProvider");
  }
  return store;
}
