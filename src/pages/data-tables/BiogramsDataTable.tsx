import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { Sprite } from "@/components/Sprite";

type Biogram = {
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
  tags: string[];
};

const BIOGRAM_TAGS = [
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

const COLUMNS: Column<Biogram>[] = [
  {
    header: "Name",
    sticky: true,
    render: (b) => (
      <span className="flex items-center gap-2">
        <Sprite name={b.sprite} className="size-6" />
        {b.name}
      </span>
    ),
  },
  {
    header: "Description",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (b) => b.description,
  },
  {
    header: "Tags",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (b) => b.tags.join(", "),
  },
];

const FIELDS: EntityField<Biogram>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "script", label: "Script", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  { key: "tags", label: "Tags", kind: "tags", options: BIOGRAM_TAGS, full: true },
];

export default function BiogramsDataTable() {
  return (
    <EntityDataTable<Biogram>
      loadCommand="get_biograms"
      saveCommand="save_biogram"
      saveArgKey="biogram"
      entityLabel="biogram"
      searchPlaceholder="Filter by name or tag…"
      columns={COLUMNS}
      fields={FIELDS}
      title={(b) => `Edit ${b.name}`}
      saveDescription="Changes are written to biograms.json."
      filter={(b, q) =>
        b.name.toLowerCase().includes(q) || b.tags.some((t) => t.toLowerCase().includes(q))
      }
    />
  );
}
