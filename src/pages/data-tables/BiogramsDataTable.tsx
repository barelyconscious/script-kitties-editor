import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import { Sprite } from "@/components/Sprite";
import { BIOGRAM_FIELDS, type Biogram } from "@/lib/entities/biograms";

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

export default function BiogramsDataTable() {
  return (
    <EntityDataTable<Biogram>
      loadCommand="get_biograms"
      saveCommand="save_biogram"
      saveArgKey="biogram"
      entityLabel="biogram"
      searchPlaceholder="Filter by name or tag…"
      columns={COLUMNS}
      fields={BIOGRAM_FIELDS}
      title={(b) => `Edit ${b.name}`}
      saveDescription="Changes are written to biograms.json."
      filter={(b, q) =>
        b.name.toLowerCase().includes(q) || b.tags.some((t) => t.toLowerCase().includes(q))
      }
    />
  );
}
