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
| **Cell size** | **`cellSize` on the `<GridLayout>`** — a **literal pixel pair** `cellSize="w,h"` (matching `gutter="gx,gy"`'s format). **Absent → even area division** (current preview behavior). The split is clean: *proportional cells = omit cellSize* (area division is gutter-aware and fits the parent); *fixed cells = pixels* (extent emergent, may overflow — fine, no clipping). **REVISED 2026-07-06 (Matt):** the earlier full-UDim2 form is dropped — a rel component + gutters overflows the parent (`C·(rel·parentW) + (C−1)·g > parentW`), the gutter-shed the author actually wants is exactly what area division computes, so rel bought nothing and added a footgun. |
| **Cell positions** | **grid-computed, always**: `index · (cell + gutter)` from the parent's content-box origin, rel/abs accumulating per axis exactly as `guiGridGeometry`'s existing axis math does. |
| **Template geometry** | **none** — the template child owns appearance only. A `position`/`size` authored on a grid child is dead (the editor suppresses the fields; a lint nudges a stray `size` toward `cellSize` on the grid). |

The layout knob family on `<GridLayout>` is therefore: `rows`, `columns`, `gutter`,
`dataCollection`, `cellSize` — all layout policy on the one element that *is* the layout.

## Grid structure is LITERAL-ONLY — no runtime bindings (locked, Matt 2026-07-06)

`rows`, `columns`, `gutter`, and `cellSize` **cannot carry `{token}` bindings, and never
will under this contract.** The reason is structural, not incidental: `AddGridLayout`
stamps the template and bakes each cell's `Dim` **once, at load** — grid structure lives
entirely outside the runtime binding system, and a bound structural attr would require
re-stamping the subtree on model change (a different, unbuilt machine). Same class as
`modal` (read pre-binding via `as_bool`). Only `dataCollection` is grammar — a scope
path, resolved at stamp time.

The editor makes this unmissable rather than silently wrong: the schema marks these
fields literal-only (no token affordance), the preview parses them as literals (never
through the binding resolver), and a `{token}` authored into any of the four is an
ERROR lint ("grid structure is stamped at load — it cannot bind").

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

**Engine (`worlds-cpp`, Matt/engineer):** `XGridLayout::CellSize()` — a two-int parse
like `Gutter()`; replace the two hardcoded lines in `AddGridLayout` — `SetSize(w,h)`
(default = the parent-share division), position `((w+gx)·c, (h+gy)·r)`. Pure pixel
math, no binding resolution. Small, contained.

**Editor (this repo — task queued):** `cellSize` compound field on the GridLayout
schema; `guiGridGeometry` gains the explicit-cellSize branch (absent → existing area
division, unchanged); a lint flagging a `size`/`position` authored on a grid child
("dead here — did you mean cellSize on the grid?"); `gui.kittypacks.xml`'s template
`size` migrates up to `cellSize` when the engine lands its half.
