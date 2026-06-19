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

import { type CSSProperties, useRef } from "react";
import { useSprite } from "../../components/Sprite";
import {
  colorCodeToCss,
  emptyItemScope,
  flatRootScope,
  type Palette,
  type ResolvedAttrs,
  type ResolveScope,
  resolveAttrs,
} from "../../lib/guiBinding";
import { type ComponentEntry, useComponent } from "../../lib/guiComponentCache";
import {
  mountDecision,
  type PlaceholderReason,
  resolveChildRoot,
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
import { cellGeometry, parseGridDimension, parseGutter } from "../../lib/guiGridGeometry";
import { stampGrid } from "../../lib/guiGridStamp";
import type { GuiNode } from "../../lib/guiNode";
import { isNodeSelected, NODE_ID_ATTR, nearestNodeId } from "../../lib/guiSelection";
import { type BoxKey, computeZOrder, makeBoxKey, type ZOrderMap } from "../../lib/guiZOrder";
import { cn } from "../../lib/utils";

/** The DOM attribute marking a `<Component>` mount's missing/recursive placeholder. */
export const PLACEHOLDER_ATTR = "data-gui-placeholder";

/** A box-producing element tag. `View` is the stage; `Event` is non-visual. */
function isVisualTag(tag: GuiNode["tag"]): boolean {
  return tag === "Panel" || tag === "Text" || tag === "Component";
}

/** Default text color when `textColor` is absent (design default). */
const DEFAULT_TEXT_COLOR = "185,178,165,255";

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
   * The flat scope this box renders in. Bare tokens resolve against the single
   * model object (see {@link flatRootScope}). The stage passes the root model's
   * scope; a mounted `<Component>` builds a fresh scope from its overrides.
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
function GuiBox({
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
  const textColor = isText ? colorCodeToCss(attrs.textColor ?? DEFAULT_TEXT_COLOR) : undefined;
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
    fontSize: isText && Number.isFinite(fontSize) ? `${fontSize}px` : undefined,
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
      {isText ? boxText(resolved) : null}
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
}

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
   * item) makes the child resolve against `flatRootScope(item)`.
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
 *   3. The child mounts in a FRESH scope built from the parent-pre-resolved
 *      overrides (F6a): `flatRootScope(resolveChildRoot(...))`. The parent scope
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

  // ok: mount the child subtree in a FRESH ROOT scope. Normally that root is built
  // from the `data=` base object (if any) with explicit overrides layered on top, all
  // pre-resolved in the parent scope. As a GRID CELL, the grid item REPLACES that root
  // wholesale (data=/overrides ignored — locked decision).
  const childRoot = rootOverride ? rootOverride.item : resolveChildRoot(node, parentScope);
  // A null grid item (an empty cell) uses emptyItemScope() so the mounted child's
  // {token}s resolve to "" with no waiting affordance — matching the non-Component
  // cell path (caveat 5). flatRootScope(null) would MISS every token and paint the
  // amber waiting state. Everything else resolves against the item as a flat root.
  const childScope =
    rootOverride && rootOverride.item === null ? emptyItemScope() : flatRootScope(childRoot);
  // The child mounts as its own little stage: its boxes are positioned/ordered
  // within THIS <Component> box. A nested z-order map ranks the child's own boxes
  // among their siblings, contained by this mount wrapper's stacking context.
  const childZOrder = computeZOrder(entry.root, childRoot);
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
        decision.childAncestry,
      )}
    </div>
  );
}

/** The attribute naming a GridLayout's iterable collection (a bare ROOT model key). */
const DATA_COLLECTION_ATTR = "dataCollection";

type GridLayoutExpansionProps = {
  /** The `<GridLayout>` node — its single child is the cell TEMPLATE. */
  node: GuiNode;
  /**
   * The flat scope the grid resolves `dataCollection` against. Grids cannot nest and
   * nothing else pushes scope, so this is effectively the ROOT model scope.
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
 *   - `dataCollection` resolves as a BARE ROOT KEY against the flat scope;
 *   - {@link stampGrid} produces EXACTLY rows×columns descriptors (excess collection
 *     entries dropped; missing → `null` item);
 *   - each cell renders the template node with geometry from {@link cellGeometry}
 *     (the template's OWN position/size are ignored), against a flat scope built from
 *     the cell's item (a `null` item → empty scope, so every `{token}` resolves to "");
 *   - cells carry NO `data-node-id` and live under a `pointer-events-none` wrapper, so
 *     a click/drag falls through to the GridLayout's parent box (cells are never
 *     individually selectable — locked decision Q4);
 *   - a `<Component>` template uses the item as its FULL data root (data=/overrides
 *     ignored — locked decision Q3).
 *
 * The wrapper is `inset-0` (fills the parent content box) so the cells' relative
 * geometry resolves against the parent box, exactly as if the grid occupied it.
 */
function GridLayoutExpansion({
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

  // `dataCollection` is a bare ROOT key (no `{}`) — look it up directly in the flat
  // scope (mirrors the `data=` resolution for nested components). A miss / non-array
  // value yields all-`null` cells (the grid still draws its template chrome).
  const collectionKey = (node.attrs[DATA_COLLECTION_ATTR] ?? "").trim();
  const collection = collectionKey === "" ? undefined : scope.lookup(collectionKey);

  const stamps = stampGrid(collection, rows, columns);
  const isComponentTemplate = template.tag === "Component";

  return (
    // The grid fills the parent's content box (inset-0) so cell relative geometry
    // resolves against the parent. `pointer-events-none` makes every cell click/drag
    // fall through to the parent box — cells are not individually selectable.
    <div className="pointer-events-none absolute inset-0">
      {stamps.map((stamp) => {
        const geometry = cellGeometry(stamp.index, rows, columns, gutter.x, gutter.y);
        // Each cell binds the item as a FRESH flat scope. A `null` item (an empty
        // cell) uses emptyItemScope() so every {token} resolves to "" with
        // resolved: true — the template chrome renders literally with NO waiting
        // affordance (caveat 5). flatRootScope(null) would instead MISS every token
        // and paint the amber waiting state, which an empty cell must not show.
        const cellScope = stamp.item === null ? emptyItemScope() : flatRootScope(stamp.item);
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
   * user has locked. A locked box cannot be selected OR dragged from the preview —
   * a press/click that resolves to a locked box is ignored (selection unchanged),
   * so the only way to act on it is to unlock it from the structure tree first.
   * Omit to treat every box as unlocked.
   */
  isLocked?: (nodeId: string) => boolean;
};

/**
 * The fixed-resolution preview stage. The `<View>` root is the stage itself
 * (1280×768, `position: relative`); its visual children render as nested
 * absolutely-positioned boxes. A click is resolved to the nearest box via the
 * DOM `closest('[data-node-id]')` — the one piece that needs a browser — and
 * the resulting node id is handed to `onSelect`.
 *
 * A flat {@link ResolveScope} is built from `model` once (see
 * {@link flatRootScope}) and threaded down to every box; each box resolves its
 * bare tokens against that single model. A mounted `<Component>` builds its own
 * fresh scope from its overrides at the boundary.
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
}: GuiPreviewProps) {
  const { scale, panX, panY } = view;
  // A single flat scope for the whole tree: every box resolves its bare tokens
  // against this one model object.
  const scope = flatRootScope(model);
  // Nested z-order: compute the `boxKey → z-index` map (each box ranked among its
  // siblings by resolved `layer`, ties → document order) up front, then hand it
  // down so each box can apply its rank. The flatten mirrors this render's tree, so
  // the map's keys line up with the boxes rendered below. Each box's z-index orders
  // it within its parent's stacking context, so a container's layer lifts its whole
  // subtree as a group.
  const zOrder = computeZOrder(root, model);
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
    const target = event.target as Element;
    const box = target.closest(`[${NODE_ID_ATTR}]`);
    const id = nearestNodeId([box?.getAttribute(NODE_ID_ATTR)]);
    // A click that resolves to a LOCKED box is ignored — the box can't be selected,
    // so the current selection is left untouched (only an unlock from the tree can
    // make it selectable). A background click (id === null) still clears selection.
    if (id !== null && isLocked?.(id)) return;
    onSelect(id);
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

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
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
    const target = event.target as Element;
    const box = target.closest(`[${NODE_ID_ATTR}]`);
    const id = nearestNodeId([box?.getAttribute(NODE_ID_ATTR)]);
    // A LOCKED box can't be selected or dragged: yield the gesture entirely (no
    // arm, no select, no click suppression) so it behaves as if the box were inert.
    // The trailing `click` falls through to `handleClick`, which also no-ops on a
    // locked box, leaving the existing selection intact.
    if (id !== null && isLocked?.(id)) return;
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
    // The stage is the preview canvas: selection is by click (and later
    // drag/F7). Keyboard-driven selection is the tree panel's job (F9), so the
    // canvas intentionally has no key handler and is not a button/role.
    // biome-ignore lint/a11y/noStaticElementInteractions: preview canvas selected by click; keyboard selection lives in the tree panel (F9)
    // biome-ignore lint/a11y/useKeyWithClickEvents: preview canvas selected by click; keyboard selection lives in the tree panel (F9)
    <div
      data-gui-stage=""
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
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
        // The stage forms the root stacking context for the whole tree (`position:
        // relative` + a numeric `z-index`). Its direct children are ranked among
        // themselves by `layer` within it; each of those children in turn forms its
        // own context for its subtree (the nested z-order model).
        zIndex: 0,
      }}
    >
      {renderChildren(root.children, selectedNodeId, scope, palette, "", zOrder, EMPTY_ANCESTRY)}
    </div>
  );
}

/** The empty `<Component>`-`src` ancestor set at the stage root (no mounts above). */
const EMPTY_ANCESTRY: ReadonlySet<string> = new Set();

/** The default view transform: native 100% at the origin (no zoom, no pan). */
const IDENTITY_VIEW: ViewTransform = { scale: 1, panX: 0, panY: 0 };
