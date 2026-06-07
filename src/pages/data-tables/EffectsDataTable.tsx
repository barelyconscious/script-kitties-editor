import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import { Sprite } from "@/components/Sprite";
import { EFFECT_FIELDS, type Effect } from "@/lib/entities/effects";

const COLUMNS: Column<Effect>[] = [
  {
    header: "Name",
    sticky: true,
    render: (e) => (
      <span className="flex items-center gap-2">
        <Sprite name={e.sprite} className="size-6" />
        {e.name}
      </span>
    ),
  },
  {
    header: "Description",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (e) => e.description,
  },
  {
    header: "Tags",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (e) => e.tags.join(", "),
  },
];

export default function EffectsDataTable() {
  return (
    <EntityDataTable<Effect>
      loadCommand="get_effects"
      saveCommand="save_effect"
      saveArgKey="effect"
      entityLabel="effect"
      searchPlaceholder="Filter by name or tag…"
      columns={COLUMNS}
      fields={EFFECT_FIELDS}
      title={(e) => `Edit ${e.name}`}
      saveDescription="Changes are written to effects.json."
      filter={(e, q) =>
        e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))
      }
    />
  );
}
