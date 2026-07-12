/**
 * guiLints — the pure, unit-testable INTERACTION LINTS surfaced in the structure
 * tree (task 506). Each lint names a way an element's authored attributes would
 * misbehave under the `worlds-cpp` XGUI runtime — a handler name the engine would
 * corrupt, a tooltip wired to a component that can't work as one, a `modal` value
 * that never resolves. The tree renders these the same way it renders the
 * missing-id warning: a per-node badge whose severity (error vs warning) shows at a
 * glance and whose tooltip lists the messages.
 *
 * WHY a pure module: the lint RULES are data predicates over raw attrs — the same
 * split as {@link import("../../lib/guiInteraction")} (engine-mirroring) and
 * {@link guiProperties} (editor-workflow). This lives in `pages/xgui/` because the
 * rules reach into editor-workflow facts the engine layer doesn't know:
 * the controller's exported function names ({@link exportedFunctionNames}) and a
 * lookup of a referenced tooltip component's parsed root. Both are injected via
 * {@link LintContext}, so the rules stay pure and the tree owns the IO.
 *
 * Lints are ADVISORY ONLY — they are never consulted by the save path and never
 * block a save. They inform; they don't gate.
 *
 * ── Rules (severities pinned to the design + engine ground truth) ──────────────
 *  1. `{`/`}` in any handler-kind attr → ERROR. Handler names are literal; the
 *     engine's scope-prefixing (`WithScopePrefix`) would corrupt a braced value.
 *  2. A handler name absent from the controller's exports → WARNING. Hot reload
 *     may add it later, so it is a soft signal (and skipped entirely when the
 *     controller text isn't loaded — {@link LintContext.exportedFunctions} null).
 *  3. `tooltipData` present without a `tooltip` → WARNING (dead attribute).
 *  4. `tooltipData` that is not a whole-value binding expression → ERROR (it is
 *     resolved as a scope path, so a bare literal never binds).
 *  5. The referenced tooltip component's root `size` not absolute (a non-zero
 *     relative width/height) → WARNING (tooltips should size in pixels).
 *  6. The referenced tooltip component declares a controller → WARNING (v1
 *     tooltip components are presentation-only; the controller won't run).
 *  7. `modal` value not a clean literal boolean → ERROR for a `{token}` (read
 *     pre-binding via pugixml `as_bool`, so it never resolves), WARNING for any
 *     other non-boolean literal (the engine reads only the first character).
 *  8. A BARE `{token}` (grid-item scope) in a presentational attr OUTSIDE any
 *     GridLayout child subtree → WARNING (bare only resolves for a grid item; the
 *     author likely meant `{$.token}`).
 *  9. `position`/`size` authored on a GridLayout's DIRECT child (the template) →
 *     WARNING (dead geometry — the grid computes cell position and takes cell size
 *     from `cellSize` on the GridLayout; the template owns appearance only). Fires
 *     only on the template itself, not its descendants (which lay out normally
 *     within the cell). See design/gridlayout_cell_geometry.md.
 * 10. A `{token}` (any brace) in a GridLayout's `rows`/`columns`/`gutter`/`cellSize`
 *     → ERROR (grid structure is stamped ONCE at load, outside the runtime binding
 *     system, so a bound structural attr never resolves). `dataCollection` is exempt —
 *     it IS grammar (a scope path resolved at stamp time). See
 *     design/gridlayout_cell_geometry.md, "Grid structure is LITERAL-ONLY".
 * 11. A present, non-empty, token-free `cellSize` on a GridLayout with FEWER than four
 *     comma fields → WARNING (`cellSize` is a full UDim2 `"relX,relY,absX,absY"`; a short
 *     value is read by {@link parseUDim2} with the missing fields as 0, so a 2-field
 *     `"64,64"` becomes a 6400%-rel cell, not 64px). A 2-field numeric value gets a
 *     did-you-mean suggesting the UDim2 (`"64,64"` → `"0,0,64,64"`); other short counts
 *     get a generic message. Four well-formed fields (blanks → 0) do NOT fire. Doesn't
 *     double-fire with rule 10: a braced value errors there and is skipped here. See
 *     design/gridlayout_cell_geometry.md.
 *
 * @see design/xgui_ta.md — interaction attributes; the ENGINE files cited in
 *   {@link import("../../lib/guiInteraction")} are the source of truth on disagreement.
 */

import { isWholeToken, parseScopeRef } from "../../lib/guiBinding";
import {
  FOCUS_HANDLER_ATTRS,
  hasTooltip,
  isModal,
  MODAL_ATTR,
  MOUSE_HANDLER_ATTRS,
  TOOLTIP_ATTR,
} from "../../lib/guiInteraction";
import type { GuiNode } from "../../lib/guiNode";
import { parseCompound, srcBasename } from "./guiProperties";

/** A lint's severity — drives the badge color (error = red, warning = amber). */
export type LintSeverity = "error" | "warning";

/** One diagnostic on a node: which attribute it points at, plus a message. */
export type Lint = {
  severity: LintSeverity;
  /** The attribute the lint concerns (for display/anchoring). */
  attr: string;
  /** Human-readable, actionable message shown in the badge tooltip. */
  message: string;
};

/**
 * The editor-workflow facts the lint rules need but can't derive from the node
 * alone, injected so the rules stay pure (the structure tree owns the IO that
 * produces these).
 */
export type LintContext = {
  /**
   * The controller's exported function names (task 504's {@link exportedFunctionNames}),
   * or `null` when the controller text isn't loaded (or the component has none). When
   * `null`, the handler-exists lint (rule 2) is SKIPPED — an unknown-name warning is
   * only trustworthy once we actually have the controller to check against.
   */
  exportedFunctions: readonly string[] | null;
  /**
   * Resolve a `tooltip` attribute value (a `.xml`-suffixed component ref) to the
   * referenced component's parsed root, or `null` when it isn't available (missing,
   * still loading, or unparseable). When `null`, the tooltip-component lints
   * (rules 5–6) are SKIPPED.
   */
  resolveComponent: (tooltipRef: string) => GuiNode | null;
};

/** The handler-kind attributes shared by hit-testable widgets (mouse + focus). */
const HANDLER_ATTRS: readonly string[] = [...MOUSE_HANDLER_ATTRS, ...FOCUS_HANDLER_ATTRS];

/**
 * The attributes the bare-token lint (rule 8) IGNORES — the structural / literal-only
 * ones the engine never binds (so a bare token in them is not a dead binding), plus the
 * interaction attrs that carry their own dedicated lints (handlers → rule 1, `modal` →
 * rule 7, `tooltip` → rules 5–6). Everything else is presentational and gets scanned.
 * Built from the shared engine constants rather than a hand-listed set of names.
 */
const BARE_TOKEN_EXCLUDED = new Set<string>([
  "id",
  "src",
  "controller",
  ...MOUSE_HANDLER_ATTRS,
  ...FOCUS_HANDLER_ATTRS,
  MODAL_ATTR,
  TOOLTIP_ATTR,
]);

/** A clean, unambiguous literal boolean the engine's `as_bool` reads as intended. */
const CLEAN_BOOL = /^(true|false|1|0|yes|no)$/i;

/** Matches each embedded `{token}` (mirrors guiBinding's interpolation grammar). */
const EMBEDDED_TOKEN = /\{([^{}]+)\}/g;

/** The handler-valued attribute names present on a node. */
function handlerAttrNames(node: GuiNode): string[] {
  return HANDLER_ATTRS.filter((n) => n in node.attrs);
}

/** Rule 1 + 2: braces in a handler are corruption (ERROR); an unknown name is soft (WARNING). */
function handlerLints(node: GuiNode, ctx: LintContext, out: Lint[]): void {
  for (const attr of handlerAttrNames(node)) {
    const value = node.attrs[attr];
    if (value === "") continue; // empty = no handler wired
    if (value.includes("{") || value.includes("}")) {
      out.push({
        severity: "error",
        attr,
        message: `Handler names are literal — the "{"/"}" in ${attr}="${value}" would be corrupted by the engine's scope-prefixing. Remove the braces.`,
      });
      continue; // a braced value isn't a real name; don't also warn "not found"
    }
    if (ctx.exportedFunctions != null && !ctx.exportedFunctions.includes(value.trim())) {
      out.push({
        severity: "warning",
        attr,
        message: `${attr}="${value}" isn't a function in the controller (hot reload may add it later).`,
      });
    }
  }
}

/** Rules 3–6: the tooltip / tooltipData diagnostics. */
function tooltipLints(node: GuiNode, ctx: LintContext, out: Lint[]): void {
  const tooltipData = node.attrs.tooltipData;
  if (tooltipData !== undefined && tooltipData !== "") {
    // (3) dead without a tooltip to seed.
    if (!hasTooltip(node)) {
      out.push({
        severity: "warning",
        attr: "tooltipData",
        message:
          "tooltipData has no effect without a tooltip — add a tooltip component, or remove tooltipData.",
      });
    }
    // (4) resolved as a binding expression, so a non-binding literal never binds.
    if (!isWholeToken(tooltipData)) {
      out.push({
        severity: "error",
        attr: "tooltipData",
        message: `tooltipData is resolved as a binding expression — "${tooltipData}" isn't one. Wrap the model path as {$.path}.`,
      });
    }
  }

  const ref = node.attrs[TOOLTIP_ATTR];
  if (ref === undefined || ref === "") return;
  const root = ctx.resolveComponent(ref);
  if (root === null) return; // missing / loading / unparseable → can't inspect
  const name = srcBasename(ref);
  // (5) tooltips should size in absolute pixels — a relative root size is suspect.
  if (!rootSizeIsAbsolute(root)) {
    out.push({
      severity: "warning",
      attr: TOOLTIP_ATTR,
      message: `Tooltip component "${name}" has a relative root size — tooltips should size in absolute pixels (relative width/height won't lay out predictably).`,
    });
  }
  // (6) v1 tooltip components are presentation-only.
  if (root.tag === "View" && root.attrs.controller?.trim()) {
    out.push({
      severity: "warning",
      attr: TOOLTIP_ATTR,
      message: `Tooltip component "${name}" declares a controller — v1 tooltip components are presentation-only, so its controller won't run.`,
    });
  }
}

/**
 * Whether a component root's `size` is absolute — both relative fields (scaleX,
 * scaleY) are zero. A missing size, or a relative field that is a token /
 * non-numeric (can't be proven non-zero), is treated as NOT a violation, so the
 * lint only fires on a clearly non-zero relative dimension.
 */
function rootSizeIsAbsolute(root: GuiNode): boolean {
  const size = root.attrs.size;
  if (size === undefined || size === "") return true;
  const { scaleX, scaleY } = parseCompound(size);
  return relIsZeroOrUnknown(scaleX) && relIsZeroOrUnknown(scaleY);
}

/** A relative field counts as "not a violation" when it is zero or non-numeric (unknowable). */
function relIsZeroOrUnknown(field: string): boolean {
  const n = Number(field);
  return !Number.isFinite(n) || n === 0;
}

/** Rule 7: `modal` is read pre-binding via `as_bool`, so a non-literal value misbehaves. */
function modalLint(node: GuiNode, out: Lint[]): void {
  const value = node.attrs[MODAL_ATTR];
  if (value === undefined || value === "") return;
  if (isWholeToken(value)) {
    out.push({
      severity: "error",
      attr: MODAL_ATTR,
      message: `modal is read pre-binding (as_bool) — a {token} never resolves. Use a literal true or false.`,
    });
    return;
  }
  if (CLEAN_BOOL.test(value.trim())) return; // clean literal — reads as intended
  out.push({
    severity: "warning",
    attr: MODAL_ATTR,
    message: `modal="${value}" isn't a clean boolean — the engine reads it as ${isModal(node) ? "truthy" : "falsy"} (as_bool inspects only the first character).`,
  });
}

/**
 * Rule 9: `position`/`size` on a GridLayout's DIRECT child is dead geometry — the grid
 * assigns the cell's position (grid-computed) and size (from `cellSize` on the grid),
 * so the template's own geometry is ignored. Fires on PRESENCE (not value) and only on
 * the template itself; a descendant deeper in the template lays out normally within the
 * cell, so it is left alone. See design/gridlayout_cell_geometry.md.
 */
function gridChildGeometryLints(node: GuiNode, isGridTemplate: boolean, out: Lint[]): void {
  if (!isGridTemplate) return;
  for (const attr of ["position", "size"] as const) {
    if (attr in node.attrs) {
      out.push({
        severity: "warning",
        attr,
        message: `${attr} on a GridLayout child is ignored — the grid computes each cell's position, and cell size comes from cellSize on the GridLayout. Set cellSize on the grid instead.`,
      });
    }
  }
}

/**
 * The GridLayout STRUCTURAL attributes that are literal-only — stamped once at load,
 * outside the runtime binding system (rule 10). `dataCollection` is intentionally
 * absent: it is grammar (a scope path resolved at stamp time), not structure.
 */
const GRID_STRUCTURE_ATTRS: readonly string[] = ["rows", "columns", "gutter", "cellSize"];

/**
 * Rule 10: a `{token}` in a GridLayout's `rows`/`columns`/`gutter`/`cellSize` is a dead
 * binding — grid structure is baked once at load, outside the runtime binding system, so
 * a braced structural attr never resolves. Fires only on the `<GridLayout>` element
 * itself. `dataCollection` is exempt (it IS grammar).
 */
function gridStructureLints(node: GuiNode, out: Lint[]): void {
  if (node.tag !== "GridLayout") return;
  for (const attr of GRID_STRUCTURE_ATTRS) {
    const value = node.attrs[attr];
    if (value === undefined || value === "") continue;
    if (value.includes("{") || value.includes("}")) {
      out.push({
        severity: "error",
        attr,
        message: `${attr}="${value}" can't bind — grid structure is stamped at load, outside the runtime binding system. Use a literal value.`,
      });
      continue; // rule 11 doesn't double-fire on a token value that already errored.
    }
    // Rule 11: a present, non-empty, token-free cellSize with FEWER than four fields.
    if (attr === "cellSize" && value.split(",").length < 4) {
      out.push({
        severity: "warning",
        attr,
        message: malformedCellSizeMessage(value),
      });
    }
  }
}

/**
 * Rule 11's message for a short `cellSize`. A cellSize is a full UDim2
 * `"relX,relY,absX,absY"` (four fields); a value with fewer fields is read by
 * {@link parseUDim2} with the missing fields as 0, so it renders wrongly rather than as
 * the author intended. The common mistake is the TWO-field pixel pair authors reach for
 * by muscle memory (`"64,64"`, which becomes a 6400%-rel cell) — so an exactly-two
 * numeric-field value gets a did-you-mean pointing at the full UDim2 (`"64,64"` →
 * `"0,0,64,64"`, the fixed-pixel form). Other short counts get a generic message.
 */
function malformedCellSizeMessage(value: string): string {
  const parts = value.split(",").map((p) => p.trim());
  if (parts.length === 2 && parts.every((p) => p !== "" && Number.isFinite(Number(p)))) {
    const suggestion = `0,0,${parts[0]},${parts[1]}`;
    return `cellSize is a UDim2 "relX,relY,absX,absY" — did you mean "${suggestion}"?`;
  }
  return `cellSize is a UDim2 "relX,relY,absX,absY" (four comma fields) — this has ${parts.length}.`;
}

/** Rule 8: a bare grid-item token used outside any GridLayout subtree is likely a `$.` mistake. */
function bareTokenLints(node: GuiNode, insideGrid: boolean, out: Lint[]): void {
  if (insideGrid) return; // bare tokens are legitimate item scope inside a grid
  for (const [attr, value] of Object.entries(node.attrs)) {
    if (BARE_TOKEN_EXCLUDED.has(attr)) continue;
    if (!value.includes("{")) continue;
    const bare = firstBareItemToken(value);
    if (bare === null) continue;
    const suggestion = bare === "." ? "{$.}" : `{$.${bare}}`;
    out.push({
      severity: "warning",
      attr,
      message: `${attr} uses a bare {${bare}} — bare tokens only resolve inside a GridLayout item. Did you mean ${suggestion}?`,
    });
  }
}

/** The first embedded token in `value` that classifies as the grid-item scope, or `null`. */
function firstBareItemToken(value: string): string | null {
  EMBEDDED_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null = EMBEDDED_TOKEN.exec(value);
  while (match !== null) {
    const token = match[1].trim();
    if (parseScopeRef(token).frame === "item") return token;
    match = EMBEDDED_TOKEN.exec(value);
  }
  return null;
}

/**
 * The GridLayout context a node sits in, threaded by {@link lintTree}:
 *   - `insideGrid` — the node is a DESCENDANT of a GridLayout (its whole template
 *     subtree), so bare `{item}` tokens are legitimate (rule 8 stands down).
 *   - `isGridTemplate` — the node is the DIRECT child of a GridLayout (the template
 *     itself), so its own `position`/`size` is dead geometry (rule 9).
 */
export type GridLintContext = { insideGrid: boolean; isGridTemplate: boolean };

/**
 * All lints on a single node, given its {@link GridLintContext} (for the grid-scoped
 * rules 8 + 9) and the injected {@link LintContext}. Exported for direct unit testing;
 * the tree drives {@link lintTree}, which threads the grid context.
 */
export function nodeLints(node: GuiNode, grid: GridLintContext, ctx: LintContext): Lint[] {
  const out: Lint[] = [];
  handlerLints(node, ctx, out);
  tooltipLints(node, ctx, out);
  modalLint(node, out);
  bareTokenLints(node, grid.insideGrid, out);
  gridChildGeometryLints(node, grid.isGridTemplate, out);
  gridStructureLints(node, out);
  return out;
}

/**
 * Lint the whole tree, returning a map of `nodeId → lints` for every node that has
 * any (nodes with none are absent from the map, so the tree renders a badge only
 * where there's something to say). Threads the GridLayout context: a node is
 * "inside a grid" when it is a descendant of a GridLayout (the item template) — the
 * GridLayout element itself is NOT (its `dataCollection` binds the View scope).
 */
export function lintTree(root: GuiNode, ctx: LintContext): Map<string, Lint[]> {
  const out = new Map<string, Lint[]>();
  const walk = (node: GuiNode, insideGrid: boolean, isGridTemplate: boolean): void => {
    const lints = nodeLints(node, { insideGrid, isGridTemplate }, ctx);
    if (lints.length > 0) out.set(node.nodeId, lints);
    const isGrid = node.tag === "GridLayout";
    // Children of a grid are its templates (rule 9); the whole subtree is "inside a
    // grid" for the bare-token rule (rule 8).
    for (const child of node.children) walk(child, insideGrid || isGrid, isGrid);
  };
  walk(root, false, false);
  return out;
}

/**
 * The distinct tooltip component basenames referenced anywhere in the tree (each
 * `tooltip` attr's `.xml`-stripped basename), sorted. The structure tree uses this
 * to know which components to fetch for the tooltip lints (rules 5–6).
 */
export function collectTooltipBasenames(root: GuiNode): string[] {
  const names = new Set<string>();
  const walk = (node: GuiNode): void => {
    const ref = node.attrs[TOOLTIP_ATTR];
    if (ref !== undefined && ref !== "") names.add(srcBasename(ref));
    for (const child of node.children) walk(child);
  };
  walk(root);
  return [...names].sort();
}

/**
 * The worst severity among a set of lints (`error` wins over `warning`), or `null`
 * when there are none. Drives the badge's icon + color in one place.
 */
export function worstSeverity(lints: readonly Lint[]): LintSeverity | null {
  if (lints.length === 0) return null;
  return lints.some((l) => l.severity === "error") ? "error" : "warning";
}
