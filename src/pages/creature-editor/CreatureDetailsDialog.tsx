import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Creature } from "@/lib/creature";
import { CreatureIdentityFields } from "./CreatureIdentityFields";

/**
 * The rarely-touched identity fields (name, sprite, script, description), tucked
 * behind a dialog so the editor leads with the things designers actually come
 * here for — balance and (later) the script. Edits the draft live; there's no
 * separate save, since the page owns dirty tracking and the Save button. The
 * field grid itself is shared with the Workbench creature pane via
 * {@link CreatureIdentityFields} (here with the script pointer included).
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Creature details</DialogTitle>
          <DialogDescription>
            Identity fields — rarely changed. Edits apply when you save the creature.
          </DialogDescription>
        </DialogHeader>

        <CreatureIdentityFields
          creature={creature}
          onChange={onChange}
          disabled={disabled}
          includeScript
        />
      </DialogContent>
    </Dialog>
  );
}

export default CreatureDetailsDialog;
