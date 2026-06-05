import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { Sprite } from "@/components/Sprite";

type Effect = {
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
  tags: string[];
};

const EFFECT_TAGS = [
  "BENEFICIAL",
  "BLEED",
  "BUFF",
  "BURN",
  "DEBUFF",
  "ELECTRIFIED",
  "HARMFUL",
  "HELPFUL",
];

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

const FIELDS: EntityField<Effect>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "script", label: "Script", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  { key: "tags", label: "Tags", kind: "tags", options: EFFECT_TAGS, full: true },
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
      fields={FIELDS}
      title={(e) => `Edit ${e.name}`}
      saveDescription="Changes are written to effects.json."
      filter={(e, q) =>
        e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))
      }
    />
  );
}
