/**
 * guiGridGeometry — the pure, unit-testable per-cell layout for a `<GridLayout>`.
 *
 * A `<GridLayout rows="R" columns="C" gutter="gx,gy">` is NON-VISUAL: it owns no
 * box of its own and effectively fills its parent (`position="0,0,0,0"`,
 * `size="1,1,0,0"`). Its single child TEMPLATE is stamped once per grid cell, and
 * each stamped cell gets its `position`/`size` assigned BY THE GRID (the template's
 * own geometry is ignored — design req 4/5). This module computes that geometry.
 *
 * It does NOT invent a new layout engine: a cell's geometry is expressed in the
 * SAME `relX,relY,absX,absY` UDim2 comma-string form the renderer already consumes,
 * so {@link computeBoxGeometry} renders a cell unchanged.
 *
 * A cell's SIZE is the grid's `cellSize` — a LITERAL full UDim2 `"relX,relY,absX,absY"`
 * (the system's ONE dimension grammar; `"0,0,64,64"` = fixed 64px). When `cellSize` is
 * absent/blank the engine DEFAULTS it to {@link DEFAULT_CELL_SIZE} (`"1,1,0,0"` — each
 * cell fills the parent box); the editor mirrors that exactly. This is engine ground
 * truth: the runtime does NOT area-divide the parent among cells (an earlier editor
 * default that has been removed). {@link cellGeometryFixed} computes every cell from
 * that one `cellSize` — the SAME size for all cells, positions accumulating
 * `index·(cell + gutter)` per axis. With the `"1,1,0,0"` default, cells are each full
 * parent size and step 100% + gutter apart per column/row, so a multi-cell grid with no
 * `cellSize` stacks/overflows — the author sets `cellSize` (and/or gutter) to lay out a
 * real grid, exactly as in-game.
 *
 * PURE: no React, no DOM. The caller (`GuiPreview`) maps a cell index → its
 * `{ position, size }` here, then renders the template node with that geometry.
 *
 * @see design/gridlayout_cell_geometry.md — the settled cell size/position contract.
 */

import { parseUDim2 } from "./guiGeometry";

/** A cell's geometry as the raw `position`/`size` comma strings the renderer consumes. */
export type CellGeometry = {
  /** `relX,relY,absX,absY` — the cell's top-left within the parent content box. */
  position: string;
  /** `relX,relY,absX,absY` — the cell's width/height (gutter folded into `abs`). */
  size: string;
};

/** A single axis's two UDim2 fields: the relative fraction and the pixel offset. */
type Axis = { rel: number; abs: number };

/**
 * The `cellSize` the engine ASSUMES when a `<GridLayout>` authors none (or a blank
 * one): a full UDim2 `"1,1,0,0"` — each cell fills the parent box (100% × 100%, no
 * pixel offset). Engine ground truth: the runtime has no area-division mode, so the
 * editor defaults to this and lays every cell out through {@link cellGeometryFixed}.
 */
export const DEFAULT_CELL_SIZE = "1,1,0,0";

/** Join an x/y axis pair into a `relX,relY,absX,absY` comma string. */
function udim2(x: Axis, y: Axis): string {
  return `${x.rel},${y.rel},${x.abs},${y.abs}`;
}

/**
 * The geometry for the cell at 0-based `index` from the grid's `cellSize`
 * (design/gridlayout_cell_geometry.md). Every cell is the SAME size — the `cellSize`
 * UDim2 verbatim — and positions accumulate `index·(cell + gutter)` per axis from the
 * parent's content-box origin. The caller passes {@link DEFAULT_CELL_SIZE} when the
 * grid authors no `cellSize`, so this is the ONE cell-geometry path.
 *
 * `cellSize` is a full UDim2 (`relX,relY,absX,absY`) — the system's ONE dimension
 * grammar, not an exception to it. Its `rel` fields resolve against the PARENT box (the
 * one unambiguous reference — the grid fills its parent), so passing it straight through
 * as the cell `size` gives the renderer exactly that: {@link computeBoxGeometry} resolves
 * a cell's `rel` against the parent it renders into. `abs` fields are pixels.
 * **Gutters never participate in SIZE** — they space positions only, so a rel cell +
 * gutters can overflow the parent (documented-legal in this no-clipping model).
 *
 * The derivation (per axis, columns shown; rows identical with `gy`): a cell's width is
 * the UDim2 `relX·100% + absX px`. The cell in column `c` (0-based) sits at left
 * `c·(cellWidth + gx) = (c·relX)·100% + c·(absX + gx) px`  →  position
 * `relX = c·cellRelX`, `absX = c·(cellAbsX + gx)`. Size is the cellSize UDim2 as-is.
 *   Worked check (cellSize `0,0,64,64`, gx=gy=10, columns=3): the cell at col 2 →
 *   position `0,0,148,0` (2·(64+10)), size `0,0,64,64`. Proportional cellSize
 *   `0.25,0.25,0,0` at col 2 → position `0.5,0,0,0`, size `0.25,0.25,0,0`.
 *
 * `cellSize` is LITERAL (grid structure is stamped at load — it cannot bind; a `{token}`
 * here is an ERROR lint), so it is read RAW; {@link parseUDim2}'s field tolerance handles
 * missing/blank/non-numeric fields → 0 exactly as `position`/`size` do.
 *
 * @param index 0-based cell index in fill order (0 … rows·columns−1).
 * @param columns number of columns (≥ 1) — maps `index` → column/row.
 * @param cellSize the RAW `cellSize` comma string (`relX,relY,absX,absY`);
 *   missing/blank/non-numeric fields fall back to `0` via {@link parseUDim2}.
 * @param gutterX horizontal px between columns (default 0).
 * @param gutterY vertical px between rows (default 0).
 */
export function cellGeometryFixed(
  index: number,
  columns: number,
  cellSize: string,
  gutterX = 0,
  gutterY = 0,
): CellGeometry {
  const { relX, relY, absX, absY } = parseUDim2(cellSize);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const posX: Axis = { rel: column * relX, abs: column * (absX + gutterX) };
  const posY: Axis = { rel: row * relY, abs: row * (absY + gutterY) };
  return {
    position: udim2(posX, posY),
    size: udim2({ rel: relX, abs: absX }, { rel: relY, abs: absY }),
  };
}

/**
 * The outcome of parsing a `rows`/`columns` attribute (locked rules):
 *   - `{ kind: "count", value }` — a usable positive integer count (the default `1`
 *     when the attribute is absent/blank/garbage).
 *   - `{ kind: "empty" }` — an explicit `0`, which renders NO slots (the caller warns
 *     and the grid draws nothing).
 *
 * Negative or fractional values are floored toward a sane count: a value `< 1` other
 * than a clean `0` is treated as the default `1` rather than producing a broken grid;
 * a fractional positive value is truncated to its integer part (≥ 1). The explicit
 * `0` case is special because the design calls it out as "warn + render nothing".
 */
export type GridDimension = { kind: "count"; value: number } | { kind: "empty" };

/**
 * Parse a `rows`/`columns` attribute string per the locked rules: default `1` when
 * absent/blank/non-numeric; an explicit `0` → `empty` (warn + render nothing); any
 * other value truncated to a positive integer count.
 *
 * `rows`/`columns` are LITERALS (no token support — design "Attributes"), so this is
 * a plain numeric parse, not a binding resolution.
 */
export function parseGridDimension(raw: string | undefined): GridDimension {
  if (raw === undefined) return { kind: "count", value: 1 };
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "count", value: 1 };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { kind: "count", value: 1 };
  const truncated = Math.trunc(n);
  if (truncated === 0) return { kind: "empty" };
  // A negative/sub-1 count is meaningless; fall back to the default rather than
  // emitting zero/negative slots. A fractional positive truncates toward its floor.
  if (truncated < 1) return { kind: "count", value: 1 };
  return { kind: "count", value: truncated };
}

/**
 * Parse a `gutter="x,y"` attribute into its two pixel offsets, defaulting each
 * field to 0 (a missing/blank/garbage field → 0, matching the geometry parser's
 * literal-only fallback). An absent attribute yields `{ x: 0, y: 0 }`.
 *
 * `gutter` is a LITERAL (no token support — design "Attributes"), so this is a plain
 * numeric parse with a 0 fallback rather than a binding resolution.
 */
export function parseGutter(gutter: string | undefined): { x: number; y: number } {
  const parts = (gutter ?? "").split(",");
  const x = Number((parts[0] ?? "").trim());
  const y = Number((parts[1] ?? "").trim());
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}
