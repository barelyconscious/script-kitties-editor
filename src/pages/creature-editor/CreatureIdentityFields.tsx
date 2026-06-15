import { useState } from "react";
import { SpritePicker } from "@/components/data-tables/SpritePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Creature } from "@/lib/creature";
import { useEnumValues } from "@/lib/registry";

/**
 * Controlled grid of a creature's identity fields — name, sprite, rarity, and
 * description. The single source for this markup, used by the Workbench creature
 * DATA pane; the AI-script pointer is NOT here — the Workbench SCRIPT pane owns it.
 *
 * Owns NO draft/dirty/save state: edits report up via `onChange`. The
 * sprite-picker popover is portalled into an internal sibling div so it scrolls
 * within whatever host wraps this — a scrollable pane — mirroring
 * `EntityFieldsForm`.
 */
export function CreatureIdentityFields({
  creature,
  onChange,
  disabled,
}: {
  creature: Creature;
  onChange: (next: Creature) => void;
  disabled?: boolean;
}) {
  // Portal target for the sprite picker's popover, so it scrolls within the
  // surrounding host (dialog or pane) — same pattern as EntityFieldsForm.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const rarities = useEnumValues("creatureRarities");
  const set = <K extends keyof Creature>(key: K, value: Creature[K]) =>
    onChange({ ...creature, [key]: value });

  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-1 py-1">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="creature-name" className="text-xs">
            Name
          </Label>
          <Input
            id="creature-name"
            value={creature.name}
            disabled={disabled}
            onChange={(e) => set("name", e.currentTarget.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="creature-sprite" className="text-xs">
            Sprite
          </Label>
          <SpritePicker
            value={creature.sprite}
            disabled={disabled}
            container={portalContainer}
            onChange={(name) => set("sprite", name)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="creature-rarity" className="text-xs">
            Rarity
          </Label>
          <Select
            value={creature.rarity || undefined}
            disabled={disabled}
            onValueChange={(value) => set("rarity", value)}
          >
            <SelectTrigger id="creature-rarity">
              <SelectValue placeholder="Choose rarity…" />
            </SelectTrigger>
            <SelectContent>
              {rarities.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="creature-description" className="text-xs">
            Description
          </Label>
          <Textarea
            id="creature-description"
            value={creature.description}
            rows={3}
            disabled={disabled}
            onChange={(e) => set("description", e.currentTarget.value)}
          />
        </div>
      </div>

      {/* Portal target for the sprite picker — see portalContainer above. */}
      <div ref={setPortalContainer} />
    </>
  );
}

export default CreatureIdentityFields;
