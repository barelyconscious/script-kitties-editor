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
 *    `guiTreeEdit.removeNode`). The structure TREE is the only caller of
 *    `removeNode` today — and only for `<Event>` rows — so general tree delete
 *    stays deferred.
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
import { nodeHasId } from "./guiProperties";
import { addChild, findNode, nextAutoId, removeNode, setNodeAttrs } from "./guiTreeEdit";
import { remapSelection } from "./liveReload";

/**
 * Which main-content tab is showing (design section 4). `xml` is a read-only
 * live view of the serialized component (task 476) — it never mutates the
 * document, so it needs no new action, only this union member.
 */
export type EditorTab = "view" | "controller" | "xml";

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

/**
 * A captured snapshot of the open component's UNDOABLE document — the parts an
 * undo/redo restores. This is the VISUAL tree and the controller filename (the
 * only document fields a visual mutating action can change); selection, active
 * tab, dirty, and the Data Model JSON scratch are deliberately NOT here, because
 * they are view/scratch state, not the saved artifact. The `controller`
 * attribute that `addController` writes lives inside `root.attrs`, so capturing
 * `root` already covers it; `controllerFileName` is captured separately so
 * undoing an Add-script restores the controller-less state.
 *
 * The controller's Lua text is DELIBERATELY NOT snapshotted (task 472): Monaco
 * owns the controller buffer's own fine-grained undo/redo natively, so document
 * history governs ONLY the visual GuiNode tree. A visual undo/redo therefore
 * never rewinds the Lua buffer, and a controller-text edit creates no
 * document-history step (it still marks dirty so Save persists it).
 */
export type DocSnapshot = {
  root: GuiNode;
  controllerFileName: string | null;
};

/** The whole editor store state. */
export type EditorState = {
  /** The open component, or `null` when nothing is open. */
  open: OpenComponent | null;
  /** The single selection (a `nodeId` in `open.root`), shared tree↔preview. */
  selectedNodeId: string | null;
  /**
   * The `nodeId`s the user has LOCKED (task: element lock). A locked element
   * cannot be selected by clicking the preview and its properties are read-only
   * in the Properties panel — it is an editor-only protection, NOT part of the
   * saved artifact, so locking does NOT mark the component dirty and is never
   * serialized. Keyed by the session-only `nodeId`, so it is reset whenever the
   * document is established/replaced wholesale (`open`/`close`/`reloadOpen`),
   * which re-mints ids. The structure tree is the lock affordance (a lock toggle
   * per row); the preview and Properties read this set to gate selection/editing.
   */
  lockedNodeIds: Set<string>;
  /** The active main-content tab. */
  activeTab: EditorTab;
  /** True when the open component has unsaved edits (F11 reads; save clears). */
  dirty: boolean;
  /**
   * Undo stack: document snapshots taken JUST BEFORE each committed edit step,
   * oldest first. `undo` pops the top, pushing the current doc onto {@link future}.
   * Reset (emptied) whenever the open document is established or replaced wholesale
   * (`open`/`close`/`reloadOpen`) — you cannot undo across an open/switch/reload.
   */
  past: DocSnapshot[];
  /** Redo stack: snapshots `undo` set aside, to be replayed by `redo`. A fresh edit clears it. */
  future: DocSnapshot[];
  /**
   * The coalescing key of the LAST committed edit step (or `null` if the last edit
   * had no key / a boundary was committed). A mutating action whose `coalesceKey`
   * MATCHES this folds into the current step (no new `past` entry) — so one drag
   * gesture or one burst of typing in a field is ONE undo step, not one per
   * pointermove/keystroke. A different (or absent) key opens a new step. See the
   * COALESCING note on {@link EditorAction}.
   */
  lastCoalesceKey: string | null;
};

/**
 * The action set. Each later feature adds a variant here rather than reaching
 * around the reducer with an ad-hoc setter — see EXTENSION POINTS above.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNDO/REDO + COALESCING (task 470)
 * ─────────────────────────────────────────────────────────────────────────────
 * VISUAL-tree mutations (`replaceRoot`, `addChildNode`, `setNodeAttrs`,
 * `removeNode`, `addController`) push an undo step. (`setControllerText` does
 * NOT — task 472: Monaco owns the controller buffer's undo, so a controller-text
 * edit is dirty-but-not-a-document-step.) Some carry an optional
 * `coalesceKey`: consecutive mutations sharing the SAME key collapse into ONE undo
 * step instead of one each — this is what makes a whole drag gesture (a burst of
 * `setNodeAttrs` on every pointermove, all keyed by one gesture id) a single
 * Ctrl+Z, and continuous typing in one field (keyed per node/field) coalesce too.
 * Switching field/node, ending the gesture, or committing a boundary
 * (`commitHistory`) breaks the run so the next edit opens a fresh step. The
 * reducer follows the same commit-boundary model as {@link import("../../lib/useHistoryState").useHistoryState}
 * — it just lives in the reducer because the document is reducer-owned. Selection,
 * tab, and the Data Model scratch are NOT undoable (they are view/scratch state).
 */
export type EditorAction =
  /** Seat a freshly-parsed component (F8 open-flow). Resets selection/tab/dirty. */
  | { type: "open"; component: OpenComponent }
  /** Clear the open component (back to the empty state). */
  | { type: "close" }
  /** Set the shared selection (tree click / preview click). */
  | { type: "select"; nodeId: string | null }
  /**
   * Toggle the LOCK on the node identified by `nodeId` (task: element lock). A
   * locked element cannot be selected from the preview and its properties are
   * read-only. Lock is editor-only view state — it does NOT mark dirty, pushes no
   * history step, and is never serialized. A no-op if nothing is open.
   */
  | { type: "toggleLock"; nodeId: string }
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
  | {
      type: "setNodeAttrs";
      nodeId: string;
      attrs: Record<string, string>;
      /**
       * Optional coalescing key (task 470). All `setNodeAttrs` of one drag gesture
       * share a per-gesture key so the gesture is ONE undo step; property-field
       * typing keys per node/field so a burst of edits to the same field coalesces
       * but switching fields opens a new step. Omit for a discrete, standalone step.
       */
      coalesceKey?: string;
    }
  /**
   * Remove the node identified by `nodeId` from the tree (and its whole subtree) —
   * marks dirty. A no-op (no dirty) if nothing is open, the node is not found, or
   * the node is the root (the `<View>` is never removable). The immutable detach is
   * delegated to the pure {@link removeNode} so the mutation is tested off-store.
   * Any element is deletable from the structure tree (events are one case); a
   * selection that the removal orphans (the removed node OR a descendant) is cleared.
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
   *
   * Pushes NO document-history step (task 472): Monaco owns the controller
   * buffer's fine-grained undo/redo natively, so a controller-text edit must not
   * appear in the visual document's undo stack. It still marks dirty so Save
   * persists it.
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
  | { type: "markSaved" }
  /**
   * Undo the last committed document step (task 470): restore the previous
   * document snapshot, pushing the current one onto the redo stack. Preserves the
   * selection if the selected node still exists in the restored tree (else clears
   * it), via the same structural {@link remapSelection} F13 uses. Marks dirty (an
   * undo moves the document away from whatever was last seated). A no-op when the
   * undo stack is empty or nothing is open. Selection/tab are NOT undone — undo
   * only rewinds the DOCUMENT.
   */
  | { type: "undo" }
  /**
   * Redo the last undone document step (task 470): replay the snapshot `undo` set
   * aside, pushing the current one back onto the undo stack. Same selection
   * preservation and dirty behavior as `undo`. A no-op when the redo stack is empty
   * or nothing is open.
   */
  | { type: "redo" }
  /**
   * Close the current coalescing run (task 470) WITHOUT changing the document, so
   * the next mutating edit opens a fresh undo step. Dispatched on blur of a
   * property/controller field (the commit-on-blur boundary), mirroring
   * {@link import("../../lib/useHistoryState").useHistoryState}'s `commit`. Never
   * marks dirty and never touches the stacks — it only resets `lastCoalesceKey`.
   */
  | { type: "commitHistory" }
  /**
   * Live-reload the open component from disk after an EXTERNAL edit (F13): replace
   * the parsed `root`, `controllerFileName`, and `path` with the freshly re-read +
   * re-parsed version, set the (already-remapped) `selectedNodeId`, and clear
   * dirty — the editor now matches disk. PRESERVES the active tab (unlike `open`,
   * which resets it) so a live swap doesn't yank the user off the Controller tab.
   * Resets `controllerText` to `null` so the controller buffer lazily re-reads the
   * (possibly changed) `.lua` on next view. A no-op if nothing is open. The caller
   * (F13 listener) only dispatches this when the open component is CLEAN — a dirty
   * editor gets the non-destructive notice instead, never this stomp.
   */
  | {
      type: "reloadOpen";
      component: OpenComponent;
      selectedNodeId: string | null;
    };

const initialState: EditorState = {
  open: null,
  selectedNodeId: null,
  lockedNodeIds: new Set(),
  activeTab: "view",
  dirty: false,
  past: [],
  future: [],
  lastCoalesceKey: null,
};

/** Capture the open component's undoable document as a snapshot for the undo stack. */
function snapshotOf(open: OpenComponent): DocSnapshot {
  return {
    root: open.root,
    controllerFileName: open.controllerFileName,
  };
}

/**
 * Record a committed document edit on the undo history. Call this with the state
 * BEFORE the edit and the action's `coalesceKey`, and merge the returned
 * `{ past, future, lastCoalesceKey }` into the post-edit state.
 *
 * Coalescing: if `coalesceKey` is non-null and equals the previous step's key (and
 * a step exists to fold into), the edit joins the current step — `past` is left
 * untouched, so the snapshot already on top (the pre-run document) stays the undo
 * target for the whole run. Otherwise a new step opens: the pre-edit snapshot is
 * pushed and the redo stack is cleared (a fresh edit invalidates any redo).
 */
function pushHistory(
  prev: EditorState,
  coalesceKey: string | undefined,
): Pick<EditorState, "past" | "future" | "lastCoalesceKey"> {
  if (!prev.open) {
    return { past: prev.past, future: prev.future, lastCoalesceKey: coalesceKey ?? null };
  }
  const coalesce =
    coalesceKey != null && coalesceKey === prev.lastCoalesceKey && prev.past.length > 0;
  if (coalesce) {
    // Same run — keep the existing pre-run snapshot as the undo target; don't push.
    return { past: prev.past, future: prev.future, lastCoalesceKey: coalesceKey };
  }
  return {
    past: [...prev.past, snapshotOf(prev.open)],
    future: [], // any fresh edit invalidates redo
    lastCoalesceKey: coalesceKey ?? null,
  };
}

/**
 * Apply a restored {@link DocSnapshot} to the open component, carrying the
 * selection across by structural position (the snapshot may not contain the
 * currently-selected node). Shared by `undo` and `redo`.
 */
function restoreSnapshot(state: EditorState, snap: DocSnapshot): EditorState {
  if (!state.open) return state;
  return {
    ...state,
    open: {
      ...state.open,
      root: snap.root,
      controllerFileName: snap.controllerFileName,
      // controllerText is INTENTIONALLY left untouched (task 472): Monaco owns
      // the controller buffer's undo, so a visual undo/redo must not rewind it.
    },
    // Keep the selection if its node survives the restore (by structural address,
    // since undo/redo never re-mint nodeIds this usually matches by id directly);
    // drop it otherwise. Reuses the F13 remap helper.
    selectedNodeId: remapSelection(state.open.root, snap.root, state.selectedNodeId),
    // An undo/redo moves the document away from the seated/last-saved state.
    dirty: true,
    // A history jump ends any coalescing run.
    lastCoalesceKey: null,
  };
}

/**
 * The single pure reducer. Mutating actions (structural tree edits) set `dirty`;
 * preview-only edits (the Data Model text) do not; `open` and `markSaved` clear
 * it. Keeping every dirty transition here is what lets F11 treat save as one
 * `markSaved` and never hunt for stray setters.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "open":
      // Establishing a fresh document RESETS history — you cannot undo across an
      // open/switch into a different component.
      return {
        open: action.component,
        selectedNodeId: null,
        // A different document re-mints nodeIds, so any locks are meaningless.
        lockedNodeIds: new Set(),
        activeTab: "view",
        dirty: false,
        past: [],
        future: [],
        lastCoalesceKey: null,
      };
    case "close":
      // Clears the document and its history alike.
      return initialState;
    case "select":
      return { ...state, selectedNodeId: action.nodeId };
    case "toggleLock": {
      // Editor-only view state: flip membership in the locked set immutably (a
      // fresh Set so the reference change drives a re-render). Never dirties and
      // pushes no history — a lock is not part of the saved artifact.
      if (!state.open) return state;
      const next = new Set(state.lockedNodeIds);
      if (next.has(action.nodeId)) next.delete(action.nodeId);
      else next.add(action.nodeId);
      return { ...state, lockedNodeIds: next };
    }
    case "setTab":
      return { ...state, activeTab: action.tab };
    case "setModelText":
      // Preview-only: the data model drives rendering, not the saved artifact, so
      // typing JSON must NOT make the component look unsaved.
      if (!state.open) return state;
      return { ...state, open: { ...state.open, modelText: action.text } };
    case "replaceRoot":
      if (!state.open) return state;
      return {
        ...state,
        open: { ...state.open, root: action.root },
        dirty: true,
        ...pushHistory(state, undefined),
      };
    case "addChildNode": {
      if (!state.open) return state;
      // Auto-assign a working local id (`Panel1`, `Text2`, …) so every added
      // element is addressable from the controller/bindings the instant it exists
      // — the user renames it in Properties. Only id-bearing tags get one
      // (`<Event>` is name→handler, the root `<View>` is the component itself), and
      // only when the child doesn't already carry an explicit id. Assigned HERE,
      // not in `makeChildNode`, because picking a free running number needs the
      // whole tree. `id` goes FIRST in attrs so the serialized XML reads naturally.
      const child =
        nodeHasId(action.child.tag) && !action.child.attrs.id?.trim()
          ? {
              ...action.child,
              attrs: {
                id: nextAutoId(state.open.root, action.child.tag),
                ...action.child.attrs,
              },
            }
          : action.child;
      const nextRoot = addChild(state.open.root, action.parentNodeId, child);
      // Parent not found → addChild returns the SAME reference → no-op (don't
      // dirty or move selection on a phantom add).
      if (nextRoot === state.open.root) return state;
      return {
        ...state,
        open: { ...state.open, root: nextRoot },
        // Select the freshly-added node so it highlights in the tree and preview
        // immediately — the user sees what they just added (nodeId is unchanged by
        // the auto-id, so this still points at the inserted node).
        selectedNodeId: child.nodeId,
        dirty: true,
        // A discrete add is its own undo step (no coalescing).
        ...pushHistory(state, undefined),
      };
    }
    case "setNodeAttrs": {
      if (!state.open) return state;
      const nextRoot = setNodeAttrs(state.open.root, action.nodeId, action.attrs);
      // Node not found → setNodeAttrs returns the SAME reference → no-op (don't
      // dirty on a phantom write).
      if (nextRoot === state.open.root) return state;
      return {
        ...state,
        open: { ...state.open, root: nextRoot },
        dirty: true,
        // Coalesces by gesture (drag) / field (typing) via `coalesceKey`.
        ...pushHistory(state, action.coalesceKey),
      };
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
        // Drop a dangling selection: clear it when the selected node is no longer in
        // the tree — i.e. the removed node OR any descendant of it (general subtree
        // delete, not just the exact node). A still-present selection is preserved.
        selectedNodeId:
          state.selectedNodeId != null && findNode(nextRoot, state.selectedNodeId) == null
            ? null
            : state.selectedNodeId,
        dirty: true,
        // A discrete remove is its own undo step (no coalescing).
        ...pushHistory(state, undefined),
      };
    }
    case "loadControllerText":
      // Lazy-load of the saved controller: it IS the on-disk state, so seating it
      // must NOT make the component look unsaved (mirrors `setModelText`).
      if (!state.open) return state;
      return { ...state, open: { ...state.open, controllerText: action.text } };
    case "setControllerText":
      if (!state.open) return state;
      return {
        ...state,
        open: { ...state.open, controllerText: action.text },
        // Marks dirty so Save persists the Lua, but pushes NO history step
        // (task 472) — Monaco owns the controller buffer's own undo/redo, so a
        // controller edit must not appear in the visual document's undo stack.
        dirty: true,
      };
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
        // A discrete Add-script is its own undo step; undoing it restores the
        // controller-less document (root attr + controllerFileName + buffer).
        ...pushHistory(state, undefined),
      };
    }
    case "markSaved":
      return { ...state, dirty: false };
    case "reloadOpen":
      // Only meaningful when something is open; a live-reload of nothing is a no-op.
      if (!state.open) return state;
      return {
        ...state,
        open: action.component,
        // Selection is pre-remapped by the caller (the new tree re-mints nodeIds,
        // so the old id is meaningless); `null` when the selected node is gone.
        selectedNodeId: action.selectedNodeId,
        // The re-read tree re-mints nodeIds, so any locks (keyed by the old ids)
        // are meaningless — clear them.
        lockedNodeIds: new Set(),
        // Editor now matches disk — nothing unsaved.
        dirty: false,
        // A live external reload RESETS history — you cannot undo across a disk
        // swap into the pre-reload draft (the nodeIds were re-minted anyway).
        past: [],
        future: [],
        lastCoalesceKey: null,
      };
    case "undo": {
      if (!state.open || state.past.length === 0) return state;
      const past = state.past.slice(0, -1);
      const snap = state.past[state.past.length - 1];
      const restored = restoreSnapshot(state, snap);
      return {
        ...restored,
        past,
        // Stash the CURRENT document so redo can replay it.
        future: [...state.future, snapshotOf(state.open)],
      };
    }
    case "redo": {
      if (!state.open || state.future.length === 0) return state;
      const future = state.future.slice(0, -1);
      const snap = state.future[state.future.length - 1];
      const restored = restoreSnapshot(state, snap);
      return {
        ...restored,
        // Re-push the current document so undo can rewind it again.
        past: [...state.past, snapshotOf(state.open)],
        future,
      };
    }
    case "commitHistory":
      // Pure boundary: close the coalescing run, touch nothing else.
      if (state.lastCoalesceKey === null) return state;
      return { ...state, lastCoalesceKey: null };
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
