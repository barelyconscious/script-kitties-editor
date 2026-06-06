import { IntegerInput } from "@/components/IntegerInput";
import { type Creature, MAX_LEVEL, projectStat } from "@/lib/creature";
import { CREATURE_STATS, STAT_META } from "@/lib/stats";
import { cn } from "@/lib/utils";

/**
 * The creature's stat block and per-level growth, side by side. Each row is a
 * stat: its base (level 1) value, its per-level gain, and a live preview of
 * where it lands at MAX_LEVEL — so a designer can feel the growth while tuning.
 *
 * On wide screens the 15 stats split into two side-by-side tables so the grid
 * isn't a tall, mostly-empty column.
 */
export function StatGrowthTable({
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

  // Split the two columns at the first element stat, so the left column is the
  // core stats and the right column leads with Fire Damage (the element block).
  const split = CREATURE_STATS.indexOf("fireDamage");
  const columns = [CREATURE_STATS.slice(0, split), CREATURE_STATS.slice(split)];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
      ))}
    </div>
  );
}

export default StatGrowthTable;
