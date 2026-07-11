/**
 * GuiPreview — the XGUI editor's preview render core (F2).
 *
 * Renders a {@link GuiNode} tree into nested, absolutely-positioned DOM inside
 * the fixed 1280×768 stage, mapping the rel/abs (UDim2) `position`/`size` model
 * onto `calc()` geometry. This is the renderer SPINE; later increments extend
 * it WITHOUT reshaping it:
 *
 *   F3  binding/token resolution  → resolve attr values before they reach the
 *                                   box (a value transform in front of the
 *                                   render; the render shape is unchanged).
 *   F5  layer z-order             → a flatten pass over the same tree assigning
 *                                   EACH box a numeric `z-index` = its rank among
 *                                   its siblings (the intuitive NESTED model:
 *                                   layer orders a box among its siblings, and a
 *                                   container's layer lifts its whole subtree).
 *   F6b component mounting        → replace a `<Component>`'s plain box with the
 *                                   mounted src subtree / missing-src placeholder.
 *   F7  drag                      → a pointer handler that writes Δpx back to the
 *                                   selected node's `absX`/`absY`.
 *
 * The geometry math ({@link computeBoxGeometry}) and selection semantics
 * ({@link nearestNodeId}, {@link isNodeSelected}) are pure and live in
 * `lib/guiGeometry.ts` / `lib/guiSelection.ts`; this component is the thin React
 * shell that wires them to the DOM.
 *
 * Nested z-order model (supersedes the old F5a global-flat one): an element's
 * `layer` orders it among its SIBLINGS, and a container's layer lifts the
 * container AND its whole subtree as a group. Every box carries its own
 * sibling-rank `z-index` and so forms its own stacking context — that nested
 * containment IS the grouping, no longer something to avoid. The selection
 * highlight still uses `outline` + `box-shadow` only (no transform/opacity) so it
 * never warps geometry. The ROOT stage is still the one intentional zoom/pan
 * transform host (the view transform lives only there, never on a child box).
 *
 * @see design/xgui_ta.md — "F5a/F5b — nested z-order model"
 */

import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from "react";
import { useSprite } from "../../components/Sprite";
import {
  colorCodeToCss,
  emptyItemScope,
  gridItemScope,
  type Palette,
  type ResolvedAttrs,
  type ResolveScope,
  resolveAttrs,
  resolveWholeTokenValue,
  viewScope,
} from "../../lib/guiBinding";
import { type ComponentEntry, useComponent } from "../../lib/guiComponentCache";
import {
  mountDecision,
  type PlaceholderReason,
  resolveChildRoot,
  srcBasename,
} from "../../lib/guiComponentMount";
import {
  computeBoxGeometry,
  dragStartDecision,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  screenDeltaToLogical,
  textureToLoad,
  type ViewTransform,
} from "../../lib/guiGeometry";
import {
  cellGeometryFixed,
  DEFAULT_CELL_SIZE,
  parseGridDimension,
  parseGutter,
} from "../../lib/guiGridGeometry";
import { stampGrid } from "../../lib/guiGridStamp";
import type { GuiNode } from "../../lib/guiNode";
import { isNodeSelected, NODE_ID_ATTR } from "../../lib/guiSelection";
import {
  pickHoverTarget,
  type StageRect,
  screenRectToStageRect,
} from "../../lib/guiTooltipPlacement";
import { type BoxKey, computeZOrder, makeBoxKey, type ZOrderMap } from "../../lib/guiZOrder";
import { cn } from "../../lib/utils";
import {
  createTooltipRegistry,
  type TooltipRegistry,
  TooltipRegistryProvider,
  useTooltipProvider,
} from "./guiTooltipRegistry";

/** The DOM attribute marking a `<Component>` mount's missing/recursive placeholder. */
export const PLACEHOLDER_ATTR = "data-gui-placeholder";

/** A box-producing element tag. `View` is the stage; `GridLayout` is non-visual. */
function isVisualTag(tag: GuiNode["tag"]): boolean {
  return tag === "Panel" || tag === "Text" || tag === "Component";
}

/** Default text color when `color` is absent (design default). */
const DEFAULT_TEXT_COLOR = "185,178,165,255";

/**
 * The engine renders all GUI text with vgaoem.fon (VGA OEM / DOS raster, CP437).
 * We mirror that in the preview with Web437 "IBM VGA 9x16" (a pixel-accurate open
 * reproduction; see src/assets/fonts/), falling back to a generic monospace if
 * the webfont hasn't loaded. Scoped to Text boxes only.
 */
const PREVIEW_TEXT_FONT = '"Web437 IBM VGA", monospace';

/**
 * Match the game's on-screen text proportions. Calibrated from a side-by-side
 * screenshot of the same component (game vs preview), normalized to the shared
 * panel width so the two windows' zoom cancels out. The engine renders vgaoem.fon
 * with glyph cells that are ~1.8x WIDER (relative to the layout) than the base
 * 9x16 proportions, while the glyph HEIGHT nearly matches. So we bump the size a
 * touch and stretch each glyph horizontally.
 *
 * HEIGHT_SCALE multiplies the authored `fontSize` (uniform size). WIDTH_STRETCH is
 * an additional horizontal-only scale applied on top (see the text wrapper in the
 * box render). Net width ≈ HEIGHT_SCALE * WIDTH_STRETCH; net height ≈ HEIGHT_SCALE.
 * Tune these two if the preview drifts from the game.
 */
const PREVIEW_FONT_HEIGHT_SCALE = 1.1;
const PREVIEW_FONT_WIDTH_STRETCH = 1.65;

/** transform-origin for the horizontal text stretch, so it grows away from the
 *  text's anchor edge and stays put under its `textAlign`. */
function stretchOrigin(align: CSSProperties["textAlign"]): string {
  if (align === "center") return "center";
  if (align === "right" || align === "end") return "right center";
  return "left center";
}

/** Map a resolved `textAlign` value to its CSS `text-align`. */
function cssTextAlign(value: string | undefined): CSSProperties["textAlign"] {
  switch (value?.trim().toUpperCase()) {
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    case "LEFT":
      return "left";
    default:
      return undefined;
  }
}

/**
 * The text a `<Text>` box paints — the RESOLVED `text` value (tokens
 * interpolated). An unbound token survives as its literal `{token}` form (styled
 * as waiting-for-binding by the box). Empty/absent text paints nothing.
 */
function boxText(resolved: ResolvedAttrs): string {
  return resolved.attrs.text ?? "";
}

type GuiBoxProps = {
  node: GuiNode;
  selectedNodeId: string | null;
  /**
   * The scope this box renders in. `{$.x}` bindings resolve against the View frame
   * (see {@link viewScope}); a GridLayout child renders against a
   * {@link gridItemScope} composed over it. The stage passes the root View scope; a
   * mounted `<Component>` builds a fresh View scope from its `data=`/overrides.
   */
  scope: ResolveScope;
  palette: Palette;
  /**
   * This box's render-reproducible identity path, built from its parent's key + its
   * own `nodeId`. Used to look the box's sibling-rank `z-index` up in
   * {@link zOrder} and to derive each child's key.
   */
  boxKey: BoxKey;
  /**
   * The nested `boxKey → z-index` map for the whole component. EVERY box applies
   * its mapped z-index, which orders it among its siblings within its parent's
   * stacking context; a container's z-index lifts its whole subtree as a group.
   */
  zOrder: ZOrderMap;
  /**
   * The set of `<Component>` `src` basenames on the mount path TO this box (F6b
   * cycle guard). Empty at the stage root; a `<Component>` mount adds its own
   * basename before descending into the child, so a re-encounter of the same src
   * deeper down is caught as `recursive` instead of looping. Plain (non-mounted)
   * descent passes the set through unchanged.
   */
  ancestry: ReadonlySet<string>;
  /**
   * When this box is a GRID CELL, the geometry the GridLayout assigns it (overriding
   * the template's own `position`/`size`, which are ignored — design req 4/5). The
   * raw `position`/`size` comma strings from {@link cellGeometry}. Omitted for an
   * ordinary box, which reads its geometry from its own attrs.
   */
  geometryOverride?: { position: string; size: string };
  /**
   * When this box is a `<Component>` GRID CELL, the grid item to seat as the mounted
   * child's FULL fresh root (replacing `data=`/override resolution — locked decision).
   * `undefined` means "not a grid Component cell"; an explicit `null`/value is the
   * cell's item (a `null` item → empty child scope, tokens → ""). Only consulted for
   * a `<Component>` box.
   */
  componentRootOverride?: { item: unknown };
  /**
   * GRID CELL only: when true, the box does NOT stamp its `data-node-id`, so a click
   * or drag on it falls through to the nearest ENCLOSING real box (the GridLayout's
   * parent) — cells are never individually selectable (locked decision Q4). The grid
   * wrapper is also `pointer-events-none`; suppressing the id is belt-and-suspenders.
   */
  suppressNodeId?: boolean;
};

/**
 * Render a node's visual children into boxes — each child renders exactly once in
 * the inherited flat scope. Returns the `<GuiBox>` elements so both the stage root
 * and every box use the same rule. `GuiBox` is scope-agnostic beyond reading the
 * passed {@link ResolveScope} for attribute resolution.
 */
function renderChildren(
  children: GuiNode[],
  selectedNodeId: string | null,
  scope: ResolveScope,
  palette: Palette,
  parentKey: BoxKey,
  zOrder: ZOrderMap,
  ancestry: ReadonlySet<string>,
) {
  return children
    .filter((child) => child.tag === "GridLayout" || isVisualTag(child.tag))
    .map((child) =>
      child.tag === "GridLayout" ? (
        // A GridLayout is NON-VISUAL: it renders no box of its own and expands its
        // single template child into a fixed rows×columns grid of cells filling the
        // parent's content box (see {@link GridLayoutExpansion}).
        <GridLayoutExpansion
          key={child.nodeId}
          node={child}
          scope={scope}
          palette={palette}
          parentKey={parentKey}
          zOrder={zOrder}
          ancestry={ancestry}
        />
      ) : (
        <GuiBox
          key={child.nodeId}
          node={child}
          selectedNodeId={selectedNodeId}
          scope={scope}
          palette={palette}
          boxKey={makeBoxKey(parentKey, child.nodeId)}
          zOrder={zOrder}
          ancestry={ancestry}
        />
      ),
    );
}

/**
 * One rendered box plus its children. `position: absolute` inside its parent's
 * `position: relative` box so `calc(rel * 100% + abs px)` resolves against the
 * parent content box. No `overflow: hidden` — children that exceed the box
 * paint outside it, matching the runtime.
 *
 * F3: attribute values are RESOLVED (tokens bound, palette names looked up) before
 * geometry/color/text are computed, and any attribute that didn't fully resolve
 * triggers the waiting-for-binding affordance on the box.
 */
const GuiBox = memo(function GuiBox({
  node,
  selectedNodeId,
  scope,
  palette,
  boxKey,
  zOrder,
  ancestry,
  geometryOverride,
  componentRootOverride,
  suppressNodeId,
}: GuiBoxProps) {
  // Resolve the whole attribute bag once against this box's flat scope: geometry,
  // colors, and text all read off the resolved values, and `unresolved` drives the
  // waiting-binding styling. The pure resolver only needs a `ResolveScope`.
  const resolved = resolveAttrs(node.attrs, scope, palette);
  const { attrs, unresolved } = resolved;

  // F: texture-as-background. Load the box's RESOLVED `texture` through the shared
  // sprite cache (only a present, fully-resolved name fetches; an empty/unresolved
  // texture loads nothing — no broken-image icon). The data URL arrives async and
  // is painted as the box's background image BEHIND its text/child boxes (those are
  // the div's text node + separately-positioned child elements, both above the
  // background layer). `pixelated` matches how <Sprite> renders the art. The hook
  // runs BEFORE any early return so it is called unconditionally (rules of hooks).
  const textureName = textureToLoad(attrs.texture, !unresolved.has("texture"));
  const textureUrl = useSprite(textureName);

  // Tooltip simulation (task 515): a box that authors a non-empty `tooltip=` registers
  // itself as a hover provider (its live screen rect + tooltip ref + scope-resolved
  // `tooltipData`) so the preview can show its card — this is the ONLY way a
  // pointer-events-none grid cell can drive a tooltip. A no-op for boxes without a
  // tooltip. Called unconditionally (before the `visible` early return) per hooks rules;
  // a hidden box's ref stays null, so its snapshot rect is null and it never shows.
  const boxRef = useRef<HTMLDivElement>(null);
  useTooltipProvider(boxKey, node, boxRef, scope);

  // `visible="false"` (literal or bound) hides the box; any other value shows it.
  if (attrs.visible?.trim().toLowerCase() === "false") return null;

  // A grid cell's geometry is owned by the GridLayout (the template's own
  // position/size are ignored — design req 4/5); an ordinary box reads its own attrs.
  const geometry = geometryOverride
    ? computeBoxGeometry(geometryOverride.position, geometryOverride.size)
    : computeBoxGeometry(attrs.position, attrs.size);
  const selected = isNodeSelected(node.nodeId, selectedNodeId);

  const backgroundColor = colorCodeToCss(attrs.backgroundColor);
  const borderColor = colorCodeToCss(attrs.borderColor);
  const borderSize = attrs.borderSize?.trim();
  const hasBorder = borderColor !== undefined && borderColor !== "transparent";
  const isText = node.tag === "Text";

  // Nested z-order: EVERY box gets a numeric z-index = its rank among its siblings
  // (resolved `layer`, ties → document order). Because each box carries its own
  // z-index it forms a stacking context, so its z-index orders it only within its
  // PARENT's context and its whole subtree is contained inside it — a container's
  // layer therefore lifts/lowers the container and its subtree as a group. (This
  // intentional per-box stacking context supersedes the old "no z-index on
  // wrappers" rule: nesting the contexts is exactly the desired grouping.)
  const zIndex = zOrder.get(boxKey);
  const textColor = isText ? colorCodeToCss(attrs.color ?? DEFAULT_TEXT_COLOR) : undefined;
  const fontSize = isText ? Number(attrs.fontSize) : Number.NaN;

  // Highlight via outline + box-shadow ONLY (drawn in-flow, no extra DOM). Avoid
  // transform/opacity/filter so the highlight never warps geometry or affects the
  // box's compositing; the box already forms its own (intended) stacking context
  // via its z-index, so the highlight doesn't change the layering model.
  const style: CSSProperties = {
    ...geometry,
    backgroundColor,
    // Texture sprite as the box's background image — only set once the data URL
    // has loaded (undefined otherwise, so no background layer / no broken icon).
    // `100% 100%` fills the box like the runtime; pixelated keeps the pixel art crisp.
    backgroundImage: textureUrl ? `url("${textureUrl}")` : undefined,
    backgroundSize: textureUrl ? "100% 100%" : undefined,
    backgroundRepeat: textureUrl ? "no-repeat" : undefined,
    imageRendering: textureUrl ? "pixelated" : undefined,
    // Authored border wins over the editor hairline; otherwise the hairline shows.
    border: hasBorder
      ? `${borderSize && Number.isFinite(Number(borderSize)) ? Number(borderSize) : 1}px solid ${borderColor}`
      : undefined,
    color: textColor,
    fontFamily: isText ? PREVIEW_TEXT_FONT : undefined,
    // HEIGHT_SCALE brings the authored size up to the game's rendered size; the
    // extra horizontal stretch lives on the inner text wrapper below.
    fontSize:
      isText && Number.isFinite(fontSize) ? `${fontSize * PREVIEW_FONT_HEIGHT_SCALE}px` : undefined,
    // The engine draws each glyph flush to the element's top (DrawText renders at
    // the box origin). Collapse the inherited leading (the app base is 1.5, which
    // otherwise centers the glyph in a tall line box and drops it below where the
    // game paints it) so preview text top-aligns like the runtime.
    lineHeight: isText ? 1 : undefined,
    textAlign: isText ? cssTextAlign(attrs.textAlign) : undefined,
    // No `overflow` key at all → defaults to `visible` → overflow paints out.
    // Nested z-order: every box applies its sibling-rank z-index (a container's
    // z-index lifts its subtree as a group via the nested stacking context).
    zIndex,
    outline: selected ? "2px solid var(--ring, #3b82f6)" : undefined,
    outlineOffset: selected ? "-1px" : undefined,
    boxShadow: selected ? "0 0 0 1px rgba(255,255,255,0.6)" : undefined,
  };

  // Waiting-for-binding affordance: any attribute that didn't fully resolve (an
  // unbound {token}, a dangling palette name) styles the box distinctly so it
  // reads as "binding waiting for data," not broken — consistent across the
  // preview. Drawn with outline/dashed border + dimming, all stacking-safe.
  const waiting = unresolved.size > 0;

  return (
    <div
      ref={boxRef}
      {...(suppressNodeId ? {} : { [NODE_ID_ATTR]: node.nodeId })}
      data-gui-tag={node.tag}
      data-gui-waiting={waiting ? "" : undefined}
      className={cn(
        "select-none",
        // A faint hairline so empty/transparent boxes are still visible and
        // clickable in the editor.
        hasBorder ? null : "border border-white/10 border-dashed",
        // Waiting-binding affordance — a dashed amber ring drawn with `outline` (no
        // transform/opacity, so it never warps the box or its geometry).
        waiting && "rounded-[2px] outline outline-dashed outline-1 outline-amber-400/70",
      )}
      style={style}
    >
      {isText ? (
        // The game draws vgaoem.fon with much wider glyph cells than the base
        // 9x16 font. An inline-block wrapper lets us stretch ONLY the glyphs
        // horizontally (transform is visual-only, so the box geometry, selection
        // rect and hit-testing are untouched); the origin follows textAlign so
        // the text grows away from its anchor edge instead of drifting.
        //
        // Because scaleX is visual-only, wrapping is computed on the UNSTRETCHED
        // text — so we pre-shrink the wrapper to (100% / stretch). The browser
        // then wraps at that narrower width, and the scaleX blows each line back
        // out to exactly fill the box, keeping wrapped text inside the bounds.
        <span
          style={{
            display: "inline-block",
            width: `${100 / PREVIEW_FONT_WIDTH_STRETCH}%`,
            // Top-align to the box's line box so the collapsed leading isn't
            // reintroduced as a baseline offset above the glyphs.
            verticalAlign: "top",
            transform: `scaleX(${PREVIEW_FONT_WIDTH_STRETCH})`,
            transformOrigin: stretchOrigin(cssTextAlign(attrs.textAlign)),
          }}
        >
          {boxText(resolved)}
        </span>
      ) : null}
      {node.tag === "Component" ? (
        // F6b: a <Component> mounts its src child (or a placeholder) IN PLACE of
        // ordinary children. The child is mounted in a FRESH root scope built from
        // this element's pre-resolved overrides (F6a) — never the parent's scope.
        // As a GRID CELL, the grid item FULLY REPLACES that root (data=/overrides are
        // ignored — locked decision): `componentRootOverride` carries the item.
        <ComponentMount
          node={node}
          parentScope={scope}
          palette={palette}
          ancestry={ancestry}
          rootOverride={componentRootOverride}
        />
      ) : (
        renderChildren(node.children, selectedNodeId, scope, palette, boxKey, zOrder, ancestry)
      )}
    </div>
  );
});

/**
 * The shared placeholder a `<Component>` renders when its `src` cannot be mounted
 * (F6b). ONE component, parameterized by `reason`:
 *
 *   - `missing`   — the `src` is blank or does not resolve to a registered file
 *                   (deleted / renamed / never created).
 *   - `recursive` — the cycle guard tripped: this `src` is already on the mount
 *                   path (A→B→A), so mounting it would loop.
 *
 * It fills the `<Component>` box (the box already carries the instance's own
 * position/size, per design (3)) with a dashed error-styled panel naming the
 * reason and the `src`, so layout never collapses and the author sees exactly what
 * is wrong — never a silent blank, never a crash.
 */
function ComponentPlaceholder({ reason, src }: { reason: PlaceholderReason; src: string }) {
  return (
    <div
      {...{ [PLACEHOLDER_ATTR]: reason }}
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-[2px] border border-red-400/70 border-dashed bg-red-500/10 px-1 text-[11px] text-red-300 leading-tight"
    >
      <span className="truncate">
        {reason}: {src || "(no src)"}
      </span>
    </div>
  );
}

type ComponentMountProps = {
  node: GuiNode;
  parentScope: ResolveScope;
  palette: Palette;
  ancestry: ReadonlySet<string>;
  /**
   * GRID CELL only: the grid item to seat as the mounted child's FULL fresh root,
   * bypassing `data=`/override resolution (locked decision). `undefined` → ordinary
   * mount (F6a child-root from data=/overrides). A present `{ item }` (even a `null`
   * item) makes the child resolve against `viewScope(item)` (the item is the child
   * View's own model, so its `{$.x}` bindings read it).
   */
  rootOverride?: { item: unknown };
};

/**
 * Mount a `<Component>`'s `src` child (F6b). This is the one place the async child
 * fetch enters the render — it is a component (not a helper) because it calls the
 * {@link useComponent} hook; the fetched+parsed child trees are module-cached so a
 * keystroke in the Data Model panel does not refetch.
 *
 * The decision pipeline:
 *   1. {@link mountDecision} (pure) settles the no-I/O cases against the ancestry
 *      set: a blank `src` → `missing` placeholder; a `src` already on the mount
 *      path → `recursive` placeholder. Otherwise it yields the basename to fetch
 *      plus the ancestry to carry INTO the child (parent set ∪ this basename).
 *   2. {@link useComponent} fetches+parses the child. While loading, render nothing
 *      (no placeholder flash). On `missing` (absent / broken / unparseable) render
 *      the shared placeholder. On `ok`, mount the child subtree.
 *   3. The child mounts in a FRESH View scope built from the parent-pre-resolved
 *      `data=`/overrides (F6a): `viewScope(resolveChildRoot(...))`. The parent scope
 *      does NOT cross the boundary — the child sees ONLY its props.
 *
 * The mounted child gets its OWN z-order map (its boxes' `layer`s order them among
 * THEIR siblings within this component box's stacking context). This composes
 * cleanly with the nested model: the `<Component>` box already carries its own
 * sibling-rank z-index in the parent doc, so the whole mounted subtree is lifted
 * with it as a group; cross-file z-order across the mount boundary is out of scope.
 */
function ComponentMount({
  node,
  parentScope,
  palette,
  ancestry,
  rootOverride,
}: ComponentMountProps) {
  // Pure decision first: blank src / cycle are settled with no fetch.
  const decision = mountDecision(node, ancestry);
  // Hooks must run unconditionally, so always call the cache hook — but pass `null`
  // when the pure step already decided not to fetch (placeholder), which short-
  // circuits the hook to `missing` without an invoke.
  const basename = decision.kind === "mount" ? decision.basename : null;
  const entry: ComponentEntry = useComponent(basename);
  const rawSrc = node.attrs.src ?? "";

  // Build the child's FRESH ROOT scope. Normally that root is the `data=` base object
  // (if any) with explicit overrides layered on top, all pre-resolved in the parent
  // scope. As a GRID CELL, the grid item REPLACES that root wholesale (data=/overrides
  // ignored — locked decision). Memoized so re-renders that don't change the inputs
  // (a pan/zoom, a selection, an unrelated element's edit) don't rebuild it — and,
  // crucially, keep `childRoot` referentially stable so the z-order memo below holds.
  const childRoot = useMemo(
    () => (rootOverride ? rootOverride.item : resolveChildRoot(node, parentScope)),
    [rootOverride, node, parentScope],
  );
  // A null grid item (an empty cell) uses emptyItemScope() so the mounted child's
  // {token}s resolve to "" with no waiting affordance — matching the non-Component
  // cell path (caveat 5). viewScope(null) would MISS every token and paint the
  // amber waiting state. Everything else seats the item as the child's fresh View
  // frame, so the child's own `{$.x}` bindings read it.
  const childScope = useMemo(
    () => (rootOverride && rootOverride.item === null ? emptyItemScope() : viewScope(childRoot)),
    [rootOverride, childRoot],
  );
  // The child mounts as its own little stage: its boxes are positioned/ordered within
  // THIS <Component> box. A nested z-order map ranks the child's own boxes among their
  // siblings. Memoized on the child tree + root: this full tree walk + sort ran once
  // PER MOUNTED COMPONENT on EVERY preview re-render before — the dominant cost when a
  // screen nests many components. It only changes when the child file or its data does.
  const entryRoot = entry.status === "ok" ? entry.root : null;
  const childZOrder = useMemo(
    () => (entryRoot ? computeZOrder(entryRoot, childRoot) : EMPTY_ZORDER),
    [entryRoot, childRoot],
  );
  // The cycle-guard ancestor set carried INTO the child (parent set ∪ this basename).
  // Memoized so it stays referentially stable across re-renders — it is the child
  // boxes' `ancestry` prop, and a fresh Set each render would defeat their memo.
  const childAncestry = useMemo(
    () => (basename ? new Set(ancestry).add(basename) : ancestry),
    [ancestry, basename],
  );

  // Pure placeholder decisions (blank src, recursion) win immediately.
  if (decision.kind === "placeholder") {
    return <ComponentPlaceholder reason={decision.reason} src={rawSrc} />;
  }

  // Fetch settled to a renderable result.
  if (entry.status === "loading") return null; // in flight — no placeholder flash
  if (entry.status === "missing") {
    // Absent / broken install / unparseable — all the shared `missing:` box.
    return <ComponentPlaceholder reason="missing" src={rawSrc} />;
  }

  // ok: mount the child subtree.
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ position: "absolute", zIndex: 0 }}
    >
      {renderChildren(
        entry.root.children,
        // Selection inside a mounted child is out of F6b scope (the child's nodes
        // belong to a different file). Pass `null` so child boxes never falsely
        // read as selected against the PARENT file's selection id, and clicks fall
        // through to the nearest enclosing <Component> box (which IS in this file).
        null,
        childScope,
        palette,
        "",
        childZOrder,
        childAncestry,
      )}
    </div>
  );
}

/** The attribute naming a GridLayout's iterable collection (a whole `{token}`, e.g. `{$.creatures}`). */
const DATA_COLLECTION_ATTR = "dataCollection";

type GridLayoutExpansionProps = {
  /** The `<GridLayout>` node — its single child is the cell TEMPLATE. */
  node: GuiNode;
  /**
   * The scope the grid resolves `dataCollection` against — the enclosing View frame.
   * Each cell renders against a {@link gridItemScope} composed OVER this scope, so a
   * cell's bare `{field}` reads the item while `{$.x}` still reaches this View frame.
   */
  scope: ResolveScope;
  palette: Palette;
  /** The key of the GridLayout's enclosing parent box (cells live in its content box). */
  parentKey: BoxKey;
  zOrder: ZOrderMap;
  ancestry: ReadonlySet<string>;
};

/**
 * Expand a `<GridLayout>` into its fixed rows×columns grid of cells (the renderer
 * half of the GridLayout feature). The GridLayout itself is NON-VISUAL — it draws no
 * box and is not selectable in the preview; it fills its parent and lays its single
 * template child out into a grid (design req 2/5):
 *
 *   - `rows`/`columns` parse via {@link parseGridDimension} (default 1; an explicit
 *     `0` warns and renders nothing — no slots);
 *   - `dataCollection` resolves as a whole `{token}` (e.g. `{$.creatures}`) against
 *     the enclosing View scope;
 *   - {@link stampGrid} produces EXACTLY rows×columns descriptors (excess collection
 *     entries dropped; missing → `null` item);
 *   - each cell renders the template node with geometry from {@link cellGeometry}
 *     (the template's OWN position/size are ignored), against a {@link gridItemScope}
 *     composing the cell's item OVER the View frame — so bare `{field}` reads the item
 *     and `{$.x}` still reaches the model (a `null` item → empty scope, so every
 *     `{token}` resolves to "");
 *   - cells carry NO `data-node-id` and live under a `pointer-events-none` wrapper, so
 *     a click/drag falls through to the GridLayout's parent box (cells are never
 *     individually selectable — locked decision Q4);
 *   - a `<Component>` template uses the item as its FULL data root (data=/overrides
 *     ignored — locked decision Q3).
 *
 * The wrapper is `inset-0` (fills the parent content box) so the cells' relative
 * geometry resolves against the parent box, exactly as if the grid occupied it.
 */
const GridLayoutExpansion = memo(function GridLayoutExpansion({
  node,
  scope,
  palette,
  parentKey,
  zOrder,
  ancestry,
}: GridLayoutExpansionProps) {
  // The template is the GridLayout's single child (parse guarantees ≤ 1, of a
  // Panel/Text/Component tag). A grid with no child yet (mid-authoring) renders nothing.
  const template = node.children[0];

  const rowsDim = parseGridDimension(node.attrs.rows);
  const colsDim = parseGridDimension(node.attrs.columns);

  // An explicit `0` rows/columns: warn once and render no slots (locked decision).
  if (rowsDim.kind === "empty" || colsDim.kind === "empty") {
    console.warn(
      `<GridLayout> has ${rowsDim.kind === "empty" ? "rows" : "columns"}="0" — rendering no cells.`,
    );
    return null;
  }
  if (template === undefined) return null;

  const rows = rowsDim.value;
  const columns = colsDim.value;
  const gutter = parseGutter(node.attrs.gutter);

  // `dataCollection` is a whole `{token}` (e.g. `{$.creatures}`) — resolve it as a
  // bound value in the enclosing View scope (mirrors the `data=` resolution for
  // nested components). A miss / non-array value yields all-`null` cells (the grid
  // still draws its template chrome).
  const collection = resolveWholeTokenValue(node.attrs[DATA_COLLECTION_ATTR] ?? "", scope);

  // Cell size is the grid's `cellSize` — a LITERAL full UDim2 `"relX,relY,absX,absY"`
  // read RAW (grid structure is stamped at load and cannot bind; a `{token}` here is an
  // ERROR lint, and its fields fall back to 0 via parseUDim2 downstream). Absent/blank →
  // the engine's default `1,1,0,0` (each cell fills the parent box); the runtime does NOT
  // area-divide the parent (engine ground truth — see design/gridlayout_cell_geometry.md).
  const cellSizeAttr = node.attrs.cellSize;
  const cellSize =
    cellSizeAttr !== undefined && cellSizeAttr.trim() !== "" ? cellSizeAttr : DEFAULT_CELL_SIZE;

  const stamps = stampGrid(collection, rows, columns);
  const isComponentTemplate = template.tag === "Component";

  return (
    // The grid fills the parent's content box (inset-0) so cell relative geometry
    // resolves against the parent. `pointer-events-none` makes every cell click/drag
    // fall through to the parent box — cells are not individually selectable.
    <div className="pointer-events-none absolute inset-0">
      {stamps.map((stamp) => {
        const geometry = cellGeometryFixed(stamp.index, columns, cellSize, gutter.x, gutter.y);
        // Each cell binds the item as a composite scope OVER the View frame, so a
        // bare `{field}` reads the item while `{$.x}` still reaches the model. A
        // `null` item (an empty cell) uses emptyItemScope() so every {token} resolves
        // to "" with resolved: true — the template chrome renders literally with NO
        // waiting affordance (caveat 5). gridItemScope(null, …) would instead MISS a
        // bare token and paint the amber waiting state, which an empty cell must not show.
        const cellScope = stamp.item === null ? emptyItemScope() : gridItemScope(stamp.item, scope);
        return (
          <GuiBox
            // Distinct per-cell React key (the template node id repeats across cells).
            key={`${template.nodeId}#${stamp.index}`}
            node={template}
            // Cells are never selectable: pass null so the template node never reads as
            // selected, mirroring the mounted-<Component> child handling.
            selectedNodeId={null}
            scope={cellScope}
            palette={palette}
            // A synthetic per-cell key keeps descent stable; cells aren't in the
            // zOrder map (the grid subtree isn't flattened), so they paint in DOM order.
            boxKey={makeBoxKey(parentKey, `${template.nodeId}#${stamp.index}`)}
            zOrder={zOrder}
            ancestry={ancestry}
            geometryOverride={{ position: geometry.position, size: geometry.size }}
            componentRootOverride={isComponentTemplate ? { item: stamp.item } : undefined}
            suppressNodeId
          />
        );
      })}
    </div>
  );
});

/** The tooltip overlay's z-index — above every ranked box (whose z-indices are small). */
const TOOLTIP_Z = 2_147_483_000;

type TooltipCardProps = {
  /** The tooltip component ref (`tooltip=` value, e.g. `gui.card.xml`). */
  src: string;
  /** The provider's scope-resolved `tooltipData` — the card's fresh root model. */
  data: unknown;
  /** The provider's rect in stage-logical coords — the card's render frame verbatim. */
  anchor: StageRect;
  palette: Palette;
};

/**
 * The tooltip card overlay (tasks 515/516). Rendered INSIDE the stage's coordinate
 * space (so it scales with zoom like the runtime card will), `pointer-events-none` (so
 * it can never steal hover from its provider — structurally no flicker loop), and above
 * everything (a large z-index in the stage's root stacking context).
 *
 * ANCHORING (task 516, engine ground truth — worlds-cpp GUILoader.cpp:370): the engine
 * parents the loaded tooltip subtree to the PROVIDER element, so the tooltip's geometry
 * resolves against the HOVERED ELEMENT'S RECT and its placement is authored entirely by
 * the tooltip component. So the overlay's frame is the provider's stage rect VERBATIM
 * (its `x`/`y`/`width`/`height`), and the mounted tooltip tree renders inside it exactly
 * as if it were the provider's own box — a child at `position="1,1,0,0"` lands at the
 * provider's bottom-right corner. There is NO editor-side placement (no gap / flip /
 * clamp / default card size); the design-doc stage-7 placement policy is FUTURE engine
 * work, deliberately not simulated (the old `placeTooltip`/`tooltipSizeFromRoot` helpers
 * were removed with it).
 *
 * It resolves `src` through the SAME {@link useComponent} cache and renders the
 * component tree via the SAME child-render path a nested `<Component>` uses
 * ({@link renderChildren}), seated in a fresh View frame from the resolved `data`
 * (a `null` datum → {@link emptyItemScope}, matching the empty-grid-cell rule). A
 * missing/blank ref reuses the shared {@link ComponentPlaceholder}.
 */
function TooltipCard({ src, data, anchor, palette }: TooltipCardProps) {
  const basename = srcBasename(src);
  const entry = useComponent(basename || null);
  const root = entry.status === "ok" ? entry.root : null;
  // The card's fresh root model: the resolved data seated as a View frame. A `null`
  // datum uses emptyItemScope so tokens collapse to "" (no waiting flash), mirroring
  // the empty-grid-cell path (caveat 5).
  const scope = useMemo(() => (data === null ? emptyItemScope() : viewScope(data)), [data]);
  // The card's own nested z-order map (its boxes ranked among their siblings).
  const zOrder = useMemo(() => (root ? computeZOrder(root, data) : EMPTY_ZORDER), [root, data]);
  // Seed the cycle guard with the card's own basename so a self-including <Component>
  // inside the card is caught as recursive.
  const ancestry = useMemo<ReadonlySet<string>>(
    () => (basename ? new Set([basename]) : EMPTY_ANCESTRY),
    [basename],
  );

  // In flight — render nothing (no placeholder flash), same posture as ComponentMount.
  if (entry.status === "loading") return null;

  // The overlay frame IS the provider's stage rect (position AND size) — the tooltip
  // subtree renders inside it exactly as if it were the provider's own box.
  const wrapperStyle: CSSProperties = {
    position: "absolute",
    left: `${anchor.x}px`,
    top: `${anchor.y}px`,
    width: `${anchor.width}px`,
    height: `${anchor.height}px`,
    pointerEvents: "none",
    zIndex: TOOLTIP_Z,
  };

  // Blank/unresolvable ref → the shared missing placeholder, at the card's box.
  if (basename === "" || entry.status !== "ok") {
    return (
      <div style={wrapperStyle}>
        <ComponentPlaceholder reason="missing" src={src} />
      </div>
    );
  }

  // ok: mount the tooltip tree. The inner wrapper is inset-0 so the card's child boxes
  // position against the card box (exactly the ComponentMount child-mount shape).
  return (
    <div style={wrapperStyle}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ position: "absolute", zIndex: 0 }}
      >
        {renderChildren(entry.root.children, null, scope, palette, "", zOrder, ancestry)}
      </div>
    </div>
  );
}

export type GuiPreviewProps = {
  /** The parsed component tree to render. Its root is expected to be `<View>`. */
  root: GuiNode;
  /** The single selection state, shared across tree/properties/preview. */
  selectedNodeId: string | null;
  /**
   * Called with the nearest node id when a box is clicked, or `null` when the
   * click lands on the stage background (clearing the selection).
   */
  onSelect: (nodeId: string | null) => void;
  /**
   * The data model `{token}` bindings resolve against (the Data Model panel's
   * parsed JSON). Resolution is against this single flat model. Defaults to an
   * empty model — then every `{token}` renders styled-but-literal.
   */
  model?: unknown;
  /**
   * The resolved `name → "r,g,b,a"` palette map color props resolve against.
   * Defaults to empty — then palette-named colors render styled-but-literal.
   */
  palette?: Palette;
  /**
   * F7 drag-to-move: called at the START of a drag on a box (475: any box, which is
   * selected in the same gesture — no pre-select needed), with the box's `nodeId`.
   * The host captures the node's current `position` here so each subsequent
   * {@link onDragMove} can be applied to that fixed base (avoiding per-move
   * accumulation drift). Omit to disable dragging (then the preview is select-only).
   */
  onDragStart?: (nodeId: string) => void;
  /**
   * F7 drag-to-move: called on each pointer move during a drag with the box's
   * `nodeId` and the CUMULATIVE LOGICAL-pixel delta from the drag's start
   * (`totalDx`/`totalDy`). The host applies it to the position captured at
   * {@link onDragStart} via `applyDragDelta` and writes it back, so the offset
   * tracks the cursor live. Logical-pixel = screen-pixel ÷ scale; this component
   * owns that division (it knows the stage's render scale), so the host receives a
   * delta already in 1280×768 logical space.
   */
  onDragMove?: (nodeId: string, totalDx: number, totalDy: number) => void;
  /**
   * The view transform applied to the root stage (473): an absolute `scale` plus a
   * screen-pixel `panX`/`panY`. Defaults to native 100% at the origin. It does TWO
   * things:
   * it's applied as `translate(panX, panY) scale(scale)` on the root stage ONLY
   * (never on an intermediate box — a transform there would warp the child geometry
   * and break the drag-delta math), and
   * its `scale` converts the drag's screen-pixel delta into logical-pixel delta
   * (÷ scale) so dragging stays accurate when the stage is zoomed. Pan is a pure
   * translate, so it does NOT affect the drag delta conversion — element drag stays
   * accurate when zoomed AND panned.
   */
  view?: ViewTransform;
  /**
   * Disambiguates pan from element-drag (473): consulted on the stage's
   * pointerdown — when it returns `true` the gesture is a VIEW PAN (space+left or
   * middle-mouse, owned by the host's viewport handler), so the stage does NOT start
   * an element drag or change selection and lets the pan run. Pointer events bubble
   * child→parent, so the stage (child) sees the pointerdown before the viewport
   * (parent); this predicate is how the stage yields the gesture to the pan. Omit to
   * never treat a stage pointerdown as a pan (ordinary select/element-drag only).
   */
  isPanGesture?: (event: React.PointerEvent<HTMLDivElement>) => boolean;
  /**
   * Element-lock predicate (task: element lock): returns `true` for a `nodeId` the
   * user has locked. A locked box is CLICK-THROUGH in the preview — it can't be
   * selected or dragged; a press/click over it resolves to the nearest UNLOCKED box
   * BEHIND it instead (an overlapping sibling, or the enclosing parent), or clears
   * the selection when only the stage sits behind. Unlock from the structure tree to
   * make it directly selectable again. Omit to treat every box as unlocked.
   */
  isLocked?: (nodeId: string) => boolean;
  /**
   * Whether a view gesture (pan) is in flight (473 perf): while true the stage is
   * promoted to its OWN compositor layer (`will-change: transform`) so a pan moves a
   * cached layer instead of REPAINTING the whole box subtree (every nested box +
   * background-image texture) on every frame — the dominant cost when a screen nests
   * many components. Gated to the gesture (not always-on) because a promoted layer is
   * raster-scaled, which would soften zoomed/idle content; a pan only TRANSLATES (no
   * scale change), so promoting during it costs no sharpness. Omit → never promoted.
   */
  interacting?: boolean;
};

/**
 * Resolve a click at viewport coordinates to the nearest SELECTABLE box's node id,
 * treating LOCKED boxes as CLICK-THROUGH: walk the hit-stack from the topmost
 * element down and return the first box whose node isn't locked, so a press over a
 * locked element acts on whatever sits behind it — an overlapping sibling, or the
 * enclosing parent box. Returns `null` for the empty stage background (which clears
 * the selection).
 *
 * This is the click-through generalization of `event.target.closest('[data-node-id]')`:
 * a plain `closest` only ever sees the topmost box and so a locked box would block
 * everything beneath it. `elementsFromPoint` already omits `pointer-events:none`
 * layers (the grid-cell / component-mount wrappers), so their fall-through to the
 * enclosing real box is preserved unchanged.
 */
function nodeIdAtPoint(
  clientX: number,
  clientY: number,
  isLocked?: (nodeId: string) => boolean,
): string | null {
  if (typeof document === "undefined") return null;
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = el.closest(`[${NODE_ID_ATTR}]`)?.getAttribute(NODE_ID_ATTR);
    if (!id) continue;
    if (isLocked?.(id)) continue; // locked → see through to whatever is behind it
    return id;
  }
  return null;
}

/**
 * The fixed-resolution preview stage. The `<View>` root is the stage itself
 * (1280×768, `position: relative`); its visual children render as nested
 * absolutely-positioned boxes. A click is resolved to the nearest UNLOCKED box via
 * {@link nodeIdAtPoint} (locked boxes are click-through) — the one piece that needs
 * a browser — and the resulting node id is handed to `onSelect`.
 *
 * A {@link ResolveScope} for the `<View>` frame is built from `model` once (see
 * {@link viewScope}) and threaded down to every box; each box resolves its `{$.x}`
 * bindings against that model. A GridLayout child layers a {@link gridItemScope}
 * over it (bare `{field}` → item); a mounted `<Component>` builds its own fresh View
 * scope from its `data=`/overrides at the boundary.
 */
export function GuiPreview({
  root,
  selectedNodeId,
  onSelect,
  model,
  palette = {},
  onDragStart,
  onDragMove,
  view = IDENTITY_VIEW,
  isPanGesture,
  isLocked,
  interacting = false,
}: GuiPreviewProps) {
  const { scale, panX, panY } = view;
  // Tooltip simulation (task 515). The per-preview provider registry is ref-owned so a
  // box registering/unregistering never re-renders; it is handed to every box via
  // context. Created lazily once (a fresh registry per preview instance).
  const registryRef = useRef<TooltipRegistry | null>(null);
  if (registryRef.current === null) registryRef.current = createTooltipRegistry();
  const registry = registryRef.current;
  // The stage element, for converting a provider's screen rect into stage-logical space.
  const stageRef = useRef<HTMLDivElement>(null);
  // The tooltip currently shown (anchor in stage-logical coords), or null. This is the
  // ONLY state a hover flips — `content` is memoized separately, so showing/hiding a
  // tooltip never re-renders the box tree.
  const [tooltip, setTooltip] = useState<{ src: string; data: unknown; anchor: StageRect } | null>(
    null,
  );
  // The provider key currently shown — used to skip redundant setState while the pointer
  // moves within the SAME provider (the anchor is provider-bounds, not cursor, so it's
  // stable). A ref so comparing it doesn't itself re-render.
  const hoverKeyRef = useRef<string | null>(null);
  // Task 519 — Alt-to-peek. The last pointer position in SCREEN (client) coords, stored on
  // every stage pointermove, so an Alt keydown can re-evaluate the hover from where the
  // cursor already rests (no mouse jiggle needed). Null until the pointer first enters.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // Whether Alt/Option is currently held. Tracked from BOTH entry points — `e.altKey` on
  // every pointermove (self-correcting) and the window Alt keydown/keyup listeners — and
  // reset on blur/visibility loss so an Alt+Tab away can't wedge the peek on.
  const altHeldRef = useRef(false);
  // A single View-frame scope for the whole tree: every box resolves its `{$.x}`
  // bindings against this one model object. Memoized on `model` so a pan/zoom/selection
  // re-render (which leaves the model untouched) reuses the same scope object —
  // keeping it referentially stable so the content memo below can rely on it.
  const scope = useMemo(() => viewScope(model), [model]);
  // Nested z-order: compute the `boxKey → z-index` map (each box ranked among its
  // siblings by resolved `layer`, ties → document order) up front, then hand it
  // down so each box can apply its rank. The flatten mirrors this render's tree, so
  // the map's keys line up with the boxes rendered below. Each box's z-index orders
  // it within its parent's stacking context, so a container's layer lifts its whole
  // subtree as a group.
  //
  // Memoized on `[root, model]` (skips the walk on a pan/zoom) AND ref-stabilized:
  // a drag replaces `root` every frame but z-order depends only on STRUCTURE +
  // `layer`, not position — so the recomputed map is value-equal. Returning the
  // SAME map reference when nothing changed is what lets the memoized `GuiBox`es
  // below skip re-rendering during a drag (a changed `zOrder` prop would re-render
  // every box every frame, defeating the memo).
  const zOrderRef = useRef<ZOrderMap | null>(null);
  const zOrder = useMemo(() => {
    const next = computeZOrder(root, model);
    const prev = zOrderRef.current;
    if (prev && zOrderMapsEqual(prev, next)) return prev;
    zOrderRef.current = next;
    return next;
  }, [root, model]);
  // The rendered box tree. The view transform (zoom/pan) lives ONLY on the stage's
  // own `transform` style — none of the boxes depend on it — yet without this memo a
  // pan/zoom (a continuous, every-frame gesture) would re-render the WHOLE subtree.
  // Memoizing on the inputs the boxes actually read decouples the view gesture from
  // the tree: a pan/zoom reuses these elements and only restyles the stage div. The
  // tree still re-renders when it genuinely changes (an edit replaces `root`, a
  // selection flips `selectedNodeId`, the model/palette change).
  const content = useMemo(
    () => renderChildren(root.children, selectedNodeId, scope, palette, "", zOrder, EMPTY_ANCESTRY),
    [root.children, selectedNodeId, scope, palette, zOrder],
  );
  // The DOM half of the back-reference: walk outward from the click target to
  // the nearest box carrying a node id. `closest` matches the target itself
  // first, then ancestors — exactly the "nearest enclosing box" rule. Reading
  // the chain through `nearestNodeId` keeps the (pure, tested) semantics in one
  // place; here it receives at most one candidate.
  // Set on pointerdown whenever a box press arms the gesture (477); consumed (and
  // reset) by the very next `click`, so exactly one click is suppressed per box
  // press and ordinary background clicks are untouched. A ref, not state — it must
  // not trigger a re-render.
  const suppressNextClick = useRef(false);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Swallow the click synthesized after a box press: the box stays selected
    // (selection already happened on pointerdown). See `handlePointerDown` (477).
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    // Resolve through any LOCKED boxes to the nearest selectable box behind them
    // (locked = click-through), or `null` on the empty stage (clears selection).
    onSelect(nodeIdAtPoint(event.clientX, event.clientY, isLocked));
  };

  // F7 drag-to-move (475): a drag begins on POINTERDOWN over ANY box — pressing on a
  // box selects it AND arms a drag in the SAME gesture, so there is no separate
  // click-to-select step. A plain click (no move past threshold) is just the select
  // that already happened on pointerdown; a drag (moved) repositions the box live as
  // the cursor moves. Either way the trailing `click` is suppressed (477 — see
  // `handlePointerDown`), so it never re-runs selection. The active drag's identity + screen origin
  // live in a ref (not state) so a move doesn't re-render the preview from the pointer
  // handler — the only render is the store writeback the host performs from `onDragMove`.
  const drag = useRef<{ nodeId: string; startX: number; startY: number } | null>(null);

  // Tooltip hover controller (task 515). Hide the shown card (if any) and forget the
  // shown provider. A no-op setState guard keeps this cheap to call on every move.
  const clearTooltip = () => {
    if (hoverKeyRef.current !== null) {
      hoverKeyRef.current = null;
      setTooltip(null);
    }
  };

  // The Alt-to-peek hover evaluator (task 519). ONE function drives both entry points —
  // a stage pointermove AND a window Alt keydown/keyup (which re-evaluates from the last
  // stored pointer, so pressing Alt while already resting on a provider shows the card
  // with no mouse jiggle). It rect-tests the pointer (SCREEN coords — getBoundingClientRect
  // is screen-space, so zoom/pan is free) against the registered providers, gating the
  // result on `altHeld` via the pure {@link pickHoverTarget}: no Alt → no target → hide.
  // Suppressed while an element drag is active. The anchor is the hit provider's rect
  // converted ONCE into stage-logical space, so the pure placement helper works in a
  // single coordinate space.
  const evaluateTooltip = (pointer: { x: number; y: number } | null, altHeld: boolean) => {
    if (drag.current) {
      clearTooltip();
      return;
    }
    const hit = pickHoverTarget(registry.snapshot(), pointer, altHeld);
    if (!hit) {
      clearTooltip();
      return;
    }
    if (hit.key === hoverKeyRef.current) return; // same provider — stable anchor
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const anchor = screenRectToStageRect(hit.rect, stageEl.getBoundingClientRect(), scale);
    hoverKeyRef.current = hit.key;
    setTooltip({ src: hit.src, data: hit.data, anchor });
  };
  // The window Alt listeners are subscribed ONCE (mount), but `evaluateTooltip` closes over
  // the live `scale`. Route them through a ref to the latest evaluator so an Alt press
  // always uses current view state without re-subscribing the listeners on every zoom.
  const evaluateRef = useRef(evaluateTooltip);
  evaluateRef.current = evaluateTooltip;

  // Task 519 — window-level Alt peek + robustness. Alt keydown/keyup re-evaluate the hover
  // from the last stored pointer (peek appears/disappears without moving the mouse), and
  // blur/visibilitychange force the held state off so an Alt+Tab (or Cmd-Tab with Option
  // down) can never leave the tooltip wedged on while the cursor sits idle. Mount-once:
  // the handlers read refs + the evaluator ref, so no dependency churn.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Only the Alt transition matters; ignore auto-repeat and other keys held with Alt.
      if (e.altKey && !altHeldRef.current) {
        altHeldRef.current = true;
        evaluateRef.current(lastPointerRef.current, true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // The Alt keyup reports `altKey === false`; a non-Alt keyup while Alt is still down
      // keeps it true and is ignored, so the peek only drops when Alt itself releases.
      if (!e.altKey && altHeldRef.current) {
        altHeldRef.current = false;
        evaluateRef.current(lastPointerRef.current, false);
      }
    };
    const clearHeld = () => {
      altHeldRef.current = false;
      evaluateRef.current(lastPointerRef.current, false);
    };
    const onVisibility = () => {
      if (document.hidden) clearHeld();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearHeld);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearHeld);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Any press hides a shown tooltip (engine parity: press dismisses the card).
    clearTooltip();
    // View-pan gesture (space+left / middle-mouse): the host's viewport handler owns
    // it. Yield — don't start an element drag, don't change selection. For a
    // PRIMARY-button pan (space+left) the browser will synthesize a trailing `click`,
    // so suppress it (one click) to keep the box selected; a MIDDLE-button pan emits
    // no `click` (only `auxclick`), so we must NOT arm the flag or it would swallow
    // the next legitimate left-click.
    if (isPanGesture?.(event)) {
      if (event.button === 0) suppressNextClick.current = true;
      return;
    }
    // Dragging is opt-in (host supplies the writeback) and primary-button only.
    if (!onDragMove || event.button !== 0) return;
    // Resolve through LOCKED boxes to the nearest unlocked box behind them (locked =
    // click-through): a press over a locked element acts on whatever sits behind it,
    // never on the locked box itself — so it can't be selected or dragged. A press on
    // the empty stage resolves to `null` and arms nothing (the trailing click clears).
    const id = nodeIdAtPoint(event.clientX, event.clientY, isLocked);
    // 475: pressing on ANY box selects it AND arms a drag in the same gesture — no
    // prior click-to-select. The pure decision settles both: a press on empty stage
    // background (id === null) does NOT arm (the trailing `click` clears selection);
    // a press on a box arms the drag, selecting it first unless it is already selected
    // (an up-front select so the box reads as selected for the whole gesture; a plain
    // click then re-selects as a no-op, a drag moves the now-selected box).
    const decision = dragStartDecision(id, selectedNodeId);
    if (!decision.arm || id === null) return;
    if (decision.select) onSelect(id);
    drag.current = { nodeId: id, startX: event.clientX, startY: event.clientY };
    // Capture so moves/up are delivered here even if the cursor leaves the box.
    event.currentTarget.setPointerCapture(event.pointerId);
    // 477: selection already happened above (on pointerdown), so the trailing
    // synthesized `click` is redundant for a box press — and worse, pointer
    // capture retargets it to the (id-less) stage, where `handleClick` would
    // read no `data-node-id` and call `onSelect(null)`, deselecting on a plain
    // click. Suppress it unconditionally for any box press (plain click OR drag).
    // The BACKGROUND-press path returns early above (no arm, no capture), so a
    // genuine click on empty stage still falls through to `handleClick` and
    // clears selection.
    suppressNextClick.current = true;
    onDragStart?.(id);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // Tooltip peek runs on every stage move (grid cells are pointer-events-none, so their
    // moves bubble here). Store the pointer so a later Alt keydown can re-evaluate from
    // here, sync the held state from `e.altKey` (self-correcting after any missed keyup),
    // and gate the peek on it. It self-suppresses while a drag is active.
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    altHeldRef.current = event.altKey;
    evaluateTooltip(lastPointerRef.current, event.altKey);
    const active = drag.current;
    if (!active || !onDragMove) return;
    // Screen-pixel delta ÷ scale = logical-pixel delta. The stage is rendered with
    // `transform: scale(scale)`, so a cursor move of N screen px corresponds to
    // N / scale px in the 1280×768 logical space the offset is written in. The pure
    // `screenDeltaToLogical` does the division (and guards a degenerate scale), so
    // the drag tracks the cursor exactly at any zoom — no trig, no layout solver.
    const { dx, dy } = screenDeltaToLogical(
      event.clientX - active.startX,
      event.clientY - active.startY,
      scale,
    );
    onDragMove(active.nodeId, dx, dy);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // 477: the trailing synthesized `click` for any box press is already
    // suppressed in `handlePointerDown` (selection happened on pointerdown and
    // capture retargets the click to the stage). No drag-vs-click distinction is
    // needed here — both plain click and drag keep the box selected via the
    // single pointerdown-arm suppression. (Background presses don't arm and so
    // aren't suppressed, leaving the clear-on-empty-stage click intact.)
  };

  return (
    // The registry context reaches every box below (incl. pointer-events-none grid
    // cells and mounted <Component> children) so they can register as tooltip providers.
    <TooltipRegistryProvider value={registry}>
      {/* The stage is the preview canvas: selection is by click (and later
        drag/F7). Keyboard-driven selection is the tree panel's job (F9), so the
        canvas intentionally has no key handler and is not a button/role. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: preview canvas selected by click; keyboard selection lives in the tree panel (F9) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: preview canvas selected by click; keyboard selection lives in the tree panel (F9) */}
      <div
        ref={stageRef}
        data-gui-stage=""
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={clearTooltip}
        className="relative overflow-visible text-[#b9b2a5]"
        style={{
          position: "relative",
          width: `${STAGE_WIDTH}px`,
          height: `${STAGE_HEIGHT}px`,
          // Solid stage (479). The 1280×768 stage is a flat, opaque artboard color —
          // the blueprint graph-paper grid now lives BEHIND the stage, on the clipping
          // viewport (see GuiPreviewHost), so the solid stage reads as an artboard
          // sitting on a blueprint canvas. Rendered GUI boxes sit on top of this flat
          // fill and stay legible. (Task 478 painted the grid ON the stage; 479 flips
          // it back to a solid fill and moves the grid to the viewport backdrop.)
          backgroundColor: "#1b1b1f",
          // View transform (473): a single `translate(panX, panY) scale(scale)` on the
          // ROOT stage renders the 1280×768 logical canvas at the user's zoom and pan.
          // The transform belongs ONLY on the stage — a transform on an intermediate
          // box would warp that box's child geometry and break the drag-delta math.
          // `top left` origin makes the pan (in viewport screen px) place the stage's
          // top-left exactly at (panX, panY) within the clipping viewport — fit-and-
          // center bakes the centering into pan.
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          transformOrigin: "top left",
          // PERF: while a pan gesture is in flight, promote the stage to its own
          // compositor layer so each frame just re-composites a cached bitmap rather
          // than REPAINTING the entire nested box tree (every box + texture). Dropped
          // when idle so static/zoomed content rasterizes sharp (a pan never scales, so
          // the promotion costs no sharpness during the gesture). See `interacting`.
          willChange: interacting ? "transform" : undefined,
          // The stage forms the root stacking context for the whole tree (`position:
          // relative` + a numeric `z-index`). Its direct children are ranked among
          // themselves by `layer` within it; each of those children in turn forms its
          // own context for its subtree (the nested z-order model).
          zIndex: 0,
        }}
      >
        {content}
        {/* The tooltip overlay: inside the stage transform (scales with zoom),
          pointer-events-none, on top. Only renders while a provider is hovered. */}
        {tooltip ? (
          <TooltipCard
            src={tooltip.src}
            data={tooltip.data}
            anchor={tooltip.anchor}
            palette={palette}
          />
        ) : null}
      </div>
    </TooltipRegistryProvider>
  );
}

/** The empty `<Component>`-`src` ancestor set at the stage root (no mounts above). */
const EMPTY_ANCESTRY: ReadonlySet<string> = new Set();

/** A shared empty z-order map for a not-yet-mounted child (stable identity for memo deps). */
const EMPTY_ZORDER: ZOrderMap = new Map();

/**
 * Value-equality for two z-order maps (same keys → same ranks). Used to keep the
 * `zOrder` reference STABLE across a drag: position changes replace `root` and force
 * a recompute, but the resulting ranks are identical, so returning the prior map
 * lets the memoized boxes skip re-rendering. Cheap: one size check + one pass.
 */
function zOrderMapsEqual(a: ZOrderMap, b: ZOrderMap): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/** The default view transform: native 100% at the origin (no zoom, no pan). */
const IDENTITY_VIEW: ViewTransform = { scale: 1, panX: 0, panY: 0 };
