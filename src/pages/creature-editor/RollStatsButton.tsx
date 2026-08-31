import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Creature } from "@/lib/creature";
import { applyRolledStats, rollCreatureStats } from "@/lib/statgen";

/**
 * One-click starter-tier stat generator. Rolls a fresh core kit — the five base
 * stats (health/attack/defense/speed/luck) and the four primary per-level gains
 * — modeled on the shipped creatures' distribution (see {@link rollCreatureStats}),
 * and hands it up via `onChange`. Elements and non-primary gains are preserved.
 */
export function RollStatsButton({
  creature,
  onChange,
  disabled,
}: {
  creature: Creature;
  onChange: (next: Creature) => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => onChange(applyRolledStats(creature, rollCreatureStats()))}
      title="Generate starter-tier base stats and per-level gains"
    >
      <Dices className="size-4" />
      Roll stats
    </Button>
  );
}

export default RollStatsButton;
