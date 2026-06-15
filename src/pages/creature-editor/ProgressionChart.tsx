import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildProgression, type Creature, MAX_LEVEL } from "@/lib/creature";
import { CREATURE_STATS, STAT_META, statLabel } from "@/lib/stats";

// Three series: the creature's own curve, plus the population's average and max
// at each level as a balancing reference.
const CHART_CONFIG = {
  value: { label: "This creature", color: "var(--chart-1)" },
  average: { label: "Average", color: "var(--chart-2)" },
  max: { label: "Max", color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * Projects one stat across levels 1..MAX_LEVEL for the edited creature and plots
 * it against the population average and max, so growth can be balanced visually.
 * Reads live from the in-progress edit, so tweaking base/gain moves the line.
 *
 * The selected stat is optionally CONTROLLED: pass `stat` + `onStatChange` to
 * drive it from outside (e.g. focusing a stat box in the Workbench). Left
 * uncontrolled (no `stat`), it manages its own selection, defaulting to the
 * first growing stat.
 */
export function ProgressionChart({
  creature,
  population,
  stat: statProp,
  onStatChange,
}: {
  creature: Creature;
  population: Creature[];
  /** Controlled selection. null/undefined ⇒ the chart picks its own default. */
  stat?: string | null;
  onStatChange?: (stat: string) => void;
}) {
  // Default to the stat that actually grows, falling back to attack. Used only
  // while uncontrolled (or before a controlled value is set).
  const [fallback, setFallback] = useState<string>(() => {
    const growing = CREATURE_STATS.find((s) => (creature.statGainsPerLevel[s] ?? 0) > 0);
    return growing ?? "attack";
  });
  const stat = statProp != null && statProp.length > 0 ? statProp : fallback;
  const setStat = (next: string) => {
    if (onStatChange) onStatChange(next);
    else setFallback(next);
  };

  const data = useMemo(
    () => buildProgression(creature, population, stat),
    [creature, population, stat],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select value={stat} onValueChange={setStat}>
          {/* SelectValue mirrors the chosen item (icon + label), so the trigger
              needs no icon of its own. */}
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREATURE_STATS.map((s) => {
              const SIcon = STAT_META[s]?.Icon;
              return (
                <SelectItem key={s} value={s}>
                  <span className="flex items-center gap-2">
                    {SIcon && <SIcon className={STAT_META[s]?.color} />}
                    {statLabel(s)}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <ChartContainer config={CHART_CONFIG} className="h-72 w-full">
        <LineChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="level"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            ticks={[1, 5, 10, 15, 20, MAX_LEVEL]}
            label={{ value: "Level", position: "insideBottom", offset: -4 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                // shadcn derives the header from the first series' config, so use
                // the raw datum to show the actual level being hovered.
                labelFormatter={(_, payload) => `Level ${payload?.[0]?.payload?.level ?? ""}`}
                // Re-render each row with its series color + a rounded value
                // (the default formatter would print raw, sometimes-fractional averages).
                formatter={(value, name) => {
                  const n = typeof value === "number" ? value : Number(value);
                  const label = CHART_CONFIG[name as keyof typeof CHART_CONFIG]?.label ?? name;
                  return (
                    <span className="flex w-full items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: `var(--color-${name})` }}
                      />
                      <span className="flex-1 text-muted-foreground">{label}</span>
                      <span className="font-medium font-mono text-foreground tabular-nums">
                        {Math.round(n).toLocaleString()}
                      </span>
                    </span>
                  );
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="max"
            type="monotone"
            stroke="var(--color-max)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
          />
          <Line
            dataKey="average"
            type="monotone"
            stroke="var(--color-average)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2.5}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

export default ProgressionChart;
