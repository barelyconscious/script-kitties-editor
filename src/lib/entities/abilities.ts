import { invoke } from "@tauri-apps/api/core";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";

export type Ability = {
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

// SINGLE SOURCE OF TRUTH for the ability edit schema. Consumed by both the Data
// Tables page (AbilitiesDataTable) and the Workbench DATA pane. Shape and tag
// choices come from the Registry (see src/lib/registry).
export const ABILITY_FIELDS: EntityField<Ability>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "shape", label: "Shape", kind: "select", optionsFrom: "abilityShapes" },
  { key: "script", label: "Script", kind: "text" },
  { key: "range", label: "Range", kind: "number" },
  { key: "radius", label: "Radius", kind: "number" },
  { key: "maxNumTargets", label: "Max Targets", kind: "number" },
  { key: "cost", label: "Cost", kind: "number", step: "any" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  { key: "tags", label: "Tags", kind: "tags", optionsFrom: "combatTags", full: true },
];

export function loadAbilities(): Promise<Ability[]> {
  return invoke<Ability[]>("get_abilities");
}

export async function saveAbility(ability: Ability): Promise<void> {
  await invoke("save_ability", { ability });
}
