import { Sparkles } from "lucide-react";
import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import { Sprite } from "@/components/Sprite";
import { CHARM_FIELDS, type Charm, saveCharm } from "@/lib/entities/charms";
import { nonZeroStats, STAT_META, signed } from "@/lib/stats";
import { cn } from "@/lib/utils";

/** Compact icon badges for a charm's non-zero stats, e.g. "+3 ⚔  -1 🛡". */
function StatBadges({ stats }: { stats: Record<string, number> }) {
  const entries = nonZeroStats(stats);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-x-3 gap-y-1 whitespace-nowrap">
      {entries.map(([key, v]) => {
        const meta = STAT_META[key];
        const Icon = meta?.Icon ?? Sparkles;
        return (
          <span
            key={key}
            title={meta?.label ?? key}
            className="inline-flex items-center gap-1 tabular-nums"
          >
            <span className={cn("text-xs", v < 0 && "text-destructive")}>{signed(v)}</span>
            <Icon className={cn("size-3.5", meta?.color)} />
          </span>
        );
      })}
    </span>
  );
}

const COLUMNS: Column<Charm>[] = [
  {
    header: "Name",
    sticky: true,
    render: (c) => (
      <span className="flex items-center gap-2">
        <Sprite name={c.sprite} className="size-6" />
        {c.name}
      </span>
    ),
  },
  {
    header: "Description",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (c) => c.description,
  },
  { header: "Stats", render: (c) => <StatBadges stats={c.stats} /> },
];

export default function CharmsDataTable() {
  return (
    <EntityDataTable<Charm>
      loadCommand="get_charms"
      onSave={saveCharm}
      entityLabel="charm"
      searchPlaceholder="Filter by name or stat…"
      columns={COLUMNS}
      fields={CHARM_FIELDS}
      title={(c) => `Edit ${c.name}`}
      saveDescription="Changes are written to charms.json."
      filter={(c, q) =>
        c.name.toLowerCase().includes(q) ||
        Object.keys(c.stats).some(
          (k) => k.toLowerCase().includes(q) || STAT_META[k]?.label.toLowerCase().includes(q),
        )
      }
    />
  );
}
