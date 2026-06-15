import { useEffect, useRef, useState } from "react";
import { type Creature, sameCreature, saveCreature } from "@/lib/creature";
import { useHistoryState } from "@/lib/useHistoryState";

/**
 * Controlled draft/save mechanic for a single creature, used by the Workbench's
 * `CreatureTabProvider` to own a creature tab's edit state. The parent holds the
 * baseline (the persisted creature, controlled via `saved`); the hook holds the
 * working `draft`, its undo history, and the transient save state.
 *
 * The draft is backed by an undo history (`useHistoryState`) that's independent
 * of the save baseline, so undo/redo survive auto-saves. On a successful save the
 * hook calls `onSaved(draft)` with the *un-normalized* draft; the parent advances
 * its baseline so `saved` follows and `dirty` clears. Normalization lives only in
 * `saveCreature`, so `dirty` is always compared against the un-normalized draft.
 */
export type UseCreatureDraft = {
  /** The working copy. `null` when nothing is selected. */
  draft: Creature | null;
  /** Replace the working copy (the `onChange` the form expects). */
  setDraft: (creature: Creature) => void;
  /** True when the draft differs from the baseline (un-normalized compare). */
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  /** Persist the draft (with normalization) and advance the baseline via `onSaved`. */
  save: () => Promise<void>;
  /** Discard edits — reset the draft to the current baseline. */
  revert: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Close the current undo step (call on blur). */
  commitHistory: () => void;
};

export function useCreatureDraft(
  /** The persisted baseline, controlled by the parent. `null` when nothing is selected. */
  saved: Creature | null,
  /**
   * Called after a successful save with the un-normalized draft. The parent uses
   * this to advance its baseline (e.g. its creature list) so `saved` follows and
   * `dirty` clears — keeping the parent's store the single baseline.
   */
  onSaved: (savedDraft: Creature) => void,
): UseCreatureDraft {
  const history = useHistoryState<Creature | null>(saved);
  const draft = history.value;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seed the draft (dropping history) when the *selection* changes — a
  // different creature, or selecting/clearing. Done synchronously during render
  // (React's "adjust state on prop change" pattern) so the draft is never a frame
  // behind `saved` — an effect would flash "not found" between load and reseed.
  // Baseline advances after a save keep the same id, so this won't clobber
  // in-progress edits or undo history.
  const seededId = useRef<string | null>(saved?.id ?? null);
  if ((saved?.id ?? null) !== seededId.current) {
    seededId.current = saved?.id ?? null;
    history.reset(saved);
    setSaveError(null);
  }

  // Keep the latest onSaved without making `save` depend on its identity.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const dirty = !!draft && !!saved && !sameCreature(draft, saved);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveCreature(draft);
      // Reflect the persisted normalization (stripped zero gains) locally by
      // advancing the parent's baseline to the un-normalized draft.
      onSavedRef.current(draft);
    } catch (e) {
      // Set the local error for in-pane display, then RE-THROW so the save bus
      // records `ok: false` and partial failures never look like success.
      setSaveError(String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    history.reset(saved);
    setSaveError(null);
  }

  return {
    draft,
    setDraft: history.set,
    dirty,
    saving,
    saveError,
    save,
    revert,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    commitHistory: history.commit,
  };
}
