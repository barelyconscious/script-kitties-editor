import { useState } from "react";
import { SpritePicker } from "@/components/data-tables/SpritePicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Creature } from "@/lib/creature";

/**
 * The rarely-touched identity fields (name, sprite, script, description), tucked
 * behind a dialog so the editor leads with the things designers actually come
 * here for — balance and (later) the script. Edits the draft live; there's no
 * separate save, since the page owns dirty tracking and the Save button.
 */
export function CreatureDetailsDialog({
  creature,
  onChange,
  open,
  onOpenChange,
  disabled,
}: {
  creature: Creature;
  onChange: (next: Creature) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  // Portal target for the sprite picker's popover, so it scrolls within the dialog.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const set = <K extends keyof Creature>(key: K, value: Creature[K]) =>
    onChange({ ...creature, [key]: value });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Creature details</DialogTitle>
          <DialogDescription>
            Identity fields — rarely changed. Edits apply when you save the creature.
          </DialogDescription>
        </DialogHeader>

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
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="creature-script" className="text-xs">
              Script
            </Label>
            <Input
              id="creature-script"
              value={creature.aiController}
              disabled={disabled}
              onChange={(e) => set("aiController", e.currentTarget.value)}
            />
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

        <div ref={setPortalContainer} />
      </DialogContent>
    </Dialog>
  );
}

export default CreatureDetailsDialog;
