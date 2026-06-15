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
import { useCreatureDraft } from "@/lib/useCreatureDraft";
import type { AbilityOption } from "@/pages/creature-editor/AbilityPicker";
import { useSaveTarget } from "./saveBus";

type Ability = { id: string; name: string };

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

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setActiveStat(null);
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

  // Advance the baseline to the just-saved draft so `saved` follows and `dirty`
  // clears, and keep the population copy in sync so the chart's avg/max reflect
  // the saved values.
  const onSaved = useCallback((savedDraft: Creature) => {
    setSaved(savedDraft);
    setPopulation((prev) => prev.map((c) => (c.id === savedDraft.id ? savedDraft : c)));
  }, []);

  const { draft, setDraft, dirty, saving, saveError, save } = useCreatureDraft(saved, onSaved);

  // Ref-stable save so the bus re-registers only on dirty toggle, not every
  // keystroke — same discipline as ScriptPane/DataPane.
  const saveRef = useRef(save);
  saveRef.current = save;
  const stableSave = useCallback(() => saveRef.current(), []);

  useSaveTarget({
    id: "data",
    order: 0, // DATA saves run BEFORE the script (order 10).
    dirty,
    save: stableSave,
  });

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
