import { invoke } from "@tauri-apps/api/core";
import {
  Brain,
  Clover,
  Droplet,
  Flame,
  Heart,
  type LucideIcon,
  PlusIcon,
  Shield,
  ShieldHalf,
  Skull,
  Snowflake,
  Sparkles,
  Sword,
  Wind,
  XIcon,
  Zap,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

type Charm = {
  id: string;
  name: string;
  sprite: string;
  description: string;
  stats: Record<string, number>;
};

// Every stat key used across charms.json, paired with a glyph + color so the
// table reads at a glance ("+3 ⚔"). Defenses share the shield, tinted by their
// element; offenses get the element's own icon. Insertion order also drives the
// editor's stat dropdown, so it's grouped sensibly (core → element pairs).
const STAT_META: Record<string, { label: string; Icon: LucideIcon; color: string }> = {
  attack: { label: "Attack", Icon: Sword, color: "text-red-400" },
  defense: { label: "Defense", Icon: Shield, color: "text-slate-400" },
  specialAttack: { label: "Special Attack", Icon: Sparkles, color: "text-violet-400" },
  specialDefense: { label: "Special Defense", Icon: ShieldHalf, color: "text-violet-300" },
  health: { label: "Health", Icon: Heart, color: "text-rose-400" },
  speed: { label: "Speed", Icon: Wind, color: "text-cyan-400" },
  luck: { label: "Luck", Icon: Clover, color: "text-green-400" },
  memory: { label: "Memory", Icon: Brain, color: "text-fuchsia-400" },
  fireDamage: { label: "Fire Damage", Icon: Flame, color: "text-orange-400" },
  fireDefense: { label: "Fire Defense", Icon: Shield, color: "text-orange-300" },
  frostDamage: { label: "Frost Damage", Icon: Snowflake, color: "text-sky-400" },
  frostDefense: { label: "Frost Defense", Icon: Shield, color: "text-sky-300" },
  lightningDamage: { label: "Lightning Damage", Icon: Zap, color: "text-amber-400" },
  lightningDefense: { label: "Lightning Defense", Icon: Shield, color: "text-amber-300" },
  poisonDamage: { label: "Poison Damage", Icon: Skull, color: "text-green-500" },
  poisonDefense: { label: "Poison Defense", Icon: Shield, color: "text-emerald-400" },
  waterDamage: { label: "Water Damage", Icon: Droplet, color: "text-blue-400" },
};

const STAT_KEYS = Object.keys(STAT_META);

// "+3" / "-1" — signed so buffs vs. debuffs read at a glance.
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// Drop the zero-valued stats — a +0 conveys nothing and just clutters the row.
function nonZeroStats(stats: Record<string, number>): [string, number][] {
  return Object.entries(stats).filter(([, v]) => v !== 0);
}

/** Compact icon badges for a charm's non-zero stats, e.g. "+3 ⚔  -1 🛡". */
function StatBadges({ stats }: { stats: Record<string, number> }) {
  const entries = nonZeroStats(stats);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-x-3 gap-y-1 whitespace-nowrap">
      {entries.map(([key, v]) => {
        const meta = STAT_META[key];
        const Icon = meta?.Icon ?? Sparkles;
        return (
          <span
            key={key}
            title={meta?.label ?? key}
            className="inline-flex items-center gap-1 tabular-nums"
          >
            <span className={cn("text-xs", v < 0 && "text-destructive")}>{signed(v)}</span>
            <Icon className={cn("size-3.5", meta?.color)} />
          </span>
        );
      })}
    </span>
  );
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
  { header: "Stats", render: (c) => <StatBadges stats={c.stats} /> },
];

// Strip zero-valued stats before persisting so they don't linger in charms.json.
async function saveCharm(charm: Charm): Promise<void> {
  const stats = Object.fromEntries(nonZeroStats(charm.stats));
  await invoke("save_charm", { charm: { ...charm, stats } });
}

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
      {entries.map(([key, val]) => {
        const meta = STAT_META[key];
        const Icon = meta?.Icon ?? Sparkles;
        return (
          <div key={key} className="flex items-center gap-2">
            <Icon className={cn("size-4 shrink-0", meta?.color)} />
            <Select value={key} disabled={disabled} onValueChange={(k) => rename(key, k)}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* The current key plus any not-yet-used keys, shown by label. */}
                {[key, ...available].map((k) => (
                  <SelectItem key={k} value={k}>
                    {STAT_META[k]?.label ?? k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              inputMode="numeric"
              step={1}
              className="w-20"
              value={val}
              disabled={disabled}
              onKeyDown={(e) => {
                // Stats are whole numbers — reject decimal/exponent keys.
                if (e.key === "." || e.key === "e" || e.key === "E") e.preventDefault();
              }}
              onChange={(e) => {
                const n = e.currentTarget.valueAsNumber;
                setStat(key, Number.isNaN(n) ? 0 : Math.trunc(n));
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={() => remove(key)}
              aria-label={`Remove ${meta?.label ?? key}`}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        );
      })}
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
      onSave={saveCharm}
      entityLabel="charm"
      searchPlaceholder="Filter by name or stat…"
      columns={COLUMNS}
      fields={FIELDS}
      title={(c) => `Edit ${c.name}`}
      saveDescription="Changes are written to charms.json."
      filter={(c, q) =>
        c.name.toLowerCase().includes(q) ||
        Object.keys(c.stats).some(
          (k) => k.toLowerCase().includes(q) || STAT_META[k]?.label.toLowerCase().includes(q),
        )
      }
    />
  );
}
