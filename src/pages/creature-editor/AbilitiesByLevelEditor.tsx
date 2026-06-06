import { PlusIcon, XIcon } from "lucide-react";
import { IntegerInput } from "@/components/IntegerInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CreatureLevelUp } from "@/lib/creature";
import { type AbilityOption, AbilityPicker } from "./AbilityPicker";

/**
 * Editor for a creature's `abilitiesByLevel` — the level thresholds at which it
 * unlocks new abilities. Each row is a level + the abilities gained there.
 * Rows are kept sorted by level so the progression reads top-to-bottom.
 */
export function AbilitiesByLevelEditor({
  value,
  abilityOptions,
  onChange,
  disabled,
}: {
  value: CreatureLevelUp[];
  abilityOptions: AbilityOption[];
  onChange: (next: CreatureLevelUp[]) => void;
  disabled?: boolean;
}) {
  // Display sorted by level; edits write back the sorted list.
  const rows = [...value].sort((a, b) => a.level - b.level);

  function update(index: number, patch: Partial<CreatureLevelUp>) {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function add() {
    // Default to one past the highest existing threshold.
    const nextLevel = rows.length ? Math.max(...rows.map((r) => r.level)) + 1 : 1;
    onChange([...rows, { level: nextLevel, abilitiesGained: [] }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className="text-muted-foreground text-xs">No level-up unlocks. Add one below.</p>
      )}
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows reorder by level; index is the stable handle here.
        <div key={i} className="flex items-start gap-2">
          <div className="flex shrink-0 flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Level</Label>
            <IntegerInput
              value={row.level}
              min={1}
              onValue={(n) => update(i, { level: n })}
              disabled={disabled}
              className="h-8 w-20"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Abilities gained</Label>
            <AbilityPicker
              value={row.abilitiesGained}
              options={abilityOptions}
              onChange={(abilitiesGained) => update(i, { abilitiesGained })}
              disabled={disabled}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-6 shrink-0"
            disabled={disabled}
            onClick={() => remove(i)}
            aria-label={`Remove level ${row.level} unlock`}
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
        disabled={disabled}
        onClick={add}
      >
        <PlusIcon className="size-4" /> Add level-up
      </Button>
    </div>
  );
}

export default AbilitiesByLevelEditor;
