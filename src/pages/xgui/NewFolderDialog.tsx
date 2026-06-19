/**
 * NewFolderDialog — the "New folder" flow for the component-list panel header
 * (F8). Creates a top-level folder under the gui/ root: it asks for a display
 * name, derives the lower_snake_case basename, checks it against the existing
 * root folders up front, and on Create calls `create_folder` (B?) with
 * `parentRel: ""`, then reports success so the panel refreshes.
 *
 * This replaces the previous `window.prompt`/`window.alert` flow with the same
 * dialog shell + inline validation the {@link NewComponentDialog} uses, so naming
 * a folder reads identically to naming a component.
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
import { type GuiFolder, isValidBasename, toComponentBasename } from "./guiTree";

export type NewFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current tree — drives the root-folder name collision check. */
  tree: GuiFolder;
  /** Called after a successful create with the new folder's basename. */
  onCreated: (created: { name: string }) => void;
};

/**
 * The New-folder dialog, scoped to the gui/ root. Name → derived basename, an
 * inline collision message against the existing root folders, and the
 * `create_folder` call on submit.
 */
export function NewFolderDialog({ open, onOpenChange, tree, onCreated }: NewFolderDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-seed every time the dialog opens so a previous attempt's text never leaks.
  useEffect(() => {
    if (open) {
      setName("");
      setBusy(false);
      setSubmitError(null);
    }
  }, [open]);

  const basename = toComponentBasename(name);
  // Validation, in priority order: empty name, illegal basename, then collision
  // against an existing top-level folder.
  const nameError = useMemo(() => {
    if (name.trim().length === 0) return null; // don't shout before they type
    if (!isValidBasename(basename)) {
      return "Name must start with a letter and use only letters, numbers, and underscores.";
    }
    if (tree.folders.some((f) => f.name === basename)) {
      return `A folder named "${basename}" already exists.`;
    }
    return null;
  }, [name, basename, tree]);

  const canSubmit = name.trim().length > 0 && isValidBasename(basename) && !nameError && !busy;

  async function handleCreate() {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await invoke("create_folder", { parentRel: "", name: basename });
    } catch (err) {
      setBusy(false);
      setSubmitError(err instanceof Error ? err.message : String(err));
      return;
    }
    onOpenChange(false);
    onCreated({ name: basename });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Create a folder under <code className="font-mono">gui/</code> to organize components.
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {submitError}
          </div>
        )}

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="new-folder-name">Name</Label>
            <Input
              id="new-folder-name"
              autoFocus
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) void handleCreate();
              }}
              placeholder="Display name"
              aria-invalid={!!nameError}
            />
            {basename && !nameError && (
              <p className="text-muted-foreground text-xs">
                Creates <code className="font-mono">gui/{basename}/</code>
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

export default NewFolderDialog;
