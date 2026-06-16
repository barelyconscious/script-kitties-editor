/**
 * useComponentSave — the React save hook (F11) that the Save button and the
 * warn-on-switch guard share, so the trust-critical persist path has ONE
 * implementation. It owns the in-flight / error UI state around
 * {@link saveOpenComponent} and the store's dirty discipline:
 *
 *  - `save()` serializes + persists the open component (XML + controller). On
 *    success it dispatches `markSaved` (clears dirty) and resolves `true`. On
 *    failure it records the error, leaves dirty SET, and resolves `false` —
 *    never throwing at the call site, so the component-switch guard can branch
 *    on the boolean without a try/catch (design risk #5).
 *  - `saving` gates the button (and the prompt's Save action) so a double-click
 *    can't fire two saves.
 *  - `error` / `clearError` surface a failed save inline.
 *
 * @see design/xgui_ta.md — section 7 "Saving".
 */

import { useCallback, useState } from "react";
import { useEditorStore } from "./editorState";
import { saveOpenComponent } from "./saveComponent";

export type ComponentSave = {
  /** True while a save is in flight. */
  saving: boolean;
  /** The last save error message, or `null`. */
  error: string | null;
  /** Dismiss a surfaced save error. */
  clearError: () => void;
  /**
   * Persist the open component. Resolves `true` on success (dirty cleared),
   * `false` on failure (dirty kept, `error` set). A no-op resolving `true` when
   * nothing is open. Never rejects — callers branch on the boolean.
   */
  save: () => Promise<boolean>;
};

export function useComponentSave(): ComponentSave {
  const { state, dispatch } = useEditorStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = state.open;

  const save = useCallback(async (): Promise<boolean> => {
    // Nothing open → nothing to persist. Treat as a trivially-successful save so
    // the switch guard never blocks on a phantom document.
    if (!open) return true;
    setSaving(true);
    setError(null);
    try {
      await saveOpenComponent(open);
      // Only clear dirty once the two-file save fully landed.
      dispatch({ type: "markSaved" });
      return true;
    } catch (err) {
      // KEEP dirty set (we do NOT dispatch markSaved) and surface the failure —
      // a half-written or failed save must keep looking unsaved (design risk #5).
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [open, dispatch]);

  const clearError = useCallback(() => setError(null), []);

  return { saving, error, clearError, save };
}
