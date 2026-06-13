import { invoke } from "@tauri-apps/api/core";
import { PlusIcon, Sparkles, XIcon } from "lucide-react";
import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { IntegerInput } from "@/components/IntegerInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { nonZeroStats, STAT_KEYS, STAT_META } from "@/lib/stats";
import { cn } from "@/lib/utils";

export type Charm = {
  id: string;
  name: string;
  sprite: string;
  description: string;
  stats: Record<string, number>;
  /**
   * Optional script pointer. The backend omits the key for script-less charms
   * (so it can be absent at runtime); creating a charm with the script toggle on
   * sets it, otherwise it stays empty/absent and the charm has no script.
   */
  script?: string;
};

export function loadCharms(): Promise<Charm[]> {
  return invoke<Charm[]>("get_charms");
}

// Strip zero-valued stats before persisting so they don't linger in charms.json.
// SINGLE SOURCE OF TRUTH for the charm save path — the Workbench DATA pane and
// the Data Tables page both call this so zero-stripping never diverges.
export async function saveCharm(charm: Charm): Promise<void> {
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

/** "Fire Damage" → "Fire Dmg", "Special Defense" → "Sp. Def" — abbreviations so
 * stat names fit the narrow Workbench data pane. */
function shortStatLabel(key: string): string {
  const label = STAT_META[key]?.label ?? key;
  return label
    .replace(/\bSpecial\b/, "Sp.")
    .replace(/\bAttack\b/, "Atk")
    .replace(/\bDefense\b/, "Def")
    .replace(/\bDamage\b/, "Dmg");
}

/**
 * Compact, fixed stats editor for the narrow Workbench DATA pane: EVERY known
 * stat is always shown as icon + short label + integer spinner — no dropdowns,
 * no add/remove. Stats left at 0 are stripped on save (see {@link saveCharm}),
 * so the full list never bloats charms.json.
 */
function CompactStatsEditor({
  value,
  setValue,
  disabled,
}: {
  value: Record<string, number>;
  setValue: (v: Record<string, number>) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {STAT_KEYS.map((key) => {
        const meta = STAT_META[key];
        const Icon = meta?.Icon ?? Sparkles;
        return (
          <div key={key} className="flex items-center gap-2">
            <Icon className={cn("size-4 shrink-0", meta?.color)} />
            <span className="min-w-0 flex-1 truncate text-sm">{shortStatLabel(key)}</span>
            <IntegerInput
              className="h-8 w-16 shrink-0"
              value={value[key] ?? 0}
              disabled={disabled}
              onValue={(n) => setValue({ ...value, [key]: n })}
            />
          </div>
        );
      })}
    </div>
  );
}

// SINGLE SOURCE OF TRUTH for the charm edit schema (incl. the custom stats-map
// renderer). Consumed by both the Data Tables page and the Workbench DATA pane.
export const CHARM_FIELDS: EntityField<Charm>[] = [
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

// Workbench DATA pane variant: identical to CHARM_FIELDS but swaps the roomy
// dropdown stats editor for the compact, all-stats grid that fits the narrow
// pane. The Data Tables dialog keeps CHARM_FIELDS (room for the dropdown form).
export const CHARM_WORKBENCH_FIELDS: EntityField<Charm>[] = CHARM_FIELDS.map((field) =>
  field.key === "stats"
    ? {
        ...field,
        render: ({ value, setValue, disabled }) => (
          <CompactStatsEditor
            value={value as Record<string, number>}
            setValue={(v) => setValue(v as Charm["stats"])}
            disabled={disabled}
          />
        ),
      }
    : field,
);
