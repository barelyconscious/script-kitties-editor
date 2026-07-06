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
 * so {@link computeBoxGeometry} renders a cell unchanged. The grid divides its
 * parent's content box EVENLY — relative cell width = `1/columns`, relative height =
 * `1/rows` — with the pixel gutter folded into the absolute (`abs`) fields so the
 * gutters sit BETWEEN cells only (N-1 gutters across N cells, NO outer-edge margin).
 *
 * The derivation (per axis, columns shown; rows are identical with `gy`):
 *   - Available width is the parent's 100%. The `C` cells collectively give up the
 *     total inter-cell gutter `(C-1)·gx`, so each cell's width is
 *     `100%/C − (C-1)/C·gx`  →  UDim2 `relX = 1/C`, `absX = −(C-1)/C·gx`.
 *   - The cell in column `c` (0-based) sits at left
 *     `c·(cellWidth + gx) = c/C·100% + c·gx/C`  →  `relX = c/C`, `absX = c·gx/C`.
 *   Worked check (C=2, gx=10): cell0 = pos `0,_,0,_` size `0.5,_,−5,_` (0%..50%−5);
 *   cell1 = pos `0.5,_,5,_` size `0.5,_,−5,_` (50%+5..100%). The gap between them is
 *   exactly 10px; neither edge cell has an outer margin.
 *
 * PURE: no React, no DOM. The caller (`GuiPreview`) maps a cell index → its
 * `{ position, size }` here, then renders the template node with that geometry.
 *
 * A grid may instead author an explicit `cellSize` — a LITERAL full UDim2
 * `"relX,relY,absX,absY"` (the system's ONE dimension grammar; `"0,0,64,64"` = fixed
 * 64px) — in which case cells are a FIXED size and positions accumulate
 * `index·(cell+gutter)` per axis; see {@link cellGeometryFixed}. Absent/blank `cellSize`,
 * the area-division default here runs unchanged.
 *
 * @see design/gridLayout_element_design_prompt.md — "Calculating Position and Size".
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
 * Compute one axis's position + size fields for the cell at 0-based `index` along an
 * axis of `count` cells separated by `gutter` px.
 *
 * - size: `rel = 1/count`, `abs = −(count−1)/count · gutter` (each cell sheds its
 *   even share of the total inter-cell gutter).
 * - position: `rel = index/count`, `abs = index · gutter / count`.
 *
 * `count` is assumed ≥ 1 (the renderer settles the `0`/default rules before calling;
 * a `0` grid renders no cells, so this is never reached with `count = 0`).
 */
function axisFields(index: number, count: number, gutter: number): { pos: Axis; size: Axis } {
  return {
    pos: { rel: index / count, abs: (index * gutter) / count },
    size: { rel: 1 / count, abs: -((count - 1) / count) * gutter },
  };
}

/** Join an x/y axis pair into a `relX,relY,absX,absY` comma string. */
function udim2(x: Axis, y: Axis): string {
  return `${x.rel},${y.rel},${x.abs},${y.abs}`;
}

/**
 * The geometry for the cell at a 0-based `index` (left-to-right, top-to-bottom) in a
 * `rows × columns` grid with an `x,y` pixel `gutter` BETWEEN cells.
 *
 * The index maps to a grid coordinate as `column = index % columns`,
 * `row = floor(index / columns)`, then each axis is laid out independently
 * ({@link axisFields}). The returned `position`/`size` are the same comma-string form
 * {@link computeBoxGeometry} parses, so a cell renders through the existing pipeline
 * with no special casing.
 *
 * @param index 0-based cell index in fill order (0 … rows·columns−1).
 * @param rows number of rows (≥ 1; the renderer handles the `0`/default rules).
 * @param columns number of columns (≥ 1).
 * @param gutterX horizontal px between columns (default 0).
 * @param gutterY vertical px between rows (default 0).
 */
export function cellGeometry(
  index: number,
  rows: number,
  columns: number,
  gutterX = 0,
  gutterY = 0,
): CellGeometry {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = axisFields(column, columns, gutterX);
  const y = axisFields(row, rows, gutterY);
  return {
    position: udim2(x.pos, y.pos),
    size: udim2(x.size, y.size),
  };
}

/**
 * The geometry for the cell at 0-based `index` when the grid authors an EXPLICIT
 * `cellSize` (design/gridlayout_cell_geometry.md). Unlike the area-division
 * {@link cellGeometry}, every cell is the SAME fixed size — the `cellSize` UDim2
 * verbatim — and positions accumulate `index·(cell + gutter)` per axis from the
 * parent's content-box origin.
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
