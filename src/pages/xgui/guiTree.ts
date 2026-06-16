/**
 * guiTree — the frontend mirror of the backend `get_gui_tree` (B1) read model,
 * plus the pure helpers the component-list panel (F8) renders and validates from.
 *
 * The backend returns a recursive {@link GuiFolder} mirroring the on-disk `gui/`
 * tree (subfolders + lightweight per-file refs). This module owns ONLY the
 * data-prep that surface needs: flattening the tree into a render-ready row list
 * (so collapse state and indentation stay declarative), collecting every folder
 * path for the destination picker, and the tree-wide basename collision check
 * that produces the design-mandated specific message.
 *
 * It does NO IO and NO rendering — the React panel calls `get_gui_tree`,
 * `create_component`, `create_folder` and feeds their results through here.
 *
 * @see design/xgui_ta.md — "Component list (leftmost, collapsible)" and the
 *   architect subsection "Component list as a recursive tree + create-flow
 *   mechanics resolved" (subsections (1)–(3): tree-wide basename uniqueness).
 */

/** "view" (top-level screen) vs "widget" (reusable sub-component). */
export type GuiComponentKind = "view" | "widget";

/** A single `.xml` component file, as returned by `get_gui_tree`. */
export type GuiComponentRef = {
  /** Basename without extension, e.g. "bag_slot". */
  name: string;
  /** Full filename, e.g. "bag_slot.xml". */
  fileName: string;
  /** gui-relative path to the file, e.g. "widgets/bag_slot.xml". */
  path: string;
  /** "view" if the root element is `<View>`, else "widget". */
  kind: GuiComponentKind;
  /** Sibling "{name}_controller.lua" if one exists alongside, else null. */
  controllerFileName: string | null;
};

/** A folder in the `gui/` tree (recursive); the root has an empty name + path. */
export type GuiFolder = {
  /** Folder name ("" for the gui/ root). */
  name: string;
  /** gui-relative path ("" root, "widgets", "profile/cards"). */
  path: string;
  /** Subfolders, recursive. */
  folders: GuiFolder[];
  /** `.xml` component files directly in this folder. */
  components: GuiComponentRef[];
};

/**
 * A flattened, render-ready row of the tree. The panel renders this list
 * directly: folders and components interleaved in depth-first order, each
 * carrying its `depth` (for indentation) so the component never recurses in JSX.
 *
 * A folder row is hidden when any ancestor folder is collapsed; this flatten
 * already applies that filtering, so the panel just maps the result.
 */
export type GuiTreeRow =
  | {
      kind: "folder";
      /** gui-relative folder path ("" never appears — the root is not a row). */
      path: string;
      /** Display name (folder basename). */
      name: string;
      depth: number;
      /** Whether this folder is currently collapsed (drives the chevron). */
      collapsed: boolean;
      /** Whether the folder has any children at all (folders or components). */
      hasChildren: boolean;
    }
  | {
      kind: "component";
      component: GuiComponentRef;
      depth: number;
    };

/**
 * Flatten a {@link GuiFolder} tree into an ordered row list for rendering,
 * honoring the set of collapsed folder paths.
 *
 * The root folder itself is NOT emitted as a row — its direct folders and
 * components are the top-level rows (depth 0). Within a folder, subfolders are
 * listed before components (matching the backend's folders-then-components sort).
 * A collapsed folder still emits its own row, but none of its descendants.
 */
export function flattenTree(root: GuiFolder, collapsed: ReadonlySet<string>): GuiTreeRow[] {
  const rows: GuiTreeRow[] = [];

  function walk(folder: GuiFolder, depth: number): void {
    for (const sub of folder.folders) {
      const isCollapsed = collapsed.has(sub.path);
      rows.push({
        kind: "folder",
        path: sub.path,
        name: sub.name,
        depth,
        collapsed: isCollapsed,
        hasChildren: sub.folders.length > 0 || sub.components.length > 0,
      });
      if (!isCollapsed) walk(sub, depth + 1);
    }
    for (const component of folder.components) {
      rows.push({ kind: "component", component, depth });
    }
  }

  walk(root, 0);
  return rows;
}

/** A destination-folder option for the New-component dialog's picker. */
export type FolderOption = {
  /** gui-relative path; "" is the `gui/` root. */
  path: string;
  /** A human label: "gui/ (root)" for "", else the path. */
  label: string;
};

/**
 * Every folder in the tree as a flat, depth-first list of picker options,
 * always leading with the `gui/` root. Used by the New-component dialog's
 * destination dropdown and to validate an inline-created folder's parent.
 */
export function collectFolderOptions(root: GuiFolder): FolderOption[] {
  const options: FolderOption[] = [{ path: "", label: "gui/ (root)" }];

  function walk(folder: GuiFolder): void {
    for (const sub of folder.folders) {
      options.push({ path: sub.path, label: sub.path });
      walk(sub);
    }
  }

  walk(root);
  return options;
}

/**
 * Every component basename in the tree, mapped to the gui-relative folder it
 * lives in ("" for the root). Used by the tree-wide collision check below.
 */
export function indexComponentsByName(root: GuiFolder): Map<string, string> {
  const index = new Map<string, string>();

  function walk(folder: GuiFolder): void {
    for (const component of folder.components) {
      index.set(component.name, folder.path);
    }
    for (const sub of folder.folders) walk(sub);
  }

  walk(root);
  return index;
}

/**
 * The tree-wide basename uniqueness check (the load-bearing create-flow
 * invariant — design subsection (3)). Component basenames must be unique across
 * the WHOLE `gui/` tree, not just within the destination folder, because the
 * asset manifest is basename-keyed and `<Component src>` resolves by basename.
 *
 * Returns a CLEAR, SPECIFIC message naming where the existing component lives
 * (e.g. "A component named \"button\" already exists in screens/.") when `name`
 * collides, or `null` when the name is free. The backend enforces the same rule
 * as the source of truth; this is the cheap, specific front-line message so the
 * user never sees a mysterious failure.
 */
export function collisionMessage(root: GuiFolder, name: string): string | null {
  const existingFolder = indexComponentsByName(root).get(name);
  if (existingFolder === undefined) return null;
  const where = existingFolder === "" ? "the gui/ root" : `${existingFolder}/`;
  return `A component named "${name}" already exists in ${where}.`;
}

/**
 * Normalize a free-typed display name into the lower_snake_case basename the
 * backend writes to disk (`{name}.xml`). Mirrors the create-flow's
 * "{component_name_in_snake_case}.xml" rule: lowercase, non-alphanumerics
 * collapse to single underscores, leading/trailing underscores trimmed.
 */
export function toComponentBasename(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Whether a basename is a legal lower_snake_case identifier (a–z, 0–9, _). */
export function isValidBasename(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}
