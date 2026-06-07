import { invoke } from "@tauri-apps/api/core";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";

export type Item = {
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
  itemTags: string[];
};

export type ItemDrop = {
  id: string;
  rarity: string;
  value: number;
  minLevel?: number;
  maxLevel?: number;
  biomes: string[];
  dropChance?: number;
};

// One table row = an item joined with its loot/economy entry from itemDropTable.
export type ItemRow = Item & Omit<ItemDrop, "id">;

// Defaults for an item that has no itemDropTable entry yet (e.g. kittycards).
// Editing + saving such a row creates its drop entry. Exported so the Workbench
// creation core can seed a brand-new item's drop fields from the same defaults.
export const DEFAULT_DROP: Omit<ItemDrop, "id"> = {
  rarity: "COMMON",
  value: 0,
  minLevel: 0,
  maxLevel: 0,
  biomes: [],
};

// Load + join the two sources. Module scope = stable reference for the table.
export async function loadItemRows(): Promise<ItemRow[]> {
  const [items, drops] = await Promise.all([
    invoke<Item[]>("get_items"),
    invoke<ItemDrop[]>("get_item_drops"),
  ]);
  const dropById = new Map(drops.map((d) => [d.id, d]));
  return items.map((item) => {
    const drop = dropById.get(item.id) ?? DEFAULT_DROP;
    const { rarity, value, minLevel, maxLevel, biomes, dropChance } = drop;
    return { ...item, rarity, value, minLevel, maxLevel, biomes, dropChance };
  });
}

// Split the joined row back into its two records and write each.
export async function saveItemRow(row: ItemRow): Promise<void> {
  const item: Item = {
    id: row.id,
    name: row.name,
    sprite: row.sprite,
    script: row.script,
    description: row.description,
    itemTags: row.itemTags,
  };
  const itemDrop: ItemDrop = {
    id: row.id,
    rarity: row.rarity,
    value: row.value,
    minLevel: row.minLevel,
    maxLevel: row.maxLevel,
    biomes: row.biomes,
    // Only carry dropChance when present (the "junk" catch-all uses it).
    ...(row.dropChance != null ? { dropChance: row.dropChance } : {}),
  };
  await invoke("save_item", { item });
  await invoke("save_item_drop", { itemDrop });
}

// Option lists, frontend-owned so the palette can change without a data
// migration. Order drives the edit dialog's tag/select lists.
export const RARITIES = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "UNIQUE"];
export const BIOMES = ["DESERT", "FOREST", "MOUNTAINS", "PLAINS", "SWAMP"];
export const ITEM_TAGS = [
  "CONSUMABLE",
  "HARMFUL",
  "HELPFUL",
  "REQUIRES_TARGET",
  "STACKABLE",
  "USABLE_IN_COMBAT",
  "USABLE_OUTSIDE_COMBAT",
];

// SINGLE SOURCE OF TRUTH for the item edit schema (the joined ItemRow).
// Consumed by both the Data Tables page (ItemsDataTable) and the Workbench DATA
// pane. The split into two records on save lives in `saveItemRow`.
export const ITEM_FIELDS: EntityField<ItemRow>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "rarity", label: "Rarity", kind: "select", options: RARITIES },
  { key: "value", label: "Value", kind: "number" },
  { key: "minLevel", label: "Min Level", kind: "number" },
  { key: "maxLevel", label: "Max Level", kind: "number" },
  { key: "script", label: "Script", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  { key: "itemTags", label: "Item Tags", kind: "tags", options: ITEM_TAGS, full: true },
  { key: "biomes", label: "Biomes", kind: "tags", options: BIOMES, full: true },
];
