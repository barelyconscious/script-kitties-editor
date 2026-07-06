# GridLayout Cell Geometry — the settled contract

> **Status: DECIDED 2026-07-06** (Matt + architect). Settles the cell-size/position
> contract the engine's hardcoded `64×64` was squatting on. Supplements
> `gridLayout_element_design_prompt.md`; where they disagree on geometry, this wins.

## The divergence this settles

Three implementations disagreed on who controls a grid cell's geometry:

| Implementation | Behavior |
|---|---|
| Editor preview (`src/lib/guiGridGeometry.ts`) | **Area division** — grid fills its parent; cell = parent ÷ rows/columns, gutter share folded in. Template geometry ignored. |
| Engine (`worlds-cpp GUILoader.cpp AddGridLayout`) | **Hardcoded 64×64**; positions at `(64+gutter)·index`. Template geometry overwritten. |
| Shipped XML (`gui.kittypacks.xml`) | Authors `size="0,0,64,64"` on the **template** — dead; only "works" because it equals the hardcoded 64. |

## The contract

| Concern | Owner |
|---|---|
| **Grid placement** | the **parent** element's `position`/`size`. The grid is a stamping macro, not an element — the parent's box *is* the grid's box. Want the grid moved/inset? Move the wrapper panel (which real screens have anyway — it's the container's chrome). |
| **Cell size** | **`cellSize` on the `<GridLayout>`** — a full UDim2 (`cellSize="0,0,64,64"` = fixed pixels; `cellSize="0.25,0.5,0,0"` = proportional to the parent). **Absent → even area division** (current preview behavior). This is not a second mode: "explicit size, else fill your share" is the same convention every ordinary element already follows. Rel components resolve against the **parent** (the one unambiguous reference box). |
| **Cell positions** | **grid-computed, always**: `index · (cell + gutter)` from the parent's content-box origin, rel/abs accumulating per axis exactly as `guiGridGeometry`'s existing axis math does. |
| **Template geometry** | **none** — the template child owns appearance only. A `position`/`size` authored on a grid child is dead (the editor suppresses the fields; a lint nudges a stray `size` toward `cellSize` on the grid). |

The layout knob family on `<GridLayout>` is therefore: `rows`, `columns`, `gutter`,
`dataCollection`, `cellSize` — all layout policy on the one element that *is* the layout.

## Alternatives rejected

- **Template-authored cell size** (the shipped XML's implied model): ratifies existing
  content, but makes template `size` meaningful while template `position` stays dead —
  an ownership exception someone trips on. Rejected for the asymmetry.
- **Area division only**: wrong for the domain — sprite slots want fixed pixel cells;
  adding a row squishes everything; fractional cells fight pixel art. Kept only as the
  no-`cellSize` default.
- **Per-item / data-bound sizes**: masonry complexity (each position depends on every
  prior cell's resolved size), no use case. Rejected outright.
- **`position` on the grid**: blurs the macro-not-element boundary and muddies what
  rel `cellSize` resolves against. **Seam kept open**: if wrapper-panel friction proves
  real, a grid `position` is a cheap additive later (bake the offset into stamped child
  positions at load — the macro nature survives). Same for a future `visible=` on the
  grid (hide the whole collection), which is the actual argument for someday promoting
  the grid to a real element. Neither is built now.

## Changes each side owes

**Engine (`worlds-cpp`, Matt/engineer):** `XGridLayout::CellSize()` parse; replace the
two hardcoded lines in `AddGridLayout` — `SetSize(resolved cellSize, default = parent
share)`, position accumulates `(cellW+gx)·c` / `(cellH+gy)·r` with the rel/abs axis
split. Small, contained.

**Editor (this repo — task queued):** `cellSize` compound field on the GridLayout
schema; `guiGridGeometry` gains the explicit-cellSize branch (absent → existing area
division, unchanged); a lint flagging a `size`/`position` authored on a grid child
("dead here — did you mean cellSize on the grid?"); `gui.kittypacks.xml`'s template
`size` migrates up to `cellSize` when the engine lands its half.
