import { PlusIcon, XIcon } from "lucide-react";
import { type Column, EntityDataTable } from "@/components/data-tables/EntityDataTable";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { Sprite } from "@/components/Sprite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Charm = {
  id: string;
  name: string;
  sprite: string;
  description: string;
  stats: Record<string, number>;
};

// The full set of stat keys used across charms.json.
const STAT_KEYS = [
  "attack",
  "defense",
  "specialAttack",
  "specialDefense",
  "health",
  "speed",
  "luck",
  "memory",
  "fireDamage",
  "fireDefense",
  "frostDamage",
  "frostDefense",
  "lightningDamage",
  "lightningDefense",
  "poisonDamage",
  "poisonDefense",
  "waterDamage",
];

// "+3" / "-1" — signed so buffs vs. debuffs read at a glance.
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function statSummary(stats: Record<string, number>): string {
  const entries = Object.entries(stats);
  if (entries.length === 0) return "—";
  return entries.map(([k, v]) => `${k} ${signed(v)}`).join(", ");
}

const COLUMNS: Column<Charm>[] = [
  {
    header: "Name",
    sticky: true,
    render: (c) => (
      <span className="flex items-center gap-2">
        <Sprite name={c.sprite} className="size-6" />
        {c.name}
      </span>
    ),
  },
  {
    header: "Description",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (c) => c.description,
  },
  {
    header: "Stats",
    className: "text-muted-foreground text-xs",
    truncate: true,
    render: (c) => statSummary(c.stats),
  },
];

/**
 * Editor for a charm's `stats` map. Each row is a stat key (dropdown of the
 * known keys, excluding ones already used) plus a signed integer value, with
 * add/remove. Writes back a plain Record<string, number>.
 */
function StatsEditor({
  value,
  setValue,
  disabled,
}: {
  value: Record<string, number>;
  setValue: (v: Record<string, number>) => void;
  disabled: boolean;
}) {
  const entries = Object.entries(value);
  const used = new Set(entries.map(([k]) => k));
  const available = STAT_KEYS.filter((k) => !used.has(k));

  function rename(oldKey: string, newKey: string) {
    // Preserve insertion order while swapping the key.
    const next: Record<string, number> = {};
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v;
    setValue(next);
  }

  function setStat(key: string, n: number) {
    setValue({ ...value, [key]: n });
  }

  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    setValue(next);
  }

  function add() {
    if (available.length === 0) return;
    setValue({ ...value, [available[0]]: 1 });
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.length === 0 && (
        <p className="text-muted-foreground text-xs">No stats. Add one below.</p>
      )}
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <Select value={key} disabled={disabled} onValueChange={(k) => rename(key, k)}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* The current key plus any not-yet-used keys. */}
              {[key, ...available].map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            className="w-20"
            value={val}
            disabled={disabled}
            onChange={(e) => {
              const n = e.currentTarget.valueAsNumber;
              setStat(key, Number.isNaN(n) ? 0 : n);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => remove(key)}
            aria-label={`Remove ${key}`}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || available.length === 0}
        onClick={add}
      >
        <PlusIcon className="size-4" /> Add stat
      </Button>
    </div>
  );
}

const FIELDS: EntityField<Charm>[] = [
  { key: "id", label: "ID", kind: "text", readOnly: true },
  { key: "name", label: "Name", kind: "text" },
  { key: "sprite", label: "Sprite", kind: "sprite" },
  { key: "description", label: "Description", kind: "textarea", full: true },
  {
    key: "stats",
    label: "Stats",
    kind: "custom",
    full: true,
    render: ({ value, setValue, disabled }) => (
      <StatsEditor
        value={value as Record<string, number>}
        setValue={(v) => setValue(v as Charm["stats"])}
        disabled={disabled}
      />
    ),
  },
];

export default function CharmsDataTable() {
  return (
    <EntityDataTable<Charm>
      loadCommand="get_charms"
      saveCommand="save_charm"
      saveArgKey="charm"
      entityLabel="charm"
      searchPlaceholder="Filter by name or stat…"
      columns={COLUMNS}
      fields={FIELDS}
      title={(c) => `Edit ${c.name}`}
      saveDescription="Changes are written to charms.json."
      filter={(c, q) =>
        c.name.toLowerCase().includes(q) ||
        Object.keys(c.stats).some((k) => k.toLowerCase().includes(q))
      }
    />
  );
}
