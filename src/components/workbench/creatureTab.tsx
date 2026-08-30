import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Creature, loadCreatures } from "@/lib/creature";
import { type EntityKind, useEntityVersions } from "@/lib/entities/dataVersion";
import { fetchDataMtimeSig } from "@/lib/entities/diskMtime";
import { useCreatureDraft } from "@/lib/useCreatureDraft";
import type { AbilityOption } from "@/pages/creature-editor/AbilityPicker";
import { useConflictPrompt } from "./ConflictDialog";
import { guardedWrite, SaveCancelled } from "./diskGuard";
import { useSaveTarget } from "./saveBus";
import { useUndoTarget } from "./undo";

type Ability = { id: string; name: string };

// The creature tab reads two domains: the creature population (this creature +
// the chart's avg/max) and the ability list (the pickers). A bump of either —
// an in-app save elsewhere or an external disk edit routed through
// `data-changed` — re-fetches both. Module scope = stable reference.
const CREATURE_TAB_KINDS: readonly EntityKind[] = ["creatures", "abilities"];

// The draft's conflict source is ONLY the creatures file — abilities are read for
// the pickers but aren't part of this tab's draft, so the save guard watches just
// this file's mtime.
const CREATURE_FILE_KINDS: readonly EntityKind[] = ["creatures"];

export type CreatureTabLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "loaded" };

/**
 * Everything a creature tab's panes share. Both the Data pane (which edits) and
 * the Stats-graph pane (which reads) consume this, so the chart reflects the live
 * draft as you type and the focused stat box drives the chart's selection.
 */
interface CreatureTabValue {
  state: CreatureTabLoadState;
  /** The live, possibly-unsaved creature. null until loaded. */
  draft: Creature | null;
  setDraft: (next: Creature) => void;
  /** The whole population, for the chart's average/max. */
  population: Creature[];
  abilities: AbilityOption[];
  saving: boolean;
  saveError: string | null;
  /** Which stat the chart shows; null = let the chart pick a sensible default. */
  activeStat: string | null;
  setActiveStat: (stat: string) => void;
}

const CreatureTabContext = createContext<CreatureTabValue | null>(null);

export function useCreatureTab(): CreatureTabValue {
  const ctx = useContext(CreatureTabContext);
  if (!ctx) throw new Error("useCreatureTab must be used within a CreatureTabProvider");
  return ctx;
}

/**
 * Owns a creature tab's edit state and shares it with both panes. Lifted out of
 * the Data pane so the always-mounted provider (not the toggle-able Data pane)
 * holds the draft — the chart can read it live, and the draft + the "data" save
 * target survive hiding the Data pane or flipping to the chart view.
 */
export function CreatureTabProvider({ id, children }: { id: string; children: ReactNode }) {
  const [state, setState] = useState<CreatureTabLoadState>({ kind: "loading" });
  // The full population drives the chart's avg/max; abilities feed the pickers.
  // `saved` is THIS creature's persisted baseline — onSaved replaces it so dirty
  // clears post-save.
  const [population, setPopulation] = useState<Creature[]>([]);
  const [abilities, setAbilities] = useState<AbilityOption[]>([]);
  const [saved, setSaved] = useState<Creature | null>(null);
  // The chart's stat, driven by focusing a stat box (or the chart's own select).
  // Reset when the creature changes so a stale stat doesn't carry across tabs.
  const [activeStat, setActiveStat] = useState<string | null>(null);
  // The mtime signature of creatures.json as of the last disk read (load, save,
  // or clean adopt). The save guard compares the current on-disk signature to
  // this to detect an external edit before clobbering (see diskGuard).
  const mtimeSigRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setActiveStat(null);
    Promise.all([
      loadCreatures(),
      invoke<Ability[]>("get_abilities"),
      fetchDataMtimeSig(CREATURE_FILE_KINDS),
    ])
      .then(([creatures, abil, sig]) => {
        if (cancelled) return;
        const found = creatures.find((c) => c.id === id) ?? null;
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        mtimeSigRef.current = sig;
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

  // Advance the baseline to the just-saved draft so `saved` follows and `dirty`
  // clears, and keep the population copy in sync so the chart's avg/max reflect
  // the saved values.
  const onSaved = useCallback((savedDraft: Creature) => {
    setSaved(savedDraft);
    setPopulation((prev) => prev.map((c) => (c.id === savedDraft.id ? savedDraft : c)));
  }, []);

  const {
    draft,
    setDraft,
    dirty,
    saving,
    saveError,
    save,
    revert,
    undo,
    redo,
    canUndo,
    canRedo,
    commitHistory,
  } = useCreatureDraft(saved, onSaved);

  // Live-reload: when either domain bumps (an in-app save elsewhere or an external
  // disk edit routed through `data-changed`), refresh the population + pickers and
  // reconcile THIS creature via the creatures-file mtime — the single conflict
  // signal. Equal signature ⇒ our own save echo / no real change. Changed while we
  // have unsaved edits ⇒ leave it; the save guard surfaces the conflict on Save.
  // Changed while clean ⇒ adopt the disk truth. The mount run is skipped — the
  // load effect owns the first fetch and the loading state.
  const version = useEntityVersions(CREATURE_TAB_KINDS);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Adopting an external change must RE-SEED the draft: useCreatureDraft only
  // reseeds on an id change (so post-save baseline advances preserve history),
  // so the adopt path raises this flag and the effect below runs one revert()
  // against the just-advanced baseline.
  const pendingAdopt = useRef(false);
  const didInitialLoad = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the re-fetch trigger, not read in the body.
  useEffect(() => {
    if (!didInitialLoad.current) {
      didInitialLoad.current = true;
      return;
    }
    let cancelled = false;
    Promise.all([
      loadCreatures(),
      invoke<Ability[]>("get_abilities"),
      fetchDataMtimeSig(CREATURE_FILE_KINDS),
    ])
      .then(([creatures, abil, sig]) => {
        if (cancelled) return;
        // The pickers and the chart's population always follow the fresh data —
        // they aren't part of this tab's draft, so no reconcile is needed.
        setPopulation(creatures);
        setAbilities(abil.map((a) => ({ id: a.id, name: a.name })));
        if (sig === mtimeSigRef.current) return; // own-save echo / nothing changed
        if (dirtyRef.current) return; // unsaved edits: defer the conflict to save time
        // Clean + external change → adopt the disk truth for THIS creature.
        const found = creatures.find((c) => c.id === id) ?? null;
        mtimeSigRef.current = sig;
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        pendingAdopt.current = true;
        setSaved(found);
        setState({ kind: "loaded" }); // recovers a previously-notFound tab too
      })
      // A transient refresh error keeps the current data — the load effect owns
      // the pane's error state.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version, id]);

  // The revert half of the adopt dance above: once setSaved has advanced the
  // baseline, one revert() re-seeds the draft (dropping undo history) to it.
  // Keyed on `saved` so it runs in the render where the new baseline is live.
  const revertRef = useRef(revert);
  revertRef.current = revert;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `saved` is the re-run trigger — the revert must fire in the render where the adopted baseline is live, even though the body reads it via refs.
  useEffect(() => {
    if (!pendingAdopt.current) return;
    pendingAdopt.current = false;
    revertRef.current();
  }, [saved]);

  // Manual save behind the disk-change guard: re-check the creatures-file mtime
  // and, if it moved since load, prompt Reload/Overwrite/Cancel before writing.
  // The write itself is useCreatureDraft's `save` (normalize + persist + advance
  // the baseline); read via a ref so this callback stays stable per keystroke.
  const confirmConflict = useConflictPrompt();
  const saveRef = useRef(save);
  saveRef.current = save;
  const guardedSave = useCallback(async () => {
    const outcome = await guardedWrite({
      capturedSig: mtimeSigRef.current,
      fetchSig: () => fetchDataMtimeSig(CREATURE_FILE_KINDS),
      confirmConflict: () => confirmConflict(id),
      reload: async () => {
        const [creatures, sig] = await Promise.all([
          loadCreatures(),
          fetchDataMtimeSig(CREATURE_FILE_KINDS),
        ]);
        const found = creatures.find((c) => c.id === id) ?? null;
        mtimeSigRef.current = sig;
        setPopulation(creatures);
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        pendingAdopt.current = true;
        setSaved(found);
        setState({ kind: "loaded" });
      },
      write: () => saveRef.current(),
    });
    if (outcome.kind === "written") mtimeSigRef.current = outcome.sig;
    else if (outcome.kind === "cancelled") throw new SaveCancelled();
  }, [confirmConflict, id]);
  useSaveTarget({
    id: "data",
    order: 0, // DATA saves run BEFORE the script (order 10).
    dirty,
    save: guardedSave,
  });

  // Undo/redo for the creature draft (Ctrl+Z), driven from the tab.
  useUndoTarget({ undo, redo, canUndo, canRedo, commit: commitHistory });

  // Recreated each render on purpose: the draft changes every keystroke and we
  // WANT the consuming panes (chart especially) to re-render with it.
  const value: CreatureTabValue = {
    state,
    draft,
    setDraft,
    population,
    abilities,
    saving,
    saveError,
    activeStat,
    setActiveStat,
  };

  return <CreatureTabContext.Provider value={value}>{children}</CreatureTabContext.Provider>;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
