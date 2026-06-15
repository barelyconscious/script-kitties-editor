import { createContext, useContext, useEffect } from "react";

/**
 * Per-tab UNDO registry. A tab has at most one data editor with an undo history;
 * it registers its handlers here so the tab can bind Ctrl+Z / Ctrl+Shift+Z (and
 * commit-on-blur) at one place, without lifting the draft out of the editor.
 *
 * Scripts are excluded on purpose — Monaco owns its own undo stack.
 */
export type UndoTarget = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Close the current edit step (called on blur within the tab). */
  commit: () => void;
};

export type UndoRegistry = {
  /** Set (or clear, with null) the tab's current undo target. */
  set: (target: UndoTarget | null) => void;
};

const UndoRegistryContext = createContext<UndoRegistry | null>(null);

export const UndoRegistryProvider = UndoRegistryContext.Provider;

/**
 * Editor-side hook: registers this editor's undo handlers with the tab while
 * mounted, and clears them on unmount. Pass stable `undo`/`redo`/`commit`
 * (useCallback) so re-registration only tracks the canUndo/canRedo flags.
 */
export function useUndoTarget(target: UndoTarget): void {
  const registry = useContext(UndoRegistryContext);
  const { undo, redo, canUndo, canRedo, commit } = target;
  useEffect(() => {
    if (!registry) return;
    registry.set({ undo, redo, canUndo, canRedo, commit });
    return () => registry.set(null);
  }, [registry, undo, redo, canUndo, canRedo, commit]);
}
