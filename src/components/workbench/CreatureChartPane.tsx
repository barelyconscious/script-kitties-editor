import { FileWarning, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Creature, loadCreatures } from "@/lib/creature";
import { ProgressionChart } from "@/pages/creature-editor/ProgressionChart";

/**
 * The STATS-GRAPH view for a CREATURE tab — the alternate face of the center
 * region, toggled against the {@link ScriptPane} from the tab toolbar. It plots
 * this creature's projected growth against the population average/max (the same
 * {@link ProgressionChart} the standalone Creature Editor leads with).
 *
 * It owns no draft and registers no save target: the editable surface is the
 * Data pane (left). This pane loads the creature population from disk and is
 * mounted only while the chart is shown, so each switch-to-chart reflects the
 * latest SAVED values. (Unsaved edits in the Data pane aren't mirrored here —
 * the two panes hold independent state by design.)
 */
export interface CreatureChartPaneProps {
  /** Primary key of the creature being charted. */
  id: string;
}

export function CreatureChartPane({ id }: CreatureChartPaneProps) {
  // Remount on id change so the loaded population never leaks across tabs.
  return <CreatureChart key={id} id={id} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "loaded" };

function CreatureChart({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // The whole population drives the chart's average/max; `creature` is this one,
  // selected from it (so it's already part of the population — no draft to swap).
  const [population, setPopulation] = useState<Creature[]>([]);
  const [creature, setCreature] = useState<Creature | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadCreatures()
      .then((creatures) => {
        if (cancelled) return;
        const found = creatures.find((c) => c.id === id) ?? null;
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        setPopulation(creatures);
        setCreature(found);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b px-3 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Stats graph
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state.kind === "loading" ? (
          <PaneStatus>
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </PaneStatus>
        ) : state.kind === "error" ? (
          <PaneStatus>
            <FileWarning className="size-5 text-amber-500" />
            <span className="font-medium text-foreground">Could not load creatures.</span>
            <span className="text-xs">{state.message}</span>
          </PaneStatus>
        ) : state.kind === "notFound" || !creature ? (
          <PaneStatus>
            <FileWarning className="size-5 text-amber-500" />
            <span>No creature found for “{id}”.</span>
          </PaneStatus>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-xs">
              Projected growth versus the average and max across all creatures.
            </p>
            <ProgressionChart creature={creature} population={population} />
          </div>
        )}
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

export default CreatureChartPane;
