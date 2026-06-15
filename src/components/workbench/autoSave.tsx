import { createContext, useCallback, useContext, useEffect, useRef } from "react";

/**
 * AUTO-SAVE for DATA targets.
 *
 * Data panes persist themselves: an edit schedules a debounced write, so there's
 * no manual Save for data (only scripts keep a button). A pane calls
 * {@link useAutoSave} with its draft + dirty + raw save and registers the
 * returned `flush` as its save-bus target — so the tab's ⌘S / close-flush runs
 * the SAME guarded write, never a second concurrent one.
 *
 * The owning tab supplies an {@link AutoSaveController} via context for the
 * debounce delay, a lifecycle report (for the quiet "Saving…/Saved" indicator),
 * and a post-save hook (to refresh the object list). Used outside a controller,
 * the hook still works with sane defaults.
 */
export type AutoSaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export type AutoSaveController = {
  /** Debounce delay (ms) from the last edit before an auto-save fires. */
  delayMs: number;
  /** Report lifecycle so the tab can show a quiet indicator. */
  report: (status: AutoSaveStatus) => void;
  /** Called after a successful auto-save so the shell can refresh the list. */
  onSaved: () => void;
};

const AutoSaveControllerContext = createContext<AutoSaveController | null>(null);

export const AutoSaveControllerProvider = AutoSaveControllerContext.Provider;

const DEFAULT_DELAY_MS = 700;

/**
 * Debounced, self-coalescing auto-save for one data target. Returns a guarded
 * `flush` that saves immediately (used by the bus for ⌘S / close); the hook also
 * arms a trailing-debounce timer on every draft change while dirty.
 *
 * The guard guarantees at most one save runs at a time, and re-runs once more if
 * the draft changed mid-save — so a fast typist never races two writes or drops
 * the last edit.
 */
export function useAutoSave({
  draft,
  dirty,
  save,
}: {
  /** The live draft — the debounce re-arms whenever this changes. */
  draft: unknown;
  dirty: boolean;
  /** The raw persist. Identity may change per render; read via ref. */
  save: () => Promise<void>;
}): () => Promise<void> {
  const controller = useContext(AutoSaveControllerContext);
  const delayMs = controller?.delayMs ?? DEFAULT_DELAY_MS;

  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const reportRef = useRef(controller?.report);
  reportRef.current = controller?.report;
  const onSavedRef = useRef(controller?.onSaved);
  onSavedRef.current = controller?.onSaved;

  // saving = a write is in flight; rerun = the draft changed during that write,
  // so loop once more to persist the newer value.
  const savingRef = useRef(false);
  const rerunRef = useRef(false);

  const flush = useCallback(async () => {
    if (savingRef.current) {
      rerunRef.current = true;
      return;
    }
    if (!dirtyRef.current) return;

    savingRef.current = true;
    reportRef.current?.({ kind: "saving" });
    let lastError: string | null = null;
    do {
      rerunRef.current = false;
      try {
        await saveRef.current();
        lastError = null;
      } catch (err) {
        lastError = errorMessage(err);
      }
      // Keep going only if a new edit landed mid-save AND it left us dirty.
    } while (rerunRef.current && dirtyRef.current);
    savingRef.current = false;

    if (lastError) {
      reportRef.current?.({ kind: "error", message: lastError });
    } else {
      reportRef.current?.({ kind: "saved" });
      onSavedRef.current?.();
    }
  }, []);

  // Trailing debounce: each edit (draft change) re-arms the timer; it fires the
  // guarded flush once edits pause for `delayMs`. A clean target arms nothing.
  // `draft` is the re-arm trigger (a new value each edit); `flush` is stable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft drives re-arm; flush is stable
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void flush();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [draft, dirty, delayMs]);

  // Flush a pending write on unmount (tab close, or hiding the data pane) so an
  // edit made in the last moments isn't dropped. Fire-and-forget: the invoke
  // outlives the unmounted component. `flush` is stable, so this runs only on
  // unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only; flush is stable
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void flush();
    };
  }, []);

  return flush;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
