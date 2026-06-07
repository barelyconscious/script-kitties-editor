import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import { Sprite } from "@/components/Sprite";
import { ABILITY_FIELDS, type Ability } from "@/lib/entities/abilities";

const COLUMNS: Column<Ability>[] = [
  {
    header: "Name",
    sticky: true,
    render: (a) => (
      <span className="flex items-center gap-2">
        <Sprite name={a.sprite} className="size-6" />
        {a.name}
      </span>
    ),
  },
  { header: "Shape", render: (a) => a.shape },
  { header: "Range", align: "right", render: (a) => a.range },
  { header: "Radius", align: "right", render: (a) => a.radius },
  { header: "Max Targets", align: "right", render: (a) => a.maxNumTargets },
  { header: "Cost", align: "right", render: (a) => a.cost },
  {
    header: "Tags",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (a) => a.tags.join(", "),
  },
];

export default function AbilitiesDataTable() {
  return (
    <EntityDataTable<Ability>
      loadCommand="get_abilities"
      saveCommand="save_ability"
      saveArgKey="ability"
      entityLabel="ability"
      searchPlaceholder="Filter by name, shape, or tag…"
      columns={COLUMNS}
      fields={ABILITY_FIELDS}
      title={(a) => `Edit ${a.name}`}
      saveDescription="Changes are written to abilities.json."
      filter={(a, q) =>
        a.name.toLowerCase().includes(q) ||
        a.shape.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      }
    />
  );
}
