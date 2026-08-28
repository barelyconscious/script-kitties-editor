import { FileWarning, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EntityFieldsForm } from "@/components/data-tables/EntityFieldsForm";
import { useEntityVersions } from "@/lib/entities/dataVersion";
import { fetchDataMtimeSig } from "@/lib/entities/diskMtime";
import { useHistoryState } from "@/lib/useHistoryState";
import { useConflictPrompt } from "./ConflictDialog";
import { type DataDescriptor, dataDescriptorFor, selectById } from "./dataRegistry";
import { guardedWrite, SaveCancelled } from "./diskGuard";
import type { GameObjectType } from "./gameObjects";
import { useSaveTarget } from "./saveBus";
import { useUndoTarget } from "./undo";

/**
 * The DATA pane for one Workbench tab: renders a non-creature object's
 * type-specific fields and plugs them into the per-tab save bus.
 *
 * `get_game_objects` is a LOSSY projection, so on open this pane does a SECOND
 * FETCH of the full per-domain record (via the type's descriptor `load`) and
 * finds it by id. Editing marks the bus's "data" target dirty; saving routes
 * through the type's `save` (the SAME function the Data Tables page uses, so
 * validation/normalization is identical) then advances the baseline.
 *
 * Creatures don't come through here — the Workbench routes them to the bespoke
 * creature panes (which share a draft via `CreatureTabProvider`) directly.
 */
export interface DataPaneProps {
  objectType: GameObjectType;
  /** Primary key of the object being edited, used to find it within `load()`. */
  id: string;
}

export function DataPane({ objectType, id }: DataPaneProps) {
  const descriptor = dataDescriptorFor(objectType);
  if (!descriptor) {
    // Any future descriptor-less, non-creature type lands here.
    return (
      <PaneStatus>
        <span>{objectType} has no editable data pane yet.</span>
      </PaneStatus>
    );
  }
  // The descriptor's identity is stable per objectType (module-level registry),
  // so a remount-on-type-change keyed pane keeps the editor logic generic-free.
  return <DataEditor key={`${objectType}:${id}`} descriptor={descriptor} id={id} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "loaded" };

function DataEditor({
  descriptor,
  id,
}: {
  descriptor: DataDescriptor<{ id: string }>;
  id: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Baseline from disk; the working draft + its undo history live in `history`.
  const [loaded, setLoaded] = useState<{ id: string } | null>(null);
  const history = useHistoryState<{ id: string } | null>(null);
  const draft = history.value;
  const reset = history.reset;

  // The mtime signature of this domain's file(s) as of the last disk read (load,
  // save, or clean adopt). The save guard compares the current on-disk signature
  // against this to detect an external edit before clobbering (see diskGuard).
  const mtimeSigRef = useRef<string | null>(null);

  // Read the full per-domain records + the file mtime signature from disk, select
  // this record by id, and reseat the baseline + draft to it (dropping history).
  // Shared by the initial load, the clean-adopt live-reload, and the conflict
  // "Reload" choice — one disk-truth path so they can't diverge.
  const seatFromDisk = useCallback(
    async (cancelled?: () => boolean) => {
      const [records, sig] = await Promise.all([
        descriptor.load(),
        fetchDataMtimeSig(descriptor.kinds),
      ]);
      if (cancelled?.()) return;
      const record = selectById(records, id);
      mtimeSigRef.current = sig;
      setLoaded(record);
      reset(record);
      setState(record ? { kind: "loaded" } : { kind: "notFound" });
    },
    [descriptor, id, reset],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    seatFromDisk(() => cancelled).catch((err) => {
      if (!cancelled) setState({ kind: "error", message: errorMessage(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [seatFromDisk]);

  const dirty = state.kind === "loaded" && draft != null && loaded != null && !equal(draft, loaded);

  // Live-reload: when this domain's version bumps (an in-app save elsewhere or an
  // external disk edit routed through `data-changed`), reconcile via the file
  // mtime — the single conflict signal. Equal signature ⇒ our own save echo or no
  // real change (ignore). Changed while we have unsaved edits ⇒ leave it; the
  // save guard will surface the conflict when the user actually saves. Changed
  // while clean ⇒ silently adopt the disk truth.
  const version = useEntityVersions(descriptor.kinds);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const didInitialLoad = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the re-fetch trigger, not read in the body.
  useEffect(() => {
    if (!didInitialLoad.current) {
      didInitialLoad.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      const sig = await fetchDataMtimeSig(descriptor.kinds);
      if (cancelled) return;
      if (sig === mtimeSigRef.current) return; // own-save echo / nothing changed
      if (dirtyRef.current) return; // unsaved edits: defer the conflict to save time
      await seatFromDisk(() => cancelled); // clean + external change → adopt
    })().catch(() => {}); // transient refresh error keeps the current record
    return () => {
      cancelled = true;
    };
  }, [version, descriptor, seatFromDisk]);

  // Ref so the bus `save` closure reads the latest draft without being recreated
  // on every keystroke (the bus re-registers a target when `save` identity
  // changes — see useSaveTarget deps). Same pattern as ScriptPane.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const confirmConflict = useConflictPrompt();

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return; // nothing loaded → nothing to persist
    const outcome = await guardedWrite({
      capturedSig: mtimeSigRef.current,
      fetchSig: () => fetchDataMtimeSig(descriptor.kinds),
      confirmConflict: () => confirmConflict(id),
      reload: () => seatFromDisk(),
      write: async () => {
        await descriptor.save(current);
        setLoaded(current); // draft is the new baseline; clears dirty
      },
    });
    if (outcome.kind === "written") mtimeSigRef.current = outcome.sig;
    else if (outcome.kind === "cancelled") throw new SaveCancelled();
  }, [descriptor, id, confirmConflict, seatFromDisk]);

  useSaveTarget({
    id: "data",
    order: 0, // DATA / pointer saves run BEFORE the script (order 10).
    dirty,
    save,
  });

  // Undo/redo for the data form (Ctrl+Z), driven from the tab.
  useUndoTarget({
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    commit: history.commit,
  });

  if (state.kind === "loading") {
    return (
      <PaneStatus>
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </PaneStatus>
    );
  }
  if (state.kind === "error") {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span className="font-medium text-foreground">Could not load this object.</span>
        <span className="text-xs">{state.message}</span>
      </PaneStatus>
    );
  }
  if (state.kind === "notFound" || !draft) {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span>No record found for “{id}”.</span>
      </PaneStatus>
    );
  }

  return <EntityFieldsForm fields={descriptor.fields} value={draft} onChange={history.set} fill />;
}

function PaneStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function equal<T extends object>(a: T, b: T): boolean {
  // Same cheap structural compare the edit dialog uses for dirty-tracking.
  return JSON.stringify(a) === JSON.stringify(b);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export default DataPane;
