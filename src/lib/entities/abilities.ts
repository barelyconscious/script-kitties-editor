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

// Predefined option lists, kept in the frontend so they can change freely
// without a backend/data migration. Edit these to add shapes or tags.
export const ABILITY_SHAPES = ["POINT", "SPHERE", "CONE", "SELF"];
export const ABILITY_TAGS = [
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

// SINGLE SOURCE OF TRUTH for the ability edit schema. Consumed by both the Data
// Tables page (AbilitiesDataTable) and the Workbench DATA pane.
export const ABILITY_FIELDS: EntityField<Ability>[] = [
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

export function loadAbilities(): Promise<Ability[]> {
  return invoke<Ability[]>("get_abilities");
}

export async function saveAbility(ability: Ability): Promise<void> {
  await invoke("save_ability", { ability });
}
