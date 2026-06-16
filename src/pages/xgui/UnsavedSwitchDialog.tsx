/**
 * UnsavedSwitchDialog — the Save / Discard / Cancel prompt shown when the user
 * tries to open a different component while the open one has unsaved edits (F11,
 * design section 7). Presentational: it renders the three choices and reports the
 * pick; the caller (the component list) owns the actual save/switch sequencing.
 *
 * Dismissing the dialog (overlay click, Esc, the X) is treated as Cancel — the
 * safe default that keeps the user's edits and stays on the current component.
 *
 * @see design/xgui_ta.md — section 7 "Warn on switch".
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
import type { SwitchChoice } from "./switchGuard";

export type UnsavedSwitchDialogProps = {
  /** Whether the prompt is shown. */
  open: boolean;
  /** Basename of the component with unsaved edits (for the message). */
  componentName: string | null;
  /** True while a Save triggered from this prompt is in flight. */
  saving?: boolean;
  /** Report the user's choice. Overlay/Esc/X dismiss reports `"cancel"`. */
  onChoose: (choice: SwitchChoice) => void;
};

export function UnsavedSwitchDialog({
  open,
  componentName,
  saving = false,
  onChoose,
}: UnsavedSwitchDialogProps) {
  return (
    <Dialog
      open={open}
      // Any non-explicit close (overlay/Esc/X) is a Cancel — never silently lose
      // edits on a stray dismiss.
      onOpenChange={(next) => {
        if (!next) onChoose("cancel");
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            {componentName ? (
              <>
                <span className="font-mono text-foreground">{componentName}</span> has unsaved
                changes. Save them before switching?
              </>
            ) : (
              "The open component has unsaved changes. Save them before switching?"
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onChoose("cancel")} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => onChoose("discard")}
            disabled={saving}
            className="text-destructive hover:text-destructive"
          >
            Discard
          </Button>
          <Button onClick={() => onChoose("save")} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
