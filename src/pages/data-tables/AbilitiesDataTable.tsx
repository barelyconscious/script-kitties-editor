import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { Sprite } from "@/components/Sprite";

type Ability = {
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
  shape: string;
  tags: string[];
  range: number;
  radius: number;
  maxNumTargets: number;
  cost: number;
};

// Predefined option lists, kept in the frontend so they can change freely
// without a backend/data migration. Edit these to add shapes or tags.
const ABILITY_SHAPES = ["POINT", "SPHERE", "CONE", "SELF"];
const ABILITY_TAGS = [
  "AREA",
  "AUTO_TARGET",
  "CONJURE",
  "CONTACT",
  "HARMFUL",
  "HELPFUL",
  "PROJECTILE",
  "REQUIRES_TARGET",
  "SET_LOCATION",
];

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

const FIELDS: EntityField<Ability>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "shape", label: "Shape", kind: "select", options: ABILITY_SHAPES },
  { key: "script", label: "Script", kind: "text" },
  { key: "range", label: "Range", kind: "number" },
  { key: "radius", label: "Radius", kind: "number" },
  { key: "maxNumTargets", label: "Max Targets", kind: "number" },
  { key: "cost", label: "Cost", kind: "number", step: "any" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  { key: "tags", label: "Tags", kind: "tags", options: ABILITY_TAGS, full: true },
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
      fields={FIELDS}
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
