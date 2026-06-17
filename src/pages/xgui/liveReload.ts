/**
 * liveReload — the pure decision + selection-preservation core for F13's external
 * edit sync. When the backend's `gui/` watcher fires it emits a `gui-changed`
 * Tauri event; the XGUI editor reconciles that against the open document. This is
 * the disk↔draft sibling of F11's warn-on-switch (`switchGuard`): the same trust
 * model — never silently stomp the user's unsaved work — applied to a file that
 * changed UNDERNEATH the editor rather than to a deliberate component switch.
 *
 * Kept pure and off-React so the three branches (and the selection remap across a
 * re-parse) are unit-tested without rendering. The React listener in
 * {@link ComponentList} only refetches and dispatches what the decision asks for.
 *
 * @see design/xgui_ta.md — section 7 "Warn on switch" (the trust model this mirrors).
 */

import type { GuiNode } from "../../lib/guiNode";

/** The minimal slice of editor state the live-reload decision needs. */
export type LiveReloadState = {
  /** Basename of the currently-open component, or `null` if none is open. */
  openName: string | null;
  /** gui-relative path of the open component's `.xml`, e.g. "widgets/bag.xml". */
  openPath: string | null;
  /** Whether the open component has unsaved edits. */
  dirty: boolean;
};

/**
 * What the editor should do in response to a `gui-changed` event.
 *
 * `"refresh-only"` — the change is NOT the open component (or nothing is open):
 *   just re-fetch the component LIST so external add/delete/rename appears.
 * `"reload-open"` — the OPEN component's file changed and there are NO unsaved
 *   edits: re-read + re-parse it live (and still refresh the list).
 * `"notice-dirty"` — the OPEN component's file changed but the user HAS unsaved
 *   edits: do NOT stomp the draft; surface a non-destructive Reload/Keep notice
 *   (and still refresh the list).
 *
 * Every branch refreshes the list; the distinction is only what happens to the
 * open document.
 */
export type LiveReloadDecision = "refresh-only" | "reload-open" | "notice-dirty";

/**
 * Does this `gui-changed` payload refer to the currently-open component?
 *
 * The payload is the changed file's gui-relative path (forward-slashed), or
 * `null` when the backend couldn't derive one (a coarse "something changed"
 * signal). We match on the open component's `.xml` path. A `null` payload is
 * deliberately treated as NOT the open file: a coarse signal refreshes the list
 * but must not trigger a live reload (or a stomp notice) we can't attribute —
 * conservative on the side of never disturbing the open document on ambiguity.
 *
 * Matching is by the open component's `.xml` path. A controller `.lua` edit for
 * the open component is intentionally a list-refresh-only event here: the
 * controller buffer is lazy-loaded and separately dirty-tracked, so silently
 * swapping it underneath an open editor is out of scope for this reconciliation.
 */
export function changedPathIsOpenComponent(
  state: Pick<LiveReloadState, "openPath">,
  changedPath: string | null,
): boolean {
  if (changedPath == null) return false;
  if (state.openPath == null) return false;
  return changedPath === state.openPath;
}

/**
 * Decide how to reconcile a `gui-changed` event against the open document.
 *
 * - Nothing open, or the change isn't the open component → `"refresh-only"`.
 * - The open component changed and it's CLEAN → `"reload-open"` (safe live swap).
 * - The open component changed and it's DIRTY → `"notice-dirty"` (never stomp;
 *   ask the user, defaulting to keeping their draft — mirrors warn-on-switch).
 */
export function decideLiveReload(
  state: LiveReloadState,
  changedPath: string | null,
): LiveReloadDecision {
  if (state.openName == null) return "refresh-only";
  if (!changedPathIsOpenComponent(state, changedPath)) return "refresh-only";
  return state.dirty ? "notice-dirty" : "reload-open";
}

/**
 * The chain of child-INDICES from the root down to the node identified by
 * `nodeId`, or `null` if the node is not in the tree. The root itself is the
 * empty path `[]`. This is the structural address that survives a re-parse —
 * unlike `nodeId`, which {@link mintNodeId} re-mints fresh on every parse, so the
 * old selection's id never matches a node in a freshly re-parsed tree.
 */
export function nodeIndexPath(root: GuiNode, nodeId: string): number[] | null {
  if (root.nodeId === nodeId) return [];
  for (let i = 0; i < root.children.length; i++) {
    const sub = nodeIndexPath(root.children[i], nodeId);
    if (sub) return [i, ...sub];
  }
  return null;
}

/**
 * Resolve a child-index path (from {@link nodeIndexPath}) to the `nodeId` at that
 * position in `root`, or `null` if the path no longer addresses a node (the
 * subtree shrank, or a sibling was removed so the index is now out of range).
 * Used to carry a selection across a live re-parse: take the old selection's
 * structural address, resolve it in the new tree, and re-select it only if the
 * "same" node still exists.
 */
export function nodeIdAtIndexPath(root: GuiNode, indices: number[]): string | null {
  let node: GuiNode = root;
  for (const i of indices) {
    const next = node.children[i];
    if (!next) return null;
    node = next;
  }
  return node.nodeId;
}

/**
 * Carry a selection across a re-parse: given the OLD tree (whose `selectedNodeId`
 * we want to keep), the NEW re-parsed tree, and the old selection, return the new
 * tree's `nodeId` for the structurally-same node — or `null` if that node no
 * longer exists (so the caller drops the dangling selection). A `null` input
 * selection stays `null`.
 *
 * "Structurally the same" is by position (the child-index path), the only stable
 * identity across a re-mint of `nodeId`s. This is a best-effort preserve: an
 * external edit that reorders or deletes the selected node legitimately loses the
 * selection, which is the correct, non-surprising behavior.
 */
export function remapSelection(
  oldRoot: GuiNode,
  newRoot: GuiNode,
  selectedNodeId: string | null,
): string | null {
  if (selectedNodeId == null) return null;
  const indices = nodeIndexPath(oldRoot, selectedNodeId);
  if (indices == null) return null;
  return nodeIdAtIndexPath(newRoot, indices);
}
