import { invoke } from "@tauri-apps/api/core";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { bumpEntityVersion } from "./dataVersion";

/**
 * A combat **arena surface** (`Data/arena_surfaces.json`) as the editor's generic
 * machinery sees it. The on-disk / wire record is keyed by `kind` (an uppercase
 * token like `FROZEN` the engine looks up — see the Rust `ArenaSurface`), but
 * every generic surface here (EntityDataTable, the Workbench DATA pane, the object
 * list) is hard-keyed to a field named `id`. So this type exposes `id` and the
 * load/save functions below TRANSLATE `kind ⟷ id` at the bridge. `id` therefore
 * holds the uppercase kind, not a lower_snake_case id like other entities.
 */
export type ArenaSurface = {
  /** The uppercase surface kind (`FROZEN`, …) — mapped from/to the wire `kind`. */
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
};

/** The raw wire shape exchanged with the backend (`kind`-keyed). */
type ArenaSurfaceWire = {
  kind: string;
  name: string;
  description: string;
  sprite: string;
  script: string;
};

const toEntity = (w: ArenaSurfaceWire): ArenaSurface => ({
  id: w.kind,
  name: w.name,
  sprite: w.sprite,
  script: w.script,
  description: w.description,
});

const toWire = (s: ArenaSurface): ArenaSurfaceWire => ({
  kind: s.id,
  name: s.name,
  description: s.description,
  sprite: s.sprite,
  script: s.script,
});

// SINGLE SOURCE OF TRUTH for the arena-surface edit schema. Consumed by both the
// Data Tables page (ArenaSurfacesDataTable) and the Workbench DATA pane. `id` is
// the surface's `kind` — the identity/sort key — so it's read-only here; the kind
// is chosen (from the `surfaces` Registry enum) only at creation.
export const ARENA_SURFACE_FIELDS: EntityField<ArenaSurface>[] = [
  { key: "id", label: "Kind", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "script", label: "Script", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", full: true },
];

export async function loadArenaSurfaces(): Promise<ArenaSurface[]> {
  const wire = await invoke<ArenaSurfaceWire[]>("get_arena_surfaces");
  return wire.map(toEntity);
}

export async function saveArenaSurface(surface: ArenaSurface): Promise<void> {
  await invoke("save_arena_surface", { surface: toWire(surface) });
  // Notify open lists/panes watching arena surfaces to re-fetch.
  bumpEntityVersion("arenaSurfaces");
}
