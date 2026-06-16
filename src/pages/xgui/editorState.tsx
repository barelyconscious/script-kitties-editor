/**
 * editorState — the XGUI editor's SHARED open-component store (F8 establishes it;
 * F7/F9/F10/F11 extend it). This is the single source of truth for the component
 * that is currently open in the editor, and the deliberate cross-cutting seam the
 * rest of the GUI editor reads and writes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A STORE (and why this shape)
 * ─────────────────────────────────────────────────────────────────────────────
 * Many sibling panels — the structure tree, properties, events, the preview, the
 * controller tab, the save button — all act on ONE open component. Lifting that
 * state into a context + reducer keeps a single authoritative copy that every
 * panel joins by {@link GuiNode.nodeId} / `selectedNodeId`, instead of prop-
 * drilling a growing bundle through the page shell. The reducer is pure and
 * exhaustively-typed so each later feature adds an action variant, not an ad-hoc
 * setter, and the dirty flag is derived in ONE place (every mutating action sets
 * it; save clears it).
 *
 * The shape below is a conventional document store (open doc + selection + a few
 * editor-view bits + dirty). It needs no architecture judgment beyond the design
 * doc — F7/F9/F10/F11 each map cleanly onto a new action, documented inline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXTENSION POINTS (how later features plug in — keep this list current)
 * ─────────────────────────────────────────────────────────────────────────────
 *  • F8 (this task) — OPEN a component: `open` seats a fresh {@link OpenComponent}
 *    (parsed root, name/path, controllerFileName, model text, View tab, clean).
 *    `closeComponent` clears it. SELECTION is here too (`select`) so the preview
 *    highlights immediately; the tree (F9a) writes the same `selectedNodeId`.
 *  • F9a (tree + selection) — reads/writes `selectedNodeId` via `select`, and
 *    ADDS a child to the node tree via `addChildNode` (a finer, intent-named
 *    tree-mutation action layered on the same dirty discipline as `replaceRoot`;
 *    the immutable append itself lives in the pure `guiTreeEdit` module so it is
 *    unit-tested without the store). Any tree mutation marks dirty. Delete /
 *    reparent are deferred (task 452 is ADD only), so no remove/move action yet.
 *    `replaceRoot` remains the wholesale escape hatch for F9b/F7 writebacks.
 *  • F9b (properties) — edits a node's `attrs` via the `setNodeAttrs` action,
 *    which replaces one node's attrs by nodeId and marks dirty (the immutable
 *    replace lives in the pure `guiTreeEdit.setNodeAttrs` so it is unit-tested
 *    off-store). A nodeId that is not found is a no-op (no dirty). F7 (drag)
 *    writes a moved node's `position` through this SAME action.
 *  • F9c (events) — `<Event>` children of `<View>` are ordinary nodes in `root`,
 *    so ADD flows through the same `addChildNode` action as F9a, and REMOVE uses
 *    the `removeNode` action (the immutable detach lives in the pure
 *    `guiTreeEdit.removeNode`). The events panel is the only caller of `removeNode`
 *    today — general tree delete stays deferred.
 *  • F10 (controller tab) — `activeTab` toggles View/Controller. The controller
 *    TEXT lives in `open.controllerText` (`null` = not-yet-loaded). Three actions
 *    feed it: `loadControllerText` seats disk contents WITHOUT dirtying (the tab
 *    lazily reads an existing controller via `get_script`); `setControllerText`
 *    holds a user edit and DIRTIES (F11 persists it); `addController` is the
 *    Add-script flow — it sets `<View controller="…">`, seeds an EMPTY buffer,
 *    flips to the controller tab, and dirties, all WITHOUT touching disk (the
 *    `.lua` file is created later by F11's Save, consistent with manual-save).
 *  • F11 (dirty + save) — reads `dirty`; on a successful `save_component` calls
 *    `markSaved` to clear it. The reducer already centralizes dirty so save is a
 *    single clear.
 *  • F7 (drag) — writes a moved node's `position` via the same `setNodeAttrs`
 *    node-attr path as F9b; marks dirty. No new state, just another writer.
 *
 * Render note: only ONE component is open at a time (the design's single
 * structure column / single preview), so this store holds a single document, not
 * a map of open docs — mirroring the design's "one selection state for the active
 * component."
 */

import { createContext, type ReactNode, useContext, useMemo, useReducer } from "react";
import type { GuiNode } from "../../lib/guiNode";
import { addChild, removeNode, setNodeAttrs } from "./guiTreeEdit";

/** Which main-content tab is showing (design section 4). */
export type EditorTab = "view" | "controller";

/**
 * The currently-open component and everything the editor surfaces edit. `null`
 * when nothing is open (the page shows its empty state).
 */
export type OpenComponent = {
  /** Bare basename, e.g. "bag" — the `get_component`/`save_component` key. */
  name: string;
  /** gui-relative path to the .xml, e.g. "widgets/bag.xml" (for display). */
  path: string;
  /**
   * The sibling controller filename detected at list time (or reconciled from
   * the `<View controller=…>` attr on open), or `null` if none yet. F10's
   * Add-script flow sets this when it creates a controller.
   */
  controllerFileName: string | null;
  /** The parsed, in-memory element tree — the single edit target. */
  root: GuiNode;
  /** Raw Data Model JSON text driving the preview's `{token}` resolution. */
  modelText: string;
  /**
   * The controller `.lua` working draft for the Controller tab (F10), held here
   * so F11's Save can persist it alongside the XML. `null` means "not yet
   * loaded" — a component with a `controllerFileName` reads its text from disk
   * (via `get_script`) on first view of the Controller tab and seeds it through
   * `loadControllerText` (which does NOT dirty). A controller-less component
   * stays `null` until Add-script seeds an empty buffer through `addController`.
   * Once non-null, user edits flow through `setControllerText` (which dirties).
   */
  controllerText: string | null;
};

/** The whole editor store state. */
export type EditorState = {
  /** The open component, or `null` when nothing is open. */
  open: OpenComponent | null;
  /** The single selection (a `nodeId` in `open.root`), shared tree↔preview. */
  selectedNodeId: string | null;
  /** The active main-content tab. */
  activeTab: EditorTab;
  /** True when the open component has unsaved edits (F11 reads; save clears). */
  dirty: boolean;
};

/**
 * The action set. Each later feature adds a variant here rather than reaching
 * around the reducer with an ad-hoc setter — see EXTENSION POINTS above.
 */
export type EditorAction =
  /** Seat a freshly-parsed component (F8 open-flow). Resets selection/tab/dirty. */
  | { type: "open"; component: OpenComponent }
  /** Clear the open component (back to the empty state). */
  | { type: "close" }
  /** Set the shared selection (tree click / preview click). */
  | { type: "select"; nodeId: string | null }
  /** Switch the main-content tab. */
  | { type: "setTab"; tab: EditorTab }
  /** Update the Data Model JSON text (preview-only; does NOT mark dirty). */
  | { type: "setModelText"; text: string }
  /** Replace the node tree wholesale after a structural edit — marks dirty. */
  | { type: "replaceRoot"; root: GuiNode }
  /**
   * Add `child` as the last child of `parentNodeId` (F9a add-child) and select
   * the new node — marks dirty. A no-op (and no selection change) if nothing is
   * open or the parent is not found. The immutable append is delegated to the
   * pure {@link addChild} so the mutation is tested off-store.
   */
  | { type: "addChildNode"; parentNodeId: string; child: GuiNode }
  /**
   * Replace the `attrs` of the node identified by `nodeId` (F9b properties edit /
   * F7 drag writeback) — marks dirty. A no-op (no dirty) if nothing is open or the
   * node is not found. The immutable replace is delegated to the pure
   * {@link setNodeAttrs} so the mutation is tested off-store.
   */
  | { type: "setNodeAttrs"; nodeId: string; attrs: Record<string, string> }
  /**
   * Remove the node identified by `nodeId` from the tree (F9c events delete) —
   * marks dirty. A no-op (no dirty) if nothing is open, the node is not found, or
   * the node is the root. The immutable detach is delegated to the pure
   * {@link removeNode} so the mutation is tested off-store. Scoped to `<Event>`
   * removal today; general tree delete remains deferred.
   */
  | { type: "removeNode"; nodeId: string }
  /**
   * Seat the controller's on-disk contents into the working draft WITHOUT marking
   * dirty (F10 lazy-load: the Controller tab read an existing controller via
   * `get_script`). A no-op if nothing is open. Distinct from `setControllerText`
   * precisely because loading what is already saved must not look like an edit.
   */
  | { type: "loadControllerText"; text: string }
  /**
   * Update the controller working draft from a user edit (F10) — marks dirty. A
   * no-op if nothing is open. F11's Save reads `open.controllerText` and persists
   * it to `open.controllerFileName`.
   */
  | { type: "setControllerText"; text: string }
  /**
   * Add-script flow (F10): attach a brand-new controller to a controller-less
   * component WITHOUT touching disk. Sets the root `<View controller="{name}">`
   * attribute, records `controllerFileName`, seeds an EMPTY controller buffer,
   * flips to the controller tab, and marks dirty. The `.lua` file itself is
   * created later by F11's Save (manual-save model). A no-op if nothing is open
   * or the open component already has a controller.
   */
  | { type: "addController"; fileName: string }
  /** Clear the dirty flag after a successful save (F11). */
  | { type: "markSaved" };

const initialState: EditorState = {
  open: null,
  selectedNodeId: null,
  activeTab: "view",
  dirty: false,
};

/**
 * The single pure reducer. Mutating actions (structural tree edits) set `dirty`;
 * preview-only edits (the Data Model text) do not; `open` and `markSaved` clear
 * it. Keeping every dirty transition here is what lets F11 treat save as one
 * `markSaved` and never hunt for stray setters.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "open":
      return {
        open: action.component,
        selectedNodeId: null,
        activeTab: "view",
        dirty: false,
      };
    case "close":
      return initialState;
    case "select":
      return { ...state, selectedNodeId: action.nodeId };
    case "setTab":
      return { ...state, activeTab: action.tab };
    case "setModelText":
      // Preview-only: the data model drives rendering, not the saved artifact, so
      // typing JSON must NOT make the component look unsaved.
      if (!state.open) return state;
      return { ...state, open: { ...state.open, modelText: action.text } };
    case "replaceRoot":
      if (!state.open) return state;
      return { ...state, open: { ...state.open, root: action.root }, dirty: true };
    case "addChildNode": {
      if (!state.open) return state;
      const nextRoot = addChild(state.open.root, action.parentNodeId, action.child);
      // Parent not found → addChild returns the SAME reference → no-op (don't
      // dirty or move selection on a phantom add).
      if (nextRoot === state.open.root) return state;
      return {
        ...state,
        open: { ...state.open, root: nextRoot },
        // Select the freshly-added node so it highlights in the tree and preview
        // immediately — the user sees what they just added.
        selectedNodeId: action.child.nodeId,
        dirty: true,
      };
    }
    case "setNodeAttrs": {
      if (!state.open) return state;
      const nextRoot = setNodeAttrs(state.open.root, action.nodeId, action.attrs);
      // Node not found → setNodeAttrs returns the SAME reference → no-op (don't
      // dirty on a phantom write).
      if (nextRoot === state.open.root) return state;
      return { ...state, open: { ...state.open, root: nextRoot }, dirty: true };
    }
    case "removeNode": {
      if (!state.open) return state;
      const nextRoot = removeNode(state.open.root, action.nodeId);
      // Node not found / is the root → removeNode returns the SAME reference →
      // no-op (don't dirty on a phantom remove).
      if (nextRoot === state.open.root) return state;
      return {
        ...state,
        open: { ...state.open, root: nextRoot },
        // If the removed node was selected, drop the dangling selection.
        selectedNodeId: state.selectedNodeId === action.nodeId ? null : state.selectedNodeId,
        dirty: true,
      };
    }
    case "loadControllerText":
      // Lazy-load of the saved controller: it IS the on-disk state, so seating it
      // must NOT make the component look unsaved (mirrors `setModelText`).
      if (!state.open) return state;
      return { ...state, open: { ...state.open, controllerText: action.text } };
    case "setControllerText":
      if (!state.open) return state;
      return { ...state, open: { ...state.open, controllerText: action.text }, dirty: true };
    case "addController": {
      if (!state.open) return state;
      // Already has a controller → Add-script is meaningless; leave it be.
      if (state.open.controllerFileName) return state;
      const root = state.open.root;
      // Set the <View controller="…"> attribute on the root (the authoritative
      // reference F11 / the runtime read). Only a <View> root carries it.
      const nextRoot =
        root.tag === "View"
          ? setNodeAttrs(root, root.nodeId, { ...root.attrs, controller: action.fileName })
          : root;
      return {
        ...state,
        open: {
          ...state.open,
          root: nextRoot,
          controllerFileName: action.fileName,
          // Seed an EMPTY buffer — the new controller has no contents until typed;
          // F11's Save writes whatever this holds to the new `.lua`.
          controllerText: "",
        },
        // Show the user the editor they just created.
        activeTab: "controller",
        dirty: true,
      };
    }
    case "markSaved":
      return { ...state, dirty: false };
    default: {
      // Exhaustiveness guard: a new action variant must be handled above.
      const _never: never = action;
      return _never;
    }
  }
}

/** The store's value: current state + the dispatch every panel calls. */
export type EditorStore = {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
};

const EditorContext = createContext<EditorStore | null>(null);

/**
 * Provider for the shared open-component store. Mount it once at the top of the
 * XGUI page so the component list, structure column, preview, and controller tab
 * all read and write the same document.
 */
export function EditorStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const store = useMemo<EditorStore>(() => ({ state, dispatch }), [state]);
  return <EditorContext.Provider value={store}>{children}</EditorContext.Provider>;
}

/** Access the shared editor store. Must be called under {@link EditorStateProvider}. */
export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext);
  if (!store) {
    throw new Error("useEditorStore must be used within an EditorStateProvider");
  }
  return store;
}
