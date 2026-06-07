import { invoke } from "@tauri-apps/api/core";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";

export type Effect = {
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
  tags: string[];
};

export const EFFECT_TAGS = [
  "BENEFICIAL",
  "BLEED",
  "BUFF",
  "BURN",
  "DEBUFF",
  "ELECTRIFIED",
  "HARMFUL",
  "HELPFUL",
];

// SINGLE SOURCE OF TRUTH for the effect edit schema. Consumed by both the Data
// Tables page (EffectsDataTable) and the Workbench DATA pane.
export const EFFECT_FIELDS: EntityField<Effect>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "script", label: "Script", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  { key: "tags", label: "Tags", kind: "tags", options: EFFECT_TAGS, full: true },
];

export function loadEffects(): Promise<Effect[]> {
  return invoke<Effect[]>("get_effects");
}

export async function saveEffect(effect: Effect): Promise<void> {
  await invoke("save_effect", { effect });
}
