/**
 * OpenErrorDialog — surfaced when opening a component fails (a malformed XML parse
 * error or a read/missing-file error). Shown as a MODAL rather than inline so the
 * component list stays visible and selectable: a bad-XML component must not lock
 * the user out of picking a different one.
 *
 * Dismissing (overlay click, Esc, the X, or Close) just clears the error and leaves
 * whatever component was already open untouched — opening a bad component never
 * disturbs the current document.
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

export type OpenErrorDialogProps = {
  /** The open/parse error message, or null when there is nothing to show. */
  error: string | null;
  /** Clear the error (any dismiss path). */
  onDismiss: () => void;
};

export function OpenErrorDialog({ error, onDismiss }: OpenErrorDialogProps) {
  return (
    <Dialog
      open={error != null}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Couldn’t open component</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap break-words font-mono text-foreground text-xs">
            {error}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onDismiss}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
