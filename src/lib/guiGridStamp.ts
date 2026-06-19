/**
 * guiGridStamp — the pure, unit-testable STAMPING step for `<GridLayout>` (the
 * GridLayout analogue of the now-removed forEach repetition).
 *
 * A `<GridLayout rows="R" columns="C" dataCollection="key">` renders a FIXED grid:
 * ALWAYS exactly `R·C` cells, filled left-to-right, top-to-bottom from the resolved
 * collection. This module maps the collection onto that fixed slot grid:
 *
 *   - the collection's first `R·C` entries fill the cells in order;
 *   - EXCESS entries beyond `R·C` are DROPPED (pagination is the controller's job,
 *     not the editor's — locked decision);
 *   - cells with no corresponding entry get a `null` item but STILL render the
 *     template chrome (an empty/null item has no bindable fields, so the renderer
 *     resolves every `{token}` to `""`).
 *
 * Each descriptor is `{ index, item }` where `index` is the 0-based cell index (fed
 * to {@link cellGeometry} for layout) and `item` is `collection[index]` when present
 * else `null`. A non-array / undefined collection yields all-`null` cells (the grid
 * still draws its `R·C` template chrome).
 *
 * PURE: no React, no DOM. The renderer turns each descriptor's `item` into a fresh
 * flat scope (a `null` item → empty scope) and the index into cell geometry.
 *
 * @see design/gridLayout_element_design_prompt.md — "Caveats" (excess dropped,
 *   missing → null).
 */

/** One stamped grid cell: its fill-order index and the item bound into it (or null). */
export type CellStamp = {
  /** 0-based cell index (left-to-right, top-to-bottom); drives {@link cellGeometry}. */
  index: number;
  /** The collection entry for this cell, or `null` when the collection has no entry here. */
  item: unknown;
};

/**
 * Stamp a fixed `rows × columns` grid against a resolved `collection`.
 *
 * Returns EXACTLY `rows · columns` descriptors (the grid is fixed-size). Cell `i`
 * binds `collection[i]` when the collection is an array with that index, else `null`.
 * Excess collection entries (index ≥ rows·columns) are never emitted; a non-array /
 * undefined collection produces all-`null` cells.
 *
 * A `rows` or `columns` of `0` (or negative) yields NO cells — the renderer warns and
 * renders nothing in that case (there are no slots). This function simply produces an
 * empty array, since `rows · columns ≤ 0`.
 *
 * @param collection the value the GridLayout's `dataCollection` resolved to (an
 *   array of items, or any non-array value → treated as no items).
 * @param rows number of grid rows.
 * @param columns number of grid columns.
 */
export function stampGrid(collection: unknown, rows: number, columns: number): CellStamp[] {
  const cellCount = rows * columns;
  if (!Number.isFinite(cellCount) || cellCount <= 0) return [];
  const items = Array.isArray(collection) ? collection : [];
  const stamps: CellStamp[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    // `index < items.length` keeps a genuine `null`/`undefined` entry distinguishable
    // from a MISSING slot only by value, which is fine: both resolve to an empty
    // scope (no bindable fields), exactly the spec's null-item behavior.
    const item = index < items.length ? items[index] : null;
    stamps.push({ index, item });
  }
  return stamps;
}
