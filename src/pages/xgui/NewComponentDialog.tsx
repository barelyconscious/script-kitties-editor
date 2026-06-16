/**
 * NewComponentDialog — the "+ New component" flow for the component-list panel
 * (F8). Asks for a display name and a destination folder (an existing folder or
 * one created inline), derives the lower_snake_case basename, runs the tree-wide
 * collision check up front, and on Create calls `create_component` (B3) with a
 * minimal `<View>` body, then reports success so the panel refreshes + opens it.
 *
 * The dialog is the React shell around the pure helpers in {@link guiTree}
 * (basename derivation, collision message, folder options); validation lives
 * there so it stays testable.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  collectFolderOptions,
  collisionMessage,
  folderRelFromSelectValue,
  type GuiFolder,
  isValidBasename,
  selectValueFromFolderRel,
  toComponentBasename,
} from "./guiTree";

export type NewComponentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current tree — drives the destination picker and the collision check. */
  tree: GuiFolder;
  /** Destination folder to preselect (e.g. a right-clicked folder); defaults to root. */
  initialFolder?: string;
  /** Called after a successful create with the new component's basename + folder. */
  onCreated: (created: { name: string; folderRel: string }) => void;
};

/** The minimal valid body a brand-new component is created with. */
function defaultViewXml(): string {
  return "<View>\n</View>\n";
}

/**
 * The New-component dialog. Name → derived basename, a destination dropdown of
 * every folder (plus an inline "create folder" affordance), the tree-wide
 * collision message inline, and the `create_component` call on submit.
 */
export function NewComponentDialog({
  open,
  onOpenChange,
  tree,
  initialFolder = "",
  onCreated,
}: NewComponentDialogProps) {
  const [name, setName] = useState("");
  const [folderRel, setFolderRel] = useState(initialFolder);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Inline folder creation: a small sub-form that appends a folder under the
  // currently-selected destination, then selects the newly-created folder.
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);

  const folderOptions = useMemo(() => collectFolderOptions(tree), [tree]);

  // Re-seed every time the dialog opens so a previous attempt's text never leaks.
  useEffect(() => {
    if (open) {
      setName("");
      setFolderRel(initialFolder);
      setBusy(false);
      setSubmitError(null);
      setCreatingFolder(false);
      setNewFolderName("");
      setFolderError(null);
    }
  }, [open, initialFolder]);

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

  async function handleCreateFolder() {
    const folderName = toComponentBasename(newFolderName);
    if (!isValidBasename(folderName)) {
      setFolderError("Folder name must be a valid lower_snake_case identifier.");
      return;
    }
    setFolderError(null);
    try {
      await invoke("create_folder", { parentRel: folderRel, name: folderName });
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err));
      return;
    }
    // Select the freshly-created folder as the destination and collapse the form.
    const createdPath = folderRel === "" ? folderName : `${folderRel}/${folderName}`;
    setFolderRel(createdPath);
    setCreatingFolder(false);
    setNewFolderName("");
    // The parent owns the tree; it refreshes after onCreated, but the new folder
    // also needs to be a selectable option now. We optimistically keep the chosen
    // path; the create_component call below targets it regardless of the picker.
  }

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

  // The destination picker needs the inline-created folder to be selectable even
  // before the parent's tree refresh lands. Merge it in if it isn't there yet.
  const options = useMemo(() => {
    if (folderRel !== "" && !folderOptions.some((o) => o.path === folderRel)) {
      return [...folderOptions, { path: folderRel, label: folderRel }];
    }
    return folderOptions;
  }, [folderOptions, folderRel]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New component</DialogTitle>
          <DialogDescription>
            Create a GUI component (a <code className="font-mono">{".xml"}</code> file) in the
            chosen folder. Component names must be unique across the whole gui/ tree.
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
            <Input
              id="new-component-name"
              autoFocus
              value={name}
              disabled={busy}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setName(value);
              }}
              placeholder="Display name"
              aria-invalid={!!nameError}
            />
            {basename && !nameError && (
              <p className="text-muted-foreground text-xs">
                Creates <code className="font-mono">{basename}.xml</code>
              </p>
            )}
            {nameError && <p className="text-destructive text-xs">{nameError}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-component-folder">Destination folder</Label>
            <div className="flex items-center gap-2">
              {/* Radix forbids an empty Select.Item value, so the gui-root option
                  is carried as a non-empty sentinel and mapped back to "" (the real
                  folderRel) at this boundary; `folderRel` state stays canonical. */}
              <Select
                value={selectValueFromFolderRel(folderRel)}
                disabled={busy}
                onValueChange={(v) => setFolderRel(folderRelFromSelectValue(v))}
              >
                <SelectTrigger id="new-component-folder" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem key={opt.path} value={selectValueFromFolderRel(opt.path)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setCreatingFolder((v) => !v)}
              >
                New folder
              </Button>
            </div>

            {creatingFolder && (
              <div className="mt-1 grid gap-1.5 rounded-md border bg-muted/30 p-2">
                <Label htmlFor="new-component-folder-name" className="text-xs">
                  New folder under{" "}
                  <code className="font-mono">{folderRel === "" ? "gui/" : `${folderRel}/`}</code>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="new-component-folder-name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.currentTarget.value)}
                    placeholder="folder_name"
                    aria-invalid={!!folderError}
                  />
                  <Button type="button" size="sm" onClick={handleCreateFolder}>
                    Create
                  </Button>
                </div>
                {folderError && <p className="text-destructive text-xs">{folderError}</p>}
              </div>
            )}
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
