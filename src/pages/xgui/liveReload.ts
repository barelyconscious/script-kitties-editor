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
  /** Filename of the open component's controller `.lua` (basename, e.g.
   *  "bag_controller.lua"), or `null` when the component has no controller. */
  openControllerFileName: string | null;
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
 * the open component is handled separately by {@link changedPathIsOpenController}
 * (matched by basename) and reconciled through the SAME clean→reload /
 * dirty→notice path — see {@link classifyOpenChange}.
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
 * Does this `gui-changed` payload refer to the open component's controller `.lua`?
 *
 * Matched by BASENAME (the last `/`-segment of the changed path) against the open
 * component's `controllerFileName`, which is itself a basename — controllers are
 * read via `get_script(controllerFileName)`, and component basenames are unique
 * tree-wide, so basename equality is the correct identity. A `null` changed path
 * or a `null` `openControllerFileName` is never a match (same conservative posture
 * as {@link changedPathIsOpenComponent}: never disturb the open document on a
 * signal we can't attribute).
 */
export function changedPathIsOpenController(
  state: Pick<LiveReloadState, "openControllerFileName">,
  changedPath: string | null,
): boolean {
  if (changedPath == null) return false;
  if (state.openControllerFileName == null) return false;
  const base = changedPath.slice(changedPath.lastIndexOf("/") + 1);
  return base === state.openControllerFileName;
}

/**
 * Which file of the open document a `gui-changed` payload refers to.
 *
 * `"xml"` — the open component's `.xml` (matched by exact path).
 * `"controller"` — the open component's controller `.lua` (matched by basename).
 * `"other"` — nothing open, or the change isn't either of the open doc's files.
 *
 * Both `"xml"` and `"controller"` reconcile through the identical clean→reload /
 * dirty→notice path; the distinction only tells the reconciler WHICH file to
 * re-read for its echo check.
 */
export type OpenChangeKind = "xml" | "controller" | "other";

export function classifyOpenChange(
  state: LiveReloadState,
  changedPath: string | null,
): OpenChangeKind {
  if (state.openName == null) return "other";
  if (changedPathIsOpenComponent(state, changedPath)) return "xml";
  if (changedPathIsOpenController(state, changedPath)) return "controller";
  return "other";
}

/**
 * Normalize a `gui-changed` payload path to the bare STEM the child-mount cache is
 * keyed by (what `srcBasename` produces for a `<Component src>`): the last
 * `/`-segment with a trailing `.xml` stripped (case-insensitive). Pure + testable.
 *
 *  - `"widgets/bag_slot.xml"` → `"bag_slot"` (matches the mount cache key).
 *  - `"bag_controller.lua"`   → `"bag_controller.lua"` (no `.xml` to strip) — a stem
 *    that matches no XML mount entry, so a targeted invalidation is a harmless no-op.
 *  - `null` → `null` (the caller falls back to a clear-all — we can't attribute a
 *    coarse "something changed" signal to one file).
 */
export function changedPathStem(changedPath: string | null): string | null {
  if (changedPath == null) return null;
  const segment = changedPath.slice(changedPath.lastIndexOf("/") + 1);
  return segment.replace(/\.xml$/i, "");
}

/**
 * The side effects that run on EVERY `gui-changed` event, regardless of the
 * decision branch (refresh-only / reload-open / notice-dirty):
 *
 *  - `refreshList` — re-fetch the component LIST so external add/delete/rename
 *    always surfaces.
 *  - `invalidateMounts` — drop the frontend child-mount cache (F6b's
 *    guiComponentCache) for the CHANGED child so components that mount it via
 *    `<Component src>` re-fetch the fresh child, whether opened later or already
 *    mounted in the open preview. Only the changed stem is dropped (TARGETED), so
 *    other embedded children keep their cache and never flash on an unrelated save;
 *    a `null` payload we can't attribute falls back to a clear-all.
 *
 * Both are unconditional and order-independent. Kept here, off-React, so the
 * "always fire both, no matter the branch" contract — and the path normalization —
 * are unit-tested without rendering, the same pure-core posture as
 * {@link decideLiveReload}.
 */
export function onGuiChangedAlways(
  refreshList: () => void,
  invalidateMounts: (basename?: string | null) => void,
  changedPath: string | null,
): void {
  refreshList();
  invalidateMounts(changedPathStem(changedPath));
}

/**
 * Decide how to reconcile a `gui-changed` event against the open document.
 *
 * - Nothing open, or the change isn't the open doc's `.xml` OR controller `.lua`
 *   → `"refresh-only"`.
 * - The open doc's file changed and it's CLEAN → `"reload-open"` (safe live swap).
 * - The open doc's file changed and it's DIRTY → `"notice-dirty"` (never stomp;
 *   ask the user, defaulting to keeping their draft — mirrors warn-on-switch).
 *
 * A controller `.lua` edit is treated identically to an `.xml` edit (all-or-
 * nothing): the reload discards `controllerText`, which the ControllerTab then
 * lazily re-reads from disk; the dirty notice guards it the same way.
 */
export function decideLiveReload(
  state: LiveReloadState,
  changedPath: string | null,
): LiveReloadDecision {
  if (classifyOpenChange(state, changedPath) === "other") return "refresh-only";
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
