import { useEffect, useRef, useState } from "react";
import { type Creature, sameCreature, saveCreature } from "@/lib/creature";

/**
 * Controlled draft/save mechanic for a single creature, factored out of
 * `CreatureEditor` so the Workbench can own it for a creature tab. The parent
 * holds the baseline (the persisted creature, controlled via `saved`); the hook
 * holds the working `draft` and the transient save state.
 *
 * On a successful save the hook calls `onSaved(draft)` with the *un-normalized*
 * draft. The parent advances its baseline (its creature list) to that value, so
 * `saved` follows and `dirty` clears. The zero-stripping normalization is NOT
 * duplicated here — it lives only in `saveCreature` (`creature.ts`), which is the
 * single source of truth. As a result `dirty` is always compared against the
 * un-normalized draft, exactly as the standalone editor did.
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
  const [draft, setDraft] = useState<Creature | null>(saved);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seed the draft when the *selection* changes (a different creature, or
  // selecting/clearing). Advancing the baseline to the just-saved draft keeps the
  // same id, so this does not clobber in-progress edits after a save.
  const seededId = useRef<string | null>(saved?.id ?? null);
  if ((saved?.id ?? null) !== seededId.current) {
    seededId.current = saved?.id ?? null;
    setDraft(saved);
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
      // advancing the parent's baseline to the un-normalized draft — identical to
      // the standalone editor's post-save list update.
      onSavedRef.current(draft);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    setDraft(saved);
    setSaveError(null);
  }

  return { draft, setDraft, dirty, saving, saveError, save, revert };
}
