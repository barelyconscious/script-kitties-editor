/**
 * guiTreeDnd — the pure, testable core behind the structure tree's DRAG-AND-DROP
 * re-parenting (task 513). It answers ONE question: given a pointer resting over a
 * particular tree row, WHICH move does the user intend? — as a {@link DropPlan}
 * `(zone, targetParentId, index)`. No React, no DOM: the {@link StructureTree}
 * pointer choreography hit-tests a row, hands its rect + the pointer Y here, and
 * dispatches the returned plan through #512's `moveNode` action.
 *
 * WHAT THIS DOES NOT DECIDE — legality. Whether a plan is a LEGAL move is
 * {@link import("./guiTreeEdit").canMoveTo}'s job (element rules, cycles, the
 * immovable root). This helper only maps pointer position → intended slot; the
 * component asks `canMoveTo` about the returned `targetParentId` and shows an
 * affordance (or a no-op drop) accordingly. Keeping the two apart is what stops the
 * UI from re-deriving a rule: zones here, legality there.
 *
 * THE THREE ZONES (from the pointer's Y within the row's rect):
 *  - top {@link DROP_EDGE_FRACTION} of the row → BEFORE it (same parent, the row's
 *    own slot);
 *  - bottom {@link DROP_EDGE_FRACTION} → AFTER it (same parent, the row's slot + 1)
 *    — always the NEXT SIBLING of the row, never "first child of it" (v1 keeps the
 *    after-an-expanded-container case unsurprising);
 *  - the middle → INTO the row, appended as its LAST child.
 *
 * INDEX CONVENTION — the returned `index` is a slot in the target parent's CURRENT
 * children array (the array as rendered right now), exactly what #512's `moveNode`
 * consumes: it absorbs the same-parent remove-then-insert off-by-one internally, so
 * this helper maps pointer → slot with NO subtraction of the dragged node's own
 * position. `before` = the row's index; `after` = index + 1; `into` = the target's
 * current `children.length` (append).
 *
 * @see design/xgui_ta.md — "Structure column" (the tree slice).
 */

import type { GuiNode } from "../../lib/guiNode";

/**
 * Where a drop lands relative to the row under the pointer:
 *  - `before` / `after` — a SIBLING of the row (inserted into the row's parent);
 *  - `into` — a CHILD of the row (appended last).
 */
export type DropZone = "before" | "after" | "into";

/**
 * The move a pointer position implies: its {@link DropZone} (for the visual
 * affordance) plus the `(targetParentId, index)` #512's `moveNode` action needs.
 * `index` follows `moveNode`'s current-array convention (see the module doc).
 */
export type DropPlan = {
  zone: DropZone;
  targetParentId: string;
  index: number;
};

/**
 * The fraction of a row's height at its top (and, mirrored, its bottom) that reads
 * as the BEFORE (resp. AFTER) zone; the remaining middle band is INTO. `0.25` gives
 * a 25% / 50% / 25% split — a comfortable central target for nesting with clear
 * edges for sibling insertion.
 */
export const DROP_EDGE_FRACTION = 0.25;

/**
 * Compute the {@link DropPlan} for a pointer at `pointerY` over the row rendering
 * `row`, whose parent in the tree is `parent` (or `null` when `row` is the ROOT).
 *
 * Root special-casing: the root `<View>` has no parent, so nothing may be its
 * sibling — every pointer position over the root row reads as INTO (append at the
 * end of its children). For every other row the zone is chosen from where the
 * pointer sits within the row's vertical extent (see {@link DROP_EDGE_FRACTION}).
 *
 * Pure: `rect` is just `{ top, height }` in the same coordinate space as
 * `pointerY` (the caller passes the row's `getBoundingClientRect()` and the
 * pointer's `clientY`), so the zone math is unit-tested without a DOM. A
 * zero/negative height is treated as 1px to avoid a divide-by-zero (it then reads
 * as INTO, the safest default). Returns only the intended slot — the caller gates
 * it through `canMoveTo`.
 */
export function dropPlanForPointer(
  rect: { top: number; height: number },
  pointerY: number,
  row: GuiNode,
  parent: GuiNode | null,
): DropPlan {
  // Root row: nothing may be its sibling, so any position is INTO (append).
  if (parent === null) {
    return { zone: "into", targetParentId: row.nodeId, index: row.children.length };
  }
  const height = rect.height > 0 ? rect.height : 1;
  const fraction = clamp01((pointerY - rect.top) / height);
  const rowIndex = parent.children.findIndex((c) => c.nodeId === row.nodeId);
  // A row not found among its purported parent's children shouldn't happen (the
  // caller derives `parent` from the same tree), but fall back to append rather
  // than emit a negative slot.
  const index = rowIndex < 0 ? parent.children.length : rowIndex;
  if (fraction < DROP_EDGE_FRACTION) {
    return { zone: "before", targetParentId: parent.nodeId, index };
  }
  if (fraction > 1 - DROP_EDGE_FRACTION) {
    return { zone: "after", targetParentId: parent.nodeId, index: index + 1 };
  }
  return { zone: "into", targetParentId: row.nodeId, index: row.children.length };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
