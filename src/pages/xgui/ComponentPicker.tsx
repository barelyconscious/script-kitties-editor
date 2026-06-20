/**
 * ComponentPicker — the searchable basename picker the structure tree opens when
 * the user adds a `<Component>` child (F9a). It lists every component across the
 * WHOLE `gui/` tree by bare basename (the folder shown only as a disambiguating
 * hint), and on pick writes the chosen component's `.xml` FILENAME into the new
 * `<Component>`'s `src` (e.g. `bag_slot.xml`).
 *
 * Why filename (with `.xml`): `<Component src>` resolves on the canonical `.xml`
 * form (matching the `assets.json` key), so the picker appends the extension for the
 * user — they only ever pick/type a name. Why basename (no path): per design
 * subsection (3) `src` resolves by basename across the whole tree (the manifest is
 * basename-keyed and basenames are tree-wide unique), so the value is the filename,
 * never a folder path. The folder is a human hint only.
 *
 * The list is loaded from `get_gui_tree` (B1) when the dialog opens, so it reflects
 * the current project without the tree panel owning that fetch.
 *
 * @see design/xgui_ta.md — "Structure column" (component picker) and subsection (3)
 *   ("the picker writes the bare basename into src").
 */

import { invoke } from "@tauri-apps/api/core";
import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { GuiFolder } from "./guiTree";
import { type ComponentPickItem, componentPickItems, filterPickItems } from "./guiTreeEdit";

export type ComponentPickerProps = {
  /** Whether the picker dialog is open. */
  open: boolean;
  /** Close the dialog (cancel, escape, overlay click, or after a pick). */
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the `src` value to write into the new `<Component>` — the chosen
   * component's filename WITH its `.xml` extension (`bag_slot.xml`), the canonical
   * form the resolver requires. The dialog closes itself after.
   */
  onPick: (src: string) => void;
  /**
   * The bare basename of the component currently being edited, if any. It is
   * EXCLUDED from the list so a component can never include itself (a direct
   * self-reference is unrenderable — the mount engine would recurse infinitely).
   */
  excludeName?: string;
};

export function ComponentPicker({ open, onOpenChange, onPick, excludeName }: ComponentPickerProps) {
  const [items, setItems] = useState<ComponentPickItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Load the basename list whenever the dialog opens. Reset query each open so the
  // user starts from the full list.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setItems(null);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const tree = await invoke<GuiFolder>("get_gui_tree");
        // Drop the open component itself — you can't add a component to its own
        // layout (basenames are tree-wide unique, so matching by name is exact).
        if (!cancelled)
          setItems(componentPickItems(tree).filter((item) => item.name !== excludeName));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load components.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, excludeName]);

  const filtered = useMemo(() => (items ? filterPickItems(items, query) : []), [items, query]);

  const handlePick = (basename: string) => {
    // Write the canonical `.xml` form into `src` — that is what the resolver requires
    // (a bare basename does not resolve), so the user never has to type the extension.
    onPick(`${basename}.xml`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a component</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search components…"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 min-h-24 overflow-y-auto rounded-md border">
          {error ? (
            <p className="px-3 py-6 text-center text-destructive text-sm">{error}</p>
          ) : items === null ? (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              {items.length === 0
                ? "No components in the project yet."
                : `Nothing matches “${query}”.`}
            </p>
          ) : (
            <ul>
              {filtered.map((item) => (
                <li key={item.folder ? `${item.folder}/${item.name}` : item.name}>
                  <button
                    type="button"
                    onClick={() => handlePick(item.name)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0 truncate font-mono">{item.name}</span>
                    <span className="shrink-0 truncate text-muted-foreground text-xs">
                      {item.folder === "" ? "gui/" : `${item.folder}/`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
