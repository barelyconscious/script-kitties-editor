/**
 * DeleteComponentDialog — the destructive confirm shown before a component is
 * deleted from the left component list. Presentational: it names the component
 * and the files that go with it, then reports Confirm or Cancel; the caller (the
 * component list) owns the actual `delete_component` call, the open-component
 * close, and the list refresh.
 *
 * Dismissing the dialog (overlay click, Esc, the X) is treated as Cancel — the
 * safe default for a destructive action.
 *
 * @see design/xgui_ta.md — "Component list (leftmost, collapsible)".
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DeleteComponentDialogProps = {
  /** Whether the prompt is shown. */
  open: boolean;
  /** Basename of the component to delete (for the message). `null` closes it. */
  componentName: string | null;
  /** Whether the component carries a controller `.lua` (tunes the message). */
  hasController?: boolean;
  /** True while a delete triggered from this prompt is in flight. */
  deleting?: boolean;
  /** Report the user's choice. Overlay/Esc/X dismiss reports `false` (cancel). */
  onChoose: (confirmed: boolean) => void;
};

export function DeleteComponentDialog({
  open,
  componentName,
  hasController = false,
  deleting = false,
  onChoose,
}: DeleteComponentDialogProps) {
  return (
    <Dialog
      open={open}
      // Any non-explicit close (overlay/Esc/X) is a Cancel — never delete on a
      // stray dismiss.
      onOpenChange={(next) => {
        if (!next) onChoose(false);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete component</DialogTitle>
          <DialogDescription>
            {componentName ? (
              <>
                Delete <span className="font-mono text-foreground">{componentName}</span>? This
                removes its <span className="font-mono">.xml</span>
                {hasController ? (
                  <>
                    {" "}
                    and its controller <span className="font-mono">.lua</span>
                  </>
                ) : null}{" "}
                file{hasController ? "s" : ""}. Any component that referenced it via{" "}
                <span className="font-mono">&lt;Component src&gt;</span> will stop resolving. This
                can't be undone.
              </>
            ) : (
              "Delete this component? This removes its files and can't be undone."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onChoose(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onChoose(true)}
            disabled={deleting}
            autoFocus
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
