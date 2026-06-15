import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo history for a single controlled value (e.g. an editor draft).
 *
 * Edits go through {@link History.set}; they COALESCE into one undo step until a
 * boundary — either {@link History.commit} (call it on blur) or `coalesceMs` of
 * idle. So a burst of typing or number-scrubbing collapses to one Ctrl+Z, but
 * switching fields starts a fresh step. {@link History.reset} re-seeds without
 * history (on load / selection change). History is independent of any save
 * baseline, so it survives auto-saves.
 */
export type History<T> = {
  /** The live value to render/edit. */
  value: T;
  /** Record an edit (coalesced into the current step). */
  set: (next: T) => void;
  /** Close the current edit step so the next edit starts a new one (e.g. on blur). */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Re-seed the value and drop all history (load / selection change). */
  reset: (value: T) => void;
};

export function useHistoryState<T>(initial: T, opts?: { coalesceMs?: number }): History<T> {
  const coalesceMs = opts?.coalesceMs ?? 400;

  const [present, setPresent] = useState<T>(initial);
  const presentRef = useRef<T>(initial);
  presentRef.current = present;

  // `committed` = the value at the current step boundary (where undo/redo sit).
  // `past`/`future` hold the boundary snapshots on either side.
  const committedRef = useRef<T>(initial);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const sync = useCallback(() => {
    setCanUndo(pastRef.current.length > 0 || !Object.is(presentRef.current, committedRef.current));
    setCanRedo(futureRef.current.length > 0);
  }, []);

  // Promote the current uncommitted edit to a discrete undo step.
  const commit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (Object.is(presentRef.current, committedRef.current)) return;
    pastRef.current.push(committedRef.current);
    committedRef.current = presentRef.current;
    futureRef.current = [];
    sync();
  }, [sync]);

  const set = useCallback(
    (next: T) => {
      presentRef.current = next;
      setPresent(next);
      futureRef.current = []; // a fresh edit invalidates redo
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => commit(), coalesceMs);
      sync();
    },
    [coalesceMs, commit, sync],
  );

  const undo = useCallback(() => {
    commit(); // capture the in-progress edit as a step first
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current.pop() as T;
    futureRef.current.push(committedRef.current);
    committedRef.current = prev;
    presentRef.current = prev;
    setPresent(prev);
    sync();
  }, [commit, sync]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop() as T;
    pastRef.current.push(committedRef.current);
    committedRef.current = next;
    presentRef.current = next;
    setPresent(next);
    sync();
  }, [sync]);

  const reset = useCallback((value: T) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pastRef.current = [];
    futureRef.current = [];
    committedRef.current = value;
    presentRef.current = value;
    setPresent(value);
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return { value: present, set, commit, undo, redo, canUndo, canRedo, reset };
}
