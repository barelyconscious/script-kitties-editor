import { invoke } from "@tauri-apps/api/core";
import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { Sprite } from "@/components/Sprite";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
  itemTags: string[];
};

type ItemDrop = {
  id: string;
  rarity: string;
  value: number;
  minLevel?: number;
  maxLevel?: number;
  biomes: string[];
  dropChance?: number;
};

// One table row = an item joined with its loot/economy entry from itemDropTable.
type ItemRow = Item & Omit<ItemDrop, "id">;

const ITEM_TAGS = [
  "CONSUMABLE",
  "HARMFUL",
  "HELPFUL",
  "REQUIRES_TARGET",
  "STACKABLE",
  "USABLE_IN_COMBAT",
  "USABLE_OUTSIDE_COMBAT",
];

const RARITIES = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "UNIQUE"];
const BIOMES = ["DESERT", "FOREST", "MOUNTAINS", "PLAINS", "SWAMP"];

// Frontend-owned so the palette can change freely. Tuned to the game's colors.
const RARITY_COLOR: Record<string, string> = {
  POOR: "text-muted-foreground",
  COMMON: "text-foreground",
  UNCOMMON: "text-green-500",
  RARE: "text-amber-500",
  EPIC: "text-violet-500",
  UNIQUE: "text-orange-500",
};

// Defaults for an item that has no itemDropTable entry yet (e.g. kittycards).
// Editing + saving such a row creates its drop entry.
const DEFAULT_DROP: Omit<ItemDrop, "id"> = {
  rarity: "COMMON",
  value: 0,
  minLevel: 0,
  maxLevel: 0,
  biomes: [],
};

function levelLabel(min?: number, max?: number): string {
  // maxLevel 0 / absent means "no upper bound" — shown as *.
  return `${min ?? 0} - ${max && max > 0 ? max : "*"}`;
}

// Load + join the two sources. Module scope = stable reference for the table.
async function loadItemRows(): Promise<ItemRow[]> {
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
async function saveItemRow(row: ItemRow): Promise<void> {
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

const COLUMNS: Column<ItemRow>[] = [
  {
    header: "Name",
    sticky: true,
    render: (i) => (
      <span className="flex items-center gap-2">
        <Sprite name={i.sprite} className="size-6" />
        <span className={cn(RARITY_COLOR[i.rarity] ?? "text-foreground")}>{i.name}</span>
      </span>
    ),
  },
  { header: "Value", align: "right", render: (i) => `$${i.value}` },
  {
    header: "Description",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (i) => i.description,
  },
  {
    header: "Tags",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (i) => i.itemTags.join(", "),
  },
  {
    header: "Level",
    className: "tabular-nums",
    render: (i) => levelLabel(i.minLevel, i.maxLevel),
  },
  {
    header: "Biome",
    className: "text-muted-foreground text-xs",
    render: (i) => (i.biomes.length ? i.biomes.join(", ") : "any"),
  },
];

const FIELDS: EntityField<ItemRow>[] = [
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

export default function ItemsDataTable() {
  return (
    <EntityDataTable<ItemRow>
      load={loadItemRows}
      onSave={saveItemRow}
      entityLabel="item"
      searchPlaceholder="Filter by name, tag, rarity, or biome…"
      columns={COLUMNS}
      fields={FIELDS}
      title={(i) => `Edit ${i.name}`}
      saveDescription="Changes are written to items.json and itemDropTable.json."
      filter={(i, q) =>
        i.name.toLowerCase().includes(q) ||
        i.rarity.toLowerCase().includes(q) ||
        i.itemTags.some((t) => t.toLowerCase().includes(q)) ||
        i.biomes.some((b) => b.toLowerCase().includes(q))
      }
    />
  );
}
