import { FileWarning, Loader2 } from "lucide-react";
import { populationWithDraft } from "@/lib/creature";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { ProgressionChart } from "@/pages/creature-editor/ProgressionChart";
import { useCreatureTab } from "./creatureTab";

/** Coalesce a burst of stat scrubbing into one chart redraw (ms). */
const CHART_DEBOUNCE_MS = 150;

/**
 * The STATS-GRAPH view for a CREATURE tab — the alternate face of the center
 * region, toggled against the {@link ScriptPane} from the tab toolbar. It plots
 * this creature's projected growth against the population average/max (the same
 * {@link ProgressionChart} the standalone Creature Editor led with).
 *
 * A pure consumer of {@link CreatureTabProvider}: it reads the LIVE draft, so the
 * lines move as you edit stats in the Data pane (even unsaved), and it reads
 * `activeStat` so focusing a stat box switches the plotted stat. It owns no draft
 * and registers no save target — the editable surface is the Data pane.
 */
export function CreatureChartPane() {
  const { state, draft, population, activeStat, setActiveStat } = useCreatureTab();
  // Feed the chart a debounced draft so rapid scrubbing (held arrow key, scroll
  // wheel) coalesces into one Recharts redraw; the Data pane stays instant since
  // it reads the live draft directly. (Stat selection stays instant — it's a
  // single discrete action, not a burst.)
  const debouncedDraft = useDebouncedValue(draft, CHART_DEBOUNCE_MS);

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
        ) : state.kind === "notFound" || !draft ? (
          <PaneStatus>
            <FileWarning className="size-5 text-amber-500" />
            <span>This creature could not be found.</span>
          </PaneStatus>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-xs">
              Projected growth versus the average and max across all creatures — updates live as you
              edit stats.
            </p>
            <ProgressionChart
              creature={debouncedDraft ?? draft}
              population={populationWithDraft(population, debouncedDraft ?? draft)}
              stat={activeStat}
              onStatChange={setActiveStat}
            />
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

export default CreatureChartPane;
