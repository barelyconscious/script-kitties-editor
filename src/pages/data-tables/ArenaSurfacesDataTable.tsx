import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import { Sprite } from "@/components/Sprite";
import {
  ARENA_SURFACE_FIELDS,
  type ArenaSurface,
  loadArenaSurfaces,
  saveArenaSurface,
} from "@/lib/entities/arenaSurfaces";
import type { EntityKind } from "@/lib/entities/dataVersion";

const COLUMNS: Column<ArenaSurface>[] = [
  {
    header: "Kind",
    sticky: true,
    render: (s) => (
      <span className="flex items-center gap-2">
        <Sprite name={s.sprite} className="size-6" />
        <code className="font-mono text-xs">{s.id}</code>
      </span>
    ),
  },
  {
    header: "Name",
    render: (s) => s.name,
  },
  {
    header: "Description",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (s) => s.description,
  },
];

// Stable references (module scope) so EntityDataTable's fetch effect doesn't loop.
const REFRESH_KINDS: readonly EntityKind[] = ["arenaSurfaces"];

export default function ArenaSurfacesDataTable() {
  return (
    <EntityDataTable<ArenaSurface>
      load={loadArenaSurfaces}
      onSave={saveArenaSurface}
      refreshKinds={REFRESH_KINDS}
      entityLabel="surface"
      searchPlaceholder="Filter by kind or name…"
      columns={COLUMNS}
      fields={ARENA_SURFACE_FIELDS}
      title={(s) => `Edit ${s.name}`}
      saveDescription="Changes are written to arena_surfaces.json."
      filter={(s, q) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)}
    />
  );
}
