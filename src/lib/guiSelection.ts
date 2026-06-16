/**
 * guiSelection — the pure, unit-testable core of the XGUI preview's selection
 * back-reference.
 *
 * The design's selection model is deliberately minimal: there is ONE selection
 * state, `selectedNodeId: string | null`. Every rendered preview box carries
 * `data-node-id={nodeId}`; a click resolves the nearest such box (so clicking a
 * child text span still selects the panel that owns it), and that node id
 * becomes the selection. The DOM IS the node↔element mapping — there is no side
 * table to keep in sync.
 *
 * At runtime the React handler does the DOM half in one line:
 *
 *   const id = (e.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id");
 *
 * That single `closest` call is the only piece that needs a browser. The SELECT
 * SEMANTICS around it — what "nearest" means, validating the id against the live
 * tree, and deciding whether a given node is the selected one — are pure and
 * live here so they can be tested without a DOM.
 *
 * SCOPE (F2): single selection + nearest-node resolution only. `forEach`
 * instance discrimination (`data-instance-key`, selecting the template) is F4;
 * this module already collapses to the template `nodeId` for free because it
 * only ever reads `data-node-id`.
 *
 * @see design/xgui_ta.md — "The node↔rendered-element mapping" / "Selection model"
 */

import type { GuiNode } from "./guiNode";

/** The DOM attribute that stamps a rendered box with its source node's id. */
export const NODE_ID_ATTR = "data-node-id";

/**
 * Resolve the nearest node id from an ancestor chain of `data-node-id` values,
 * ordered from the click target outward (target first, root last).
 *
 * This is the dom-free model of `event.target.closest('[data-node-id]')`: walk
 * outward from where the click landed and take the FIRST element that carries a
 * node id. Clicking a deeply-nested child (e.g. a text span inside a panel
 * inside a panel) therefore resolves to the closest enclosing rendered box.
 *
 * Entries without a node id (`null`/`undefined` — intermediate non-box
 * elements) are skipped. Returns `null` if no ancestor carries one (the click
 * landed on the stage background, outside every box).
 *
 * @param ancestorNodeIds the `data-node-id` of each element from the click
 *   target up to (and including) the stage root, innermost first.
 */
export function nearestNodeId(
  ancestorNodeIds: ReadonlyArray<string | null | undefined>,
): string | null {
  for (const id of ancestorNodeIds) {
    if (id !== null && id !== undefined && id !== "") return id;
  }
  return null;
}

/**
 * Find the node with the given `nodeId` anywhere in the tree (depth-first,
 * pre-order). Returns `null` for a `null` id or an id that does not match any
 * node — e.g. a stale selection after the tree changed, which the caller treats
 * as "nothing selected" rather than an error.
 *
 * This is what validates a `data-node-id` read off the DOM against the live
 * `GuiNode` tree (the single source of truth) before it is trusted as a
 * selection.
 */
export function findNodeById(root: GuiNode, nodeId: string | null): GuiNode | null {
  if (nodeId === null) return null;
  if (root.nodeId === nodeId) return root;
  for (const child of root.children) {
    const found = findNodeById(child, nodeId);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Whether a node is the currently selected one. The single comparison the
 * preview uses to decide which box draws the selection highlight.
 *
 * Kept as a named function (rather than an inline `===`) because the rule grows
 * in F4: a `forEach` instance is selected when its TEMPLATE node id matches the
 * selection, regardless of instance key. Routing every "is this selected?"
 * check through here means that change lands in one place.
 */
export function isNodeSelected(nodeId: string, selectedNodeId: string | null): boolean {
  return selectedNodeId !== null && nodeId === selectedNodeId;
}
