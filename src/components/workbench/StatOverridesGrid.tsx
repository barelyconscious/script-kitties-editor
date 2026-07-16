import { PlusIcon, Sparkles, XIcon } from "lucide-react";
import { IntegerInput } from "@/components/IntegerInput";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAT_KEYS, STAT_META } from "@/lib/stats";
import { cn } from "@/lib/utils";

/**
 * A SPARSE stat-override editor: each row picks a stat (dropdown of the known
 * keys, minus ones already overridden) and an integer value, with add/remove.
 * Only the rows present are overrides — an unlisted stat keeps the base
 * creature's value. Distinct from the creature editor's full base/gain grid
 * ({@link StatGrowthTableSingle}), which always shows every stat with two
 * columns; here a missing key means "no override".
 *
 * Writes back a plain `Record<string, number>`. Zero-valued entries are stripped
 * on save (see `saveSeason`), so a row left at 0 is treated as no override.
 */
export function StatOverridesGrid({
  value,
  onChange,
  disabled,
}: {
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  disabled?: boolean;
}) {
  const entries = Object.entries(value);
  const used = new Set(entries.map(([k]) => k));
  const available = STAT_KEYS.filter((k) => !used.has(k));

  function rename(oldKey: string, newKey: string) {
    // Preserve insertion order while swapping the key.
    const next: Record<string, number> = {};
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  }

  function setStat(key: string, n: number) {
    onChange({ ...value, [key]: n });
  }

  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  function add() {
    if (available.length === 0) return;
    onChange({ ...value, [available[0]]: 1 });
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.length === 0 && (
        <p className="text-muted-foreground text-xs">No stat overrides. Add one below.</p>
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
            <IntegerInput
              className="h-9 w-20"
              value={val}
              disabled={disabled}
              onValue={(n) => setStat(key, n)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={() => remove(key)}
              aria-label={`Remove ${meta?.label ?? key} override`}
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
        <PlusIcon className="size-4" /> Add stat override
      </Button>
    </div>
  );
}

export default StatOverridesGrid;
