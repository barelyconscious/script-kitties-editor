import {
  Compass,
  Crosshair,
  HeartPulse,
  Layers,
  type LucideIcon,
  Pill,
  Skull,
  Swords,
  Tag,
} from "lucide-react";
import {
  type Column,
  type ColumnContext,
  EntityDataTable,
} from "@/components/data-tables/EntityDataTable";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { Sprite } from "@/components/Sprite";
import { type ItemRow, loadItemRows, saveItemRow } from "@/lib/items";
import { cn } from "@/lib/utils";

// Each item tag gets an evocative glyph + color for the table, plus a human
// label for its tooltip. Insertion order drives the edit dialog's tag list too.
const ITEM_TAG_META: Record<string, { label: string; Icon: LucideIcon; color: string }> = {
  CONSUMABLE: { label: "Consumable", Icon: Pill, color: "text-teal-400" },
  HARMFUL: { label: "Harmful", Icon: Skull, color: "text-red-400" },
  HELPFUL: { label: "Helpful", Icon: HeartPulse, color: "text-green-400" },
  REQUIRES_TARGET: { label: "Requires Target", Icon: Crosshair, color: "text-amber-400" },
  STACKABLE: { label: "Stackable", Icon: Layers, color: "text-sky-400" },
  USABLE_IN_COMBAT: { label: "Usable in Combat", Icon: Swords, color: "text-orange-400" },
  USABLE_OUTSIDE_COMBAT: {
    label: "Usable Outside Combat",
    Icon: Compass,
    color: "text-violet-400",
  },
};

const ITEM_TAGS = Object.keys(ITEM_TAG_META);

/** Item tags as clickable glyphs; clicking one searches the table for that tag. */
function TagBadges({ tags, setQuery }: { tags: string[]; setQuery: ColumnContext["setQuery"] }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-1">
      {tags.map((tag) => {
        const meta = ITEM_TAG_META[tag];
        const Icon = meta?.Icon ?? Tag;
        return (
          <button
            key={tag}
            type="button"
            title={meta?.label ?? tag}
            // Stop the row's edit-on-click; just drive the search box.
            onClick={(e) => {
              e.stopPropagation();
              setQuery(tag);
            }}
            className="rounded p-1 transition-colors hover:bg-muted"
          >
            <Icon className={cn("size-4", meta?.color)} />
          </button>
        );
      })}
    </span>
  );
}

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

function levelLabel(min?: number, max?: number): string {
  // maxLevel 0 / absent means "no upper bound" — shown as *.
  return `${min ?? 0} - ${max && max > 0 ? max : "*"}`;
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
    render: (i, { setQuery }) => <TagBadges tags={i.itemTags} setQuery={setQuery} />,
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
