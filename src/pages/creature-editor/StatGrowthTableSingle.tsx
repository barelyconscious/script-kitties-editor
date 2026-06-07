import { IntegerInput } from "@/components/IntegerInput";
import { type Creature, MAX_LEVEL, projectStat } from "@/lib/creature";
import { CREATURE_STATS, STAT_META } from "@/lib/stats";
import { cn } from "@/lib/utils";

/**
 * Single-column variant of {@link StatGrowthTable} for NARROW containers — the
 * Workbench's fixed-width creature DATA pane, where the standalone editor's
 * two-up split (`lg:grid-cols-2`, keyed to viewport width, not pane width) would
 * cram two tables into ~210px each and squish every row.
 *
 * Deliberately duplicated rather than parameterized: a single full-width table
 * reads cleanly here without threading a layout flag through the shared
 * component. The row contents (base / gain / @max) stay identical to the
 * two-column table so the two surfaces feel the same.
 */
export function StatGrowthTableSingle({
  creature,
  onChange,
  disabled,
}: {
  creature: Creature;
  onChange: (next: Creature) => void;
  disabled?: boolean;
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

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
            <th className="px-3 py-2 text-left font-medium">Stat</th>
            <th className="px-2 py-2 text-right font-medium">Base</th>
            <th className="px-2 py-2 text-right font-medium">Gain / level</th>
            <th className="px-3 py-2 text-right font-medium">@ Lv {MAX_LEVEL}</th>
          </tr>
        </thead>
        <tbody>
          {CREATURE_STATS.map((stat) => {
            const meta = STAT_META[stat];
            const Icon = meta?.Icon;
            const base = creature.baseStats[stat] ?? 0;
            const gain = creature.statGainsPerLevel[stat] ?? 0;
            const atMax = projectStat(base, gain, MAX_LEVEL);
            return (
              <tr key={stat} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    {Icon && <Icon className={cn("size-4 shrink-0", meta.color)} />}
                    <span>{meta?.label ?? stat}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <IntegerInput
                    value={base}
                    min={0}
                    onValue={(n) => setBase(stat, n)}
                    disabled={disabled}
                    className="ml-auto h-8 w-20 text-right"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <IntegerInput
                    value={gain}
                    min={0}
                    onValue={(n) => setGain(stat, n)}
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
                  {atMax.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default StatGrowthTableSingle;
