/**
 * structureSplit — the pure math behind the XGUI structure column's draggable
 * divider (478). The column stacks the TREE slice (top) over the PROPERTIES slice
 * (bottom); a horizontal divider between them lets the user grow one at the
 * other's expense. The split is stored as the TREE slice's fraction of the
 * stackable height; this module clamps a drag to that fraction while honoring a
 * minimum pixel height for EACH slice, so neither can be dragged shut.
 *
 * Kept pure (no DOM, no React) so the clamp is unit-testable in isolation — the
 * React splitter is the thin shell that feeds it pointer coordinates and a
 * measured container height.
 */

/** Minimum pixel height for the TREE slice — it never collapses below this. */
export const MIN_TREE_PX = 120;

/** Minimum pixel height for the PROPERTIES slice — it never collapses below this. */
export const MIN_PROPS_PX = 120;

/** The default TREE fraction when nothing is stored (matches the prior flex-[1.2]
 *  : flex-1 ratio, 1.2 / 2.2 ≈ 0.545). */
export const DEFAULT_TREE_FRACTION = 0.545;

/**
 * Clamp a TREE-slice fraction so BOTH slices keep at least their minimum height
 * within a container of `containerPx` total height. Returns the input fraction
 * when it already satisfies both minimums.
 *
 * When the container is too short to honor both minimums (containerPx < the sum
 * of the two minimums), there is no valid split — we fall back to an even 0.5 so
 * the divider sits in the middle rather than snapping to a degenerate edge.
 */
export function clampTreeFraction(fraction: number, containerPx: number): number {
  if (!Number.isFinite(fraction) || !Number.isFinite(containerPx) || containerPx <= 0) {
    return DEFAULT_TREE_FRACTION;
  }
  // Not enough room for both minimums: no valid clamp window — center the divider.
  if (containerPx < MIN_TREE_PX + MIN_PROPS_PX) return 0.5;
  const minFraction = MIN_TREE_PX / containerPx;
  const maxFraction = 1 - MIN_PROPS_PX / containerPx;
  return Math.min(Math.max(fraction, minFraction), maxFraction);
}

/**
 * Convert a pointer Y position (relative to the top of the stacked region) into a
 * clamped TREE fraction. The divider follows the cursor: the tree height is the
 * cursor's offset from the top, clamped so both slices keep their minimums.
 */
export function fractionForPointer(offsetTopPx: number, containerPx: number): number {
  if (containerPx <= 0) return DEFAULT_TREE_FRACTION;
  return clampTreeFraction(offsetTopPx / containerPx, containerPx);
}
