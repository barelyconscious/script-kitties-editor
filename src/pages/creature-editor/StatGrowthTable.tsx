import { DecimalInput } from "@/components/DecimalInput";
import { type Creature, MAX_LEVEL, projectStat } from "@/lib/creature";
import { CREATURE_STATS, STAT_META } from "@/lib/stats";
import { cn } from "@/lib/utils";

/** Format a projected stat, trimming float noise to at most 2 decimals. */
function formatStat(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * The creature's stat block and per-level growth, side by side. Each row is a
 * stat: its base (level 1) value, its per-level gain, and a live preview of
 * where it lands at MAX_LEVEL — so a designer can feel the growth while tuning.
 *
 * When there's room the 15 stats split into two side-by-side tables so the grid
 * isn't a tall, mostly-empty column. The split is driven by a CONTAINER query
 * (not a viewport breakpoint), so it reacts to the space this grid actually has —
 * opening the Workbench's object-list or data panes narrows the pane and the
 * grid correctly collapses back to one column instead of cramming two.
 *
 * When `onStatSelect` is supplied, a row is also a SELECTION target: clicking
 * anywhere on it (or focusing one of its inputs) reports the stat up, and the
 * row matching `activeStat` highlights. The Workbench's Stats-graph pane uses
 * this to keep the plotted stat in sync with the row you're working on.
 */
export function StatGrowthTable({
  creature,
  onChange,
  disabled,
  activeStat,
  onStatSelect,
}: {
  creature: Creature;
  onChange: (next: Creature) => void;
  disabled?: boolean;
  /** The currently-plotted stat, highlighted in the grid. Omit for no selection. */
  activeStat?: string | null;
  /**
   * Called with a stat key when its row is clicked or one of its inputs is
   * focused. When omitted, rows are not selectable (the standalone editor's
   * plain grid). When present, rows become clickable selection targets.
   */
  onStatSelect?: (stat: string) => void;
}) {
  function setBase(stat: string, n: number) {
    onChange({ ...creature, baseStats: { ...creature.baseStats, [stat]: n } });
  }

  function setGain(stat: string, n: number) {
    onChange({
      ...creature,
      statGainsPerLevel: { ...creature.statGainsPerLevel, [stat]: n },
    });
  }

  const selectable = onStatSelect != null;

  // Split the two columns at the first element stat, so the left column is the
  // core stats and the right column leads with Fire Damage (the element block).
  const split = CREATURE_STATS.indexOf("fireDamage");
  const columns = [CREATURE_STATS.slice(0, split), CREATURE_STATS.slice(split)];

  return (
    // @container establishes the measuring context; the inner grid's @3xl
    // variant (≥48rem of CONTAINER width) is what splits to two columns — so a
    // narrow pane stays single-column no matter the window size.
    <div className="@container">
      <div className="grid @3xl:grid-cols-2 gap-4">
        {columns.map((stats) => (
          <div key={stats[0]} className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
                  <th className="px-3 py-2 text-left font-medium">Stat</th>
                  <th className="px-3 py-2 text-right font-medium">Base</th>
                  <th className="px-3 py-2 text-right font-medium">Gain / level</th>
                  <th className="px-3 py-2 text-right font-medium">@ Lv {MAX_LEVEL}</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat) => {
                  const meta = STAT_META[stat];
                  const Icon = meta?.Icon;
                  const base = creature.baseStats[stat] ?? 0;
                  const gain = creature.statGainsPerLevel[stat] ?? 0;
                  const atMax = projectStat(base, gain, MAX_LEVEL);
                  const active = selectable && activeStat === stat;
                  return (
                    // Row selection is a mouse convenience; the same stat is reported
                    // via the inputs' onFocus below, which IS keyboard-reachable, so
                    // the row click needs no separate key handler.
                    <tr
                      key={stat}
                      onClick={selectable ? () => onStatSelect(stat) : undefined}
                      className={cn(
                        "border-b last:border-b-0",
                        selectable && "cursor-pointer",
                        active ? "bg-primary/10" : "hover:bg-muted/30",
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-2">
                          {Icon && <Icon className={cn("size-4 shrink-0", meta.color)} />}
                          <span className={cn(active && "font-medium text-foreground")}>
                            {meta?.label ?? stat}
                          </span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <DecimalInput
                          value={base}
                          min={0}
                          onValue={(n) => setBase(stat, n)}
                          onFocus={selectable ? () => onStatSelect(stat) : undefined}
                          disabled={disabled}
                          className="ml-auto h-8 w-20 text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <DecimalInput
                          value={gain}
                          min={0}
                          onValue={(n) => setGain(stat, n)}
                          onFocus={selectable ? () => onStatSelect(stat) : undefined}
                          disabled={disabled}
                          className="ml-auto h-8 w-20 text-right"
                        />
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right tabular-nums",
                          gain > 0 ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {formatStat(atMax)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StatGrowthTable;
