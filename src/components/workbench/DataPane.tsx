import { FileWarning, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EntityFieldsForm } from "@/components/data-tables/EntityFieldsForm";
import { useAutoSave } from "./autoSave";
import { type DataDescriptor, dataDescriptorFor, selectById } from "./dataRegistry";
import type { GameObjectType } from "./gameObjects";
import { useSaveTarget } from "./saveBus";

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
  // Baseline from disk + the working draft. Both meaningful only when loaded.
  const [loaded, setLoaded] = useState<{ id: string } | null>(null);
  const [draft, setDraft] = useState<{ id: string } | null>(null);

  // SECOND FETCH: pull the full per-domain records and select this one by id.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    descriptor
      .load()
      .then((records) => {
        if (cancelled) return;
        const record = selectById(records, id);
        if (!record) {
          setState({ kind: "notFound" });
          return;
        }
        setLoaded(record);
        setDraft(record);
        setState({ kind: "loaded" });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [descriptor, id]);

  const dirty = state.kind === "loaded" && draft != null && loaded != null && !equal(draft, loaded);

  // Ref so the bus `save` closure reads the latest draft without being recreated
  // on every keystroke (the bus re-registers a target when `save` identity
  // changes — see useSaveTarget deps). Same pattern as ScriptPane.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return; // nothing loaded → nothing to persist
    await descriptor.save(current);
    // Persist succeeded → the draft is the new baseline; clears dirty.
    setLoaded(current);
  }, [descriptor]);

  // Data auto-saves: register the debounced `flush` so the bus (⌘S / close) runs
  // the same guarded write, and it also persists on its own as you edit.
  const flush = useAutoSave({ draft, dirty, save });
  useSaveTarget({
    id: "data",
    order: 0, // DATA / pointer saves run BEFORE the script (order 10).
    dirty,
    save: flush,
    autoSave: true,
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

  return <EntityFieldsForm fields={descriptor.fields} value={draft} onChange={setDraft} fill />;
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
