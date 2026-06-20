/**
 * NewComponentDialog — the "+ New component" flow for the component-list panel
 * (F8). Always opened SCOPED to a specific destination folder (the folder whose
 * hover "+" was clicked, or the gui/ root): it asks only for a display name,
 * derives the lower_snake_case basename, runs the tree-wide collision check up
 * front, and on Create calls `create_component` (B3) with a minimal `<View>`
 * body, then reports success so the panel refreshes + opens it.
 *
 * The dialog is the React shell around the pure helpers in {@link guiTree}
 * (basename derivation, collision message, scope label); validation lives there
 * so it stays testable.
 *
 * @see design/xgui_ta.md — "Creating things" under the Component list section.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  collisionMessage,
  folderScopeLabel,
  type GuiFolder,
  isValidBasename,
  toComponentBasename,
} from "./guiTree";

export type NewComponentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current tree — drives the tree-wide collision check. */
  tree: GuiFolder;
  /**
   * The destination folder this create is scoped to (the folder whose hover "+"
   * was clicked); "" is the gui/ root. Fixed for the lifetime of the dialog —
   * the dialog only asks for a name. `null` while the dialog is closed.
   */
  scopedFolder: string | null;
  /** Called after a successful create with the new component's basename + folder. */
  onCreated: (created: { name: string; folderRel: string }) => void;
};

/** The minimal valid body a brand-new component is created with. */
function defaultViewXml(): string {
  return "<View>\n</View>\n";
}

/**
 * The New-component dialog, scoped to a fixed destination folder. Name → derived
 * basename, the tree-wide collision message inline, and the `create_component`
 * call (targeting {@link NewComponentDialogProps.scopedFolder}) on submit. The
 * destination is shown, not chosen — the caller (a folder's hover "+", or the
 * root "+") fixes it.
 */
export function NewComponentDialog({
  open,
  onOpenChange,
  tree,
  scopedFolder,
  onCreated,
}: NewComponentDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Remember the last real scope so the title doesn't flash to "gui/" during the
  // dialog's close animation: on close the caller sets scopedFolder back to null,
  // but Radix keeps the content mounted while it animates out, so we keep showing
  // the scope it was opened with until it's fully gone.
  const [lastFolderRel, setLastFolderRel] = useState("");
  useEffect(() => {
    if (open && scopedFolder != null) setLastFolderRel(scopedFolder);
  }, [open, scopedFolder]);

  // The destination is fixed for this create. While open, use the live scope; once
  // closing (scopedFolder null), fall back to the remembered scope so the label is
  // stable through the exit animation.
  const folderRel = scopedFolder ?? lastFolderRel;

  // Re-seed every time the dialog opens so a previous attempt's text never leaks.
  useEffect(() => {
    if (open) {
      setName("");
      setBusy(false);
      setSubmitError(null);
    }
  }, [open]);

  const basename = toComponentBasename(name);
  // Validation, in priority order: empty name, illegal basename, then collision.
  const nameError = useMemo(() => {
    if (name.trim().length === 0) return null; // don't shout before they type
    if (!isValidBasename(basename)) {
      return "Name must start with a letter and use only letters, numbers, and underscores.";
    }
    return collisionMessage(tree, basename);
  }, [name, basename, tree]);

  const canSubmit = name.trim().length > 0 && isValidBasename(basename) && !nameError && !busy;

  async function handleCreate() {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await invoke("create_component", {
        folderRel,
        name: basename,
        xml: defaultViewXml(),
        controller: null,
      });
    } catch (err) {
      setBusy(false);
      setSubmitError(err instanceof Error ? err.message : String(err));
      return;
    }
    onOpenChange(false);
    onCreated({ name: basename, folderRel });
  }

  const scopeLabel = folderScopeLabel(folderRel);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            New component in <code className="font-mono">{scopeLabel}</code>
          </DialogTitle>
          <DialogDescription>
            Create a GUI component (a <code className="font-mono">{".xml"}</code> file) in{" "}
            <code className="font-mono">{scopeLabel}</code>. Component names must be unique across
            the whole gui/ tree.
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {submitError}
          </div>
        )}

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="new-component-name">Name</Label>
            <div className="relative">
              <Input
                id="new-component-name"
                autoFocus
                value={name}
                disabled={busy}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setName(value);
                }}
                placeholder="name"
                aria-invalid={!!nameError}
                className="pr-11 font-mono"
              />
              {/* The `.xml` extension is added automatically — shown muted so the user
                  types ONLY the name and never the extension. */}
              <span className="pointer-events-none absolute inset-y-0 right-3 flex select-none items-center font-mono text-muted-foreground text-sm">
                .xml
              </span>
            </div>
            {basename && !nameError && (
              <p className="text-muted-foreground text-xs">
                Creates <code className="font-mono">{basename}.xml</code>
              </p>
            )}
            {nameError && <p className="text-destructive text-xs">{nameError}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewComponentDialog;
