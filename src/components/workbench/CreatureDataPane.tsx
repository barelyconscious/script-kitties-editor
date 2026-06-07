import { invoke } from "@tauri-apps/api/core";
import { FileWarning, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Creature, loadCreatures, populationWithDraft } from "@/lib/creature";
import { useCreatureDraft } from "@/lib/useCreatureDraft";
import type { AbilityOption } from "@/pages/creature-editor/AbilityPicker";
import { CreatureForm } from "@/pages/creature-editor/CreatureForm";
import { CreatureIdentityFields } from "@/pages/creature-editor/CreatureIdentityFields";
import { useSaveTarget } from "./saveBus";

type Ability = { id: string; name: string };

/**
 * The DATA pane for a CREATURE tab: embeds the SAME {@link CreatureForm} the
 * standalone Creature Editor uses (stat grids, per-level unlocks, base
 * abilities) and plugs it into the per-tab save bus via the lifted
 * {@link useCreatureDraft} hook. The Workbench is the code-and-data lens, so
 * this pane passes `showProgressionChart={false}` — the balance chart belongs
 * to the standalone Creature Editor, not here.
 *
 * One source of truth: there is NO bespoke field editor and NO second
 * normalization path here — the zero-stripping save lives only in
 * `saveCreature` (called inside the hook). Editing marks the bus's "data"
 * target dirty; saving routes through that same path and advances the local
 * baseline so dirty clears.
 */
export interface CreatureDataPaneProps {
  /** Primary key of the creature being edited. */
  id: string;
}

export function CreatureDataPane({ id }: CreatureDataPaneProps) {
  // Remount on id change so the draft/baseline state never leaks across tabs.
  return <CreatureDataEditor key={id} id={id} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "loaded" };

function CreatureDataEditor({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // The full population is needed for the chart's avg/max; abilities for the
  // pickers. `saved` is THIS creature's persisted baseline (single-creature
  // state) — onSaved replaces it so dirty clears post-save.
  const [population, setPopulation] = useState<Creature[]>([]);
  const [abilities, setAbilities] = useState<AbilityOption[]>([]);
  const [saved, setSaved] = useState<Creature | null>(null);

  // Load all creatures (for the chart population) + abilities (for the pickers),
  // then select this creature by id as the baseline.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([loadCreatures(), invoke<Ability[]>("get_abilities")])
      .then(([creatures, abil]) => {
        if (cancelled) return;
        const found = creatures.find((c) => c.id === id) ?? null;
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        setPopulation(creatures);
        setAbilities(abil.map((a) => ({ id: a.id, name: a.name })));
        setSaved(found);
        setState({ kind: "loaded" });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Advance the local baseline to the just-saved draft so `saved` follows and
  // `dirty` clears — exactly how CreatureEditor advances its list, but for a
  // single creature. Also keep the population copy in sync so the chart's
  // avg/max reflect the saved values.
  const onSaved = useCallback((savedDraft: Creature) => {
    setSaved(savedDraft);
    setPopulation((prev) => prev.map((c) => (c.id === savedDraft.id ? savedDraft : c)));
  }, []);

  const { draft, setDraft, dirty, saving, saveError, save } = useCreatureDraft(saved, onSaved);

  // Ref so the bus `save` closure reads the latest hook `save` without being
  // recreated each render. The hook's `save` identity changes every render, so
  // a ref-stable wrapper keeps the bus re-registering only on dirty toggle —
  // same discipline as ScriptPane/DataPane.
  const saveRef = useRef(save);
  saveRef.current = save;
  const stableSave = useCallback(() => saveRef.current(), []);

  useSaveTarget({
    id: "data",
    order: 0, // DATA saves run BEFORE the script (order 10).
    dirty,
    save: stableSave,
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
        <span className="font-medium text-foreground">Could not load this creature.</span>
        <span className="text-xs">{state.message}</span>
      </PaneStatus>
    );
  }
  if (state.kind === "notFound" || !draft) {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span>No creature found for “{id}”.</span>
      </PaneStatus>
    );
  }

  // Scroll + padding are owned by the enclosing Pane (it wraps children in an
  // `overflow-auto p-3` region), so this pane only lays out its own content.
  return (
    <div className="flex flex-col gap-3">
      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-destructive text-sm">
          {saveError}
        </div>
      )}
      <div className="flex flex-col gap-8">
        {/* Identity section, matching CreatureForm's Section heading style so it
            reads as the first section, then stats/growth/abilities follow. */}
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="font-medium text-sm">Details</h3>
            <p className="text-muted-foreground text-xs">
              Name, sprite, and description. The script pointer lives in the SCRIPT pane.
            </p>
          </div>
          <CreatureIdentityFields creature={draft} onChange={setDraft} disabled={saving} />
        </section>

        <CreatureForm
          creature={draft}
          population={populationWithDraft(population, draft)}
          abilityOptions={abilities}
          onChange={setDraft}
          disabled={saving}
          showProgressionChart={false}
        />
      </div>
    </div>
  );
}

function PaneStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export default CreatureDataPane;
