import { invoke } from "@tauri-apps/api/core";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";

export type Biogram = {
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
  tags: string[];
};

// SINGLE SOURCE OF TRUTH for the biogram edit schema. Consumed by both the Data
// Tables page (BiogramsDataTable) and the Workbench DATA pane. Tags come from the
// shared combat-tags Registry enum (see src/lib/registry).
export const BIOGRAM_FIELDS: EntityField<Biogram>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "script", label: "Script", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  { key: "tags", label: "Tags", kind: "tags", optionsFrom: "combatTags", full: true },
];

export function loadBiograms(): Promise<Biogram[]> {
  return invoke<Biogram[]>("get_biograms");
}

export async function saveBiogram(biogram: Biogram): Promise<void> {
  await invoke("save_biogram", { biogram });
}
