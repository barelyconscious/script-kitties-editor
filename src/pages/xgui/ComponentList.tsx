/**
 * ComponentList — the leftmost, collapsible component-list panel of the XGUI
 * editor (F8). A folder tree mirroring the on-disk `gui/` tree: collapsible
 * folders, a per-file View-vs-widget glyph, and an unsaved-changes dot on the
 * currently-open component when it is dirty. A folder-icon button in the header
 * creates a new top-level folder; a `gui/` root row and each folder row reveal a
 * hover `+` that creates a component scoped to that folder (the root row's `+`
 * targets the gui/ root).
 *
 * Tree data-prep (flatten + collision + folder options) lives in the pure
 * {@link guiTree} module; this component is the React shell that loads the tree
 * via `get_gui_tree`, renders the flattened rows, and dispatches open/select into
 * the shared {@link useEditorStore}.
 *
 * @see design/xgui_ta.md — "Component list (leftmost, collapsible)".
 */

import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FolderPlus,
  MonitorPlay,
  Plus,
  SearchIcon,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { GuiParseError } from "../../lib/guiNode";
import { DeleteComponentDialog } from "./DeleteComponentDialog";
import { deleteComponentArgs, shouldCloseOpen } from "./deleteComponent";
import { useEditorStore } from "./editorState";
import {
  flattenTree,
  type GuiComponentRef,
  type GuiFolder,
  type GuiTreeRow,
  isValidBasename,
  toComponentBasename,
} from "./guiTree";
import { useGuiTreeStore } from "./guiTreeStore";
import { NewComponentDialog } from "./NewComponentDialog";
import { buildOpenComponent } from "./openComponent";
import { decideSwitch, type SwitchChoice } from "./switchGuard";
import { UnsavedSwitchDialog } from "./UnsavedSwitchDialog";
import { useComponentSave } from "./useComponentSave";

/** Filter the tree to folders/components matching a query, keeping folder paths. */
function filterTree(tree: GuiFolder, query: string): GuiFolder {
  const q = query.trim().toLowerCase();
  if (q === "") return tree;

  function prune(folder: GuiFolder): GuiFolder | null {
    const components = folder.components.filter((c) => c.name.toLowerCase().includes(q));
    const folders = folder.folders.map(prune).filter((f): f is GuiFolder => f !== null);
    // Keep a folder if it (or a descendant) has any match, or its own name matches.
    if (components.length > 0 || folders.length > 0 || folder.name.toLowerCase().includes(q)) {
      return { ...folder, folders, components };
    }
    return null;
  }

  return prune(tree) ?? { ...tree, folders: [], components: [] };
}

export type ComponentListProps = {
  /** Whether the panel is collapsed (hidden); a slim rail is shown in its place. */
  collapsed?: boolean;
  className?: string;
};

export function ComponentList({ collapsed, className }: ComponentListProps) {
  const { state, dispatch } = useEditorStore();
  const { save, saving: savingSwitch } = useComponentSave();
  // Tree state + the get_gui_tree refetch are shared (lifted to the page) so F13's
  // live-reload glue can refresh the list on external edits and surface its
  // disk-change notice on the main editor pane.
  const { tree, loading, error: treeError, reload } = useGuiTreeStore();
  // An open/parse failure surfaced inline by THIS panel (distinct from the tree
  // load error, which lives in the shared store).
  const [openError, setOpenError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Collapsed folder paths. Empty = everything expanded.
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(() => new Set());
  // The destination folder the New-component dialog is scoped to ("" = gui/ root),
  // or null when the dialog is closed. Set by a folder row's hover "+" or the
  // header's root "+"; the dialog only asks for a name and creates into this folder.
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // The component the user asked to open while the current one is dirty — held
  // until the Save/Discard/Cancel prompt resolves (warn-on-switch, F11).
  const [pendingSwitch, setPendingSwitch] = useState<GuiComponentRef | null>(null);
  // The component the user asked to DELETE — held until the destructive confirm
  // resolves, or null when the confirm is closed. Components only (folders are not
  // deletable in this task).
  const [pendingDelete, setPendingDelete] = useState<GuiComponentRef | null>(null);
  // True while a confirmed delete is in flight (disables the confirm buttons).
  const [deleting, setDeleting] = useState(false);

  // The panel shows either kind of error: a failed tree load or a failed open.
  const error = treeError ?? openError;

  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);
  // When searching, force everything expanded so matches deep in the tree show.
  const effectiveCollapsed = query.trim()
    ? (new Set<string>() as ReadonlySet<string>)
    : collapsedFolders;
  const rows = useMemo(
    () => flattenTree(filtered, effectiveCollapsed),
    [filtered, effectiveCollapsed],
  );

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Open a component: read its XML, parse, seat it in the shared store. A parse
  // failure or read error surfaces inline without clearing the current open doc.
  const openComponent = useCallback(
    async (ref: GuiComponentRef) => {
      setOpenError(null);
      try {
        const xml = await invoke<string | null>("get_component", { name: ref.name });
        if (xml == null) {
          setOpenError(
            `Component "${ref.name}" could not be found on disk — it may have been deleted.`,
          );
          return;
        }
        const component = buildOpenComponent(ref, xml);
        dispatch({ type: "open", component });
      } catch (err) {
        const message =
          err instanceof GuiParseError
            ? `Could not parse "${ref.name}.xml": ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        setOpenError(message);
      }
    },
    [dispatch],
  );

  // Guarded entry every row click goes through: if the open component is dirty
  // and the user is switching to a DIFFERENT component, intercept with the
  // Save/Discard/Cancel prompt before discarding edits (warn-on-switch, F11).
  // A clean component (or re-selecting the open one) opens immediately.
  const requestOpen = useCallback(
    (ref: GuiComponentRef) => {
      if (
        decideSwitch({ openName: state.open?.name ?? null, dirty: state.dirty }, ref.name) ===
        "proceed"
      ) {
        void openComponent(ref);
        return;
      }
      setPendingSwitch(ref);
    },
    [state.open, state.dirty, openComponent],
  );

  // Resolve the warn-on-switch prompt. Save persists then switches (only if the
  // save lands — a failed save keeps us on the current component with the prompt
  // closed and the error surfaced by the Save button). Discard switches, losing
  // edits. Cancel stays put.
  const resolveSwitch = useCallback(
    async (choice: SwitchChoice) => {
      const ref = pendingSwitch;
      if (choice === "cancel") {
        setPendingSwitch(null);
        return;
      }
      if (choice === "save") {
        const ok = await save();
        // A failed save must NOT discard the user's edits — abort the switch and
        // leave them on the still-dirty component to retry or discard explicitly.
        if (!ok) {
          setPendingSwitch(null);
          return;
        }
      }
      // save succeeded, or the user chose to discard.
      setPendingSwitch(null);
      if (ref) void openComponent(ref);
    },
    [pendingSwitch, save, openComponent],
  );

  // Resolve the delete confirm. Cancel just closes it. Confirm calls
  // delete_component (passing the controller hint so the backend removes the
  // sibling .lua), then — if the deleted component was the OPEN one — closes the
  // editor so it doesn't dangle, clears any stale open error, and refreshes the
  // list to drop the row. A failed delete surfaces inline and keeps the row.
  const resolveDelete = useCallback(
    async (confirmed: boolean) => {
      const ref = pendingDelete;
      if (!confirmed || !ref) {
        setPendingDelete(null);
        return;
      }
      setDeleting(true);
      try {
        await invoke("delete_component", deleteComponentArgs(ref));
        // If the deleted component is the one open in the editor, close it so the
        // editor isn't left pointing at a component that no longer exists.
        if (shouldCloseOpen(state.open?.name ?? null, ref.name)) {
          dispatch({ type: "close" });
        }
        // Clear an inline open error that may name the just-deleted component.
        setOpenError(null);
        setPendingDelete(null);
        void reload();
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
        setPendingDelete(null);
      } finally {
        setDeleting(false);
      }
    },
    [pendingDelete, state.open, dispatch, reload],
  );

  // After a create: refresh the tree, then open the new component if we can find it.
  const handleCreated = useCallback(
    async ({ name }: { name: string; folderRel: string }) => {
      const fresh = await reload();
      if (!fresh) return;
      const ref = findComponentByName(fresh, name);
      if (ref) void openComponent(ref);
    },
    [reload, openComponent],
  );

  // The top-level New-folder action prompts for a name and creates it at the root.
  const handleNewFolder = useCallback(async () => {
    const raw = window.prompt("New folder name (under gui/):");
    if (raw == null) return;
    const folderName = toComponentBasename(raw);
    if (!isValidBasename(folderName)) {
      window.alert("Folder name must be a valid lower_snake_case identifier.");
      return;
    }
    try {
      await invoke("create_folder", { parentRel: "", name: folderName });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      return;
    }
    void reload();
  }, [reload]);

  const openName = state.open?.name ?? null;
  const isDirty = state.dirty;

  if (collapsed) return null;

  return (
    <div
      className={cn("flex h-full min-h-0 w-64 shrink-0 flex-col border-r bg-sidebar", className)}
    >
      <div className="flex items-center gap-1 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search components…"
            className="pl-8"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="New folder"
              onClick={handleNewFolder}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FolderPlus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {loading ? (
          <p className="px-3 py-8 text-center text-muted-foreground text-sm">Loading components…</p>
        ) : error ? (
          <p className="px-3 py-8 text-center text-destructive text-sm">{error}</p>
        ) : (
          <ul>
            {/* The gui/ root carries the same hover-"+" affordance as folder rows,
                so root-component creation persists now that the header "+" is gone. */}
            <RootRow onAddComponent={() => setNewFolder("")} />
            {rows.length === 0 ? (
              <li>
                <p className="px-3 py-8 text-center text-muted-foreground text-sm">
                  {query.trim()
                    ? `Nothing matches “${query}”.`
                    : "No components yet. Use + to create one."}
                </p>
              </li>
            ) : null}
            {rows.map((row) =>
              row.kind === "folder" ? (
                <FolderRow
                  key={`folder:${row.path}`}
                  row={row}
                  onToggle={() => toggleFolder(row.path)}
                  onAddComponent={() => setNewFolder(row.path)}
                />
              ) : (
                <ComponentRow
                  key={`component:${row.component.path}`}
                  row={row}
                  active={openName === row.component.name}
                  dirty={isDirty && openName === row.component.name}
                  onOpen={() => requestOpen(row.component)}
                  onDelete={() => setPendingDelete(row.component)}
                />
              ),
            )}
          </ul>
        )}
      </div>

      <NewComponentDialog
        open={newFolder != null}
        onOpenChange={(next) => {
          if (!next) setNewFolder(null);
        }}
        tree={tree}
        scopedFolder={newFolder}
        onCreated={handleCreated}
      />

      <UnsavedSwitchDialog
        open={pendingSwitch != null}
        componentName={state.open?.name ?? null}
        saving={savingSwitch}
        onChoose={(choice) => void resolveSwitch(choice)}
      />

      <DeleteComponentDialog
        open={pendingDelete != null}
        componentName={pendingDelete?.name ?? null}
        hasController={pendingDelete?.controllerFileName != null}
        deleting={deleting}
        onChoose={(confirmed) => void resolveDelete(confirmed)}
      />
    </div>
  );
}

/** Depth indentation step, in rem, applied per tree level. */
const INDENT_REM = 0.75;

/**
 * The `gui/` root row. Not collapsible (it has no chevron/toggle) and renders no
 * label button, but it mirrors {@link FolderRow}'s `group` hover-"+" so creating a
 * component at the root stays consistent with per-folder creation.
 */
function RootRow({ onAddComponent }: { onAddComponent: () => void }) {
  return (
    <li>
      <div className="group flex w-full min-w-0 items-center gap-1 pr-2 pl-2">
        <span className="min-w-0 flex-1 select-none truncate py-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          gui/
        </span>
        <button
          type="button"
          aria-label="New component in gui/ root"
          title="New component in gui/ root"
          onClick={onAddComponent}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function FolderRow({
  row,
  onToggle,
  onAddComponent,
}: {
  row: Extract<GuiTreeRow, { kind: "folder" }>;
  onToggle: () => void;
  onAddComponent: () => void;
}) {
  return (
    <li>
      {/* The row is a `group` so the hover "+" (mirroring StructureTree's add-child
          affordance) reveals on hover; the toggle and "+" are siblings, not nested
          buttons. */}
      <div
        className="group flex w-full min-w-0 items-center gap-1 pr-2 transition-colors hover:text-foreground"
        style={{ paddingLeft: `${0.5 + row.depth * INDENT_REM}rem` }}
      >
        <button
          type="button"
          onClick={onToggle}
          title={row.path}
          className="flex min-w-0 flex-1 select-none items-center gap-1 py-1 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide transition-colors group-hover:text-foreground"
        >
          {row.collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate">{row.name}</span>
        </button>
        <button
          type="button"
          aria-label={`New component in ${row.path}/`}
          title={`New component in ${row.path}/`}
          onClick={onAddComponent}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function ComponentRow({
  row,
  active,
  dirty,
  onOpen,
  onDelete,
}: {
  row: Extract<GuiTreeRow, { kind: "component" }>;
  active: boolean;
  dirty: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { component } = row;
  const Icon = component.kind === "view" ? MonitorPlay : FileCode2;
  const kindLabel = component.kind === "view" ? "View (screen)" : "Widget";
  return (
    <li>
      {/* The row is a `group` so the hover trash (mirroring the folder rows' hover
          "+" affordance) reveals on hover; the open button and the trash are
          siblings, never nested buttons. */}
      <div
        className={cn(
          "group flex w-full select-none items-center gap-2 pr-2 text-sm transition-colors hover:bg-muted",
          active && "bg-muted font-medium",
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          title={`${component.name} — ${kindLabel}`}
          style={{ paddingLeft: `${0.5 + row.depth * INDENT_REM}rem` }}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        >
          <Icon
            className={cn(
              "size-4 shrink-0",
              component.kind === "view" ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{component.name}</span>
          {dirty && (
            <span
              role="img"
              aria-label="Unsaved changes"
              title="Unsaved changes"
              className="size-1.5 shrink-0 rounded-full bg-primary"
            />
          )}
        </button>
        <button
          type="button"
          aria-label={`Delete ${component.name}`}
          title={`Delete ${component.name}`}
          onClick={onDelete}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

/** Depth-first search for a component by basename across the whole tree. */
function findComponentByName(folder: GuiFolder, name: string): GuiComponentRef | null {
  for (const component of folder.components) {
    if (component.name === name) return component;
  }
  for (const sub of folder.folders) {
    const found = findComponentByName(sub, name);
    if (found) return found;
  }
  return null;
}

export default ComponentList;
