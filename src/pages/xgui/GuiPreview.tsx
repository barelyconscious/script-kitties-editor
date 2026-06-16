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
 *   F4  forEach                   → expand a template node into N instances
 *                                   sharing `data-node-id` + a `data-instance-key`
 *                                   (selection already collapses to the template
 *                                   because it only reads `data-node-id`).
 *   F5b layer z-order             → a flatten pass over the same tree assigning
 *                                   each LEAF box a numeric `z-index`; wrappers
 *                                   stay `z-index: auto` (this component already
 *                                   keeps stacking-context props off wrappers).
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
 * CRITICAL layering constraint (from the F5a contract): structural wrapper
 * boxes must NOT form CSS stacking contexts — no `transform`, `opacity < 1`,
 * `filter`, `isolation`, `mix-blend-mode`, or numeric `z-index` on a box with
 * layering descendants — or cross-branch global z-order (F5b) silently breaks.
 * The selection highlight is therefore drawn with `outline` + `box-shadow`
 * (neither forms a stacking context), never `transform`/`opacity`.
 *
 * @see design/xgui_ta.md — "Preview back-reference + layer rendering model resolved"
 */

import { type CSSProperties, useRef } from "react";
import { useSprite } from "../../components/Sprite";
import {
  colorCodeToCss,
  type Palette,
  type ResolvedAttrs,
  resolveAttrs,
} from "../../lib/guiBinding";
import { type ComponentEntry, useComponent } from "../../lib/guiComponentCache";
import {
  mountDecision,
  type PlaceholderReason,
  resolveOverrides,
} from "../../lib/guiComponentMount";
import { isForEachTemplate, stampForEach } from "../../lib/guiForEach";
import {
  computeBoxGeometry,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  screenDeltaToLogical,
  textureToLoad,
} from "../../lib/guiGeometry";
import type { GuiNode } from "../../lib/guiNode";
import { ScopeStack } from "../../lib/guiScope";
import { isNodeSelected, NODE_ID_ATTR, nearestNodeId } from "../../lib/guiSelection";
import { type BoxKey, computeZOrder, makeBoxKey, type ZOrderMap } from "../../lib/guiZOrder";
import { cn } from "../../lib/utils";

/** The DOM attribute that disambiguates `forEach` instances sharing a node id. */
export const INSTANCE_KEY_ATTR = "data-instance-key";

/** The DOM attribute marking a `<Component>` mount's missing/recursive placeholder. */
export const PLACEHOLDER_ATTR = "data-gui-placeholder";

/** A box-producing element tag. `View` is the stage; `Event` is non-visual. */
function isVisualTag(tag: GuiNode["tag"]): boolean {
  return tag === "Panel" || tag === "Text" || tag === "Component";
}

/**
 * Whether a box has any child that produces a box of its own (a Panel/Text/
 * Component child, including a `forEach` template). A box with NO such children is
 * a LEAF — and only leaves receive a numeric `z-index` (F5a): a leaf has no
 * layering descendants to trap, so its own stacking context is harmless, while a
 * wrapper carrying a numeric `z-index` WOULD trap its descendants and break global
 * cross-branch paint order. Wrappers therefore stay `z-index: auto`.
 *
 * Note this is a STRUCTURAL leaf check (does the node have visual children at
 * all), independent of the data model: a `forEach` wrapper whose collection is
 * currently empty has zero rendered children but is still treated as a wrapper, so
 * it never picks up a z-index. That is correct — it has nothing to paint, so the
 * absence of a z-index is moot, and the check stays model-independent.
 */
function hasVisualChild(node: GuiNode): boolean {
  return node.children.some((child) => isVisualTag(child.tag));
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
   * The scope stack this box renders in. Bare tokens resolve against its current
   * item, `$.` against its root. The root render passes a root-only stack; each
   * `forEach` instance is rendered with the item pushed (see {@link renderChildren}).
   */
  scope: ScopeStack;
  palette: Palette;
  /**
   * This box's render-reproducible identity path (F5b), built from its parent's
   * key + its own `nodeId`(+`instanceKey`). Used to look the box's global `z-index`
   * up in {@link zOrder} and to derive each child's key.
   */
  boxKey: BoxKey;
  /**
   * The global `boxKey → z-index` map for the whole component (F5b). A LEAF box
   * applies its mapped z-index so it competes in the stage's single stacking
   * context; wrappers ignore it and stay `z-index: auto`.
   */
  zOrder: ZOrderMap;
  /**
   * The `forEach` instance key (`data-instance-key`), present only when this box
   * is one stamped instance of a template. Omitted for ordinary (once-rendered)
   * boxes. All instances of a template share `node.nodeId`, so selection still
   * collapses to the template; this only disambiguates instances in the DOM.
   */
  instanceKey?: string;
  /**
   * The set of `<Component>` `src` basenames on the mount path TO this box (F6b
   * cycle guard). Empty at the stage root; a `<Component>` mount adds its own
   * basename before descending into the child, so a re-encounter of the same src
   * deeper down is caught as `recursive` instead of looping. Plain (non-mounted)
   * descent passes the set through unchanged.
   */
  ancestry: ReadonlySet<string>;
};

/**
 * Expand a node's visual children into the boxes to render, applying `forEach`:
 * a template child is stamped into one box per item (each in its own item scope),
 * a plain child renders once in the inherited scope. Returns the `<GuiBox>`
 * elements so both the stage root and every box use the same expansion rule.
 *
 * `forEach` and the resulting per-instance scope live HERE (in the React shell),
 * driven by the pure {@link stampForEach}/{@link ScopeStack}; `GuiBox` itself
 * stays scope-agnostic beyond reading `scope.asScope()` for attribute resolution.
 */
function renderChildren(
  children: GuiNode[],
  selectedNodeId: string | null,
  scope: ScopeStack,
  palette: Palette,
  parentKey: BoxKey,
  zOrder: ZOrderMap,
  ancestry: ReadonlySet<string>,
) {
  return children
    .filter((child) => isVisualTag(child.tag))
    .flatMap((child) => {
      if (!isForEachTemplate(child)) {
        // Plain child: render once in the inherited scope.
        return [
          <GuiBox
            key={child.nodeId}
            node={child}
            selectedNodeId={selectedNodeId}
            scope={scope}
            palette={palette}
            boxKey={makeBoxKey(parentKey, child.nodeId, undefined)}
            zOrder={zOrder}
            ancestry={ancestry}
          />,
        ];
      }
      // Template child: stamp one instance per item (zero when the collection is
      // empty/unresolved — the template still exists in the editor tree, just
      // renders nothing here). Each instance renders with its item pushed.
      return stampForEach(child, scope).map((instance) => (
        <GuiBox
          key={`${child.nodeId}#${instance.instanceKey}`}
          node={instance.node}
          selectedNodeId={selectedNodeId}
          scope={instance.scope}
          palette={palette}
          boxKey={makeBoxKey(parentKey, child.nodeId, instance.instanceKey)}
          zOrder={zOrder}
          instanceKey={instance.instanceKey}
          ancestry={ancestry}
        />
      ));
    });
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
  instanceKey,
  ancestry,
}: GuiBoxProps) {
  // Resolve the whole attribute bag once against this box's scope (the item scope
  // for a forEach instance, the inherited scope otherwise): geometry, colors, and
  // text all read off the resolved values, and `unresolved` drives the
  // waiting-binding styling. The pure resolver only needs a `ResolveScope`.
  const resolved = resolveAttrs(node.attrs, scope.asScope(), palette);
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

  const geometry = computeBoxGeometry(attrs.position, attrs.size);
  const selected = isNodeSelected(node.nodeId, selectedNodeId);

  const backgroundColor = colorCodeToCss(attrs.backgroundColor);
  const borderColor = colorCodeToCss(attrs.borderColor);
  const borderSize = attrs.borderSize?.trim();
  const hasBorder = borderColor !== undefined && borderColor !== "transparent";
  const isText = node.tag === "Text";

  // F5b global z-order: only a LEAF box (no layering descendants) gets a numeric
  // z-index, drawn from the single global `(layer, doc-order)` ranking so it
  // competes directly in the stage's one stacking context. A WRAPPER (a box with
  // visual children) gets NO z-index and stays `z-index: auto` — if it carried a
  // numeric z-index it would form a stacking context and trap its descendants'
  // z-index locally, breaking cross-branch global paint order (the F5a trap).
  const isLeaf = !hasVisualChild(node);
  const zIndex = isLeaf ? zOrder.get(boxKey) : undefined;
  const textColor = isText ? colorCodeToCss(attrs.textColor ?? DEFAULT_TEXT_COLOR) : undefined;
  const fontSize = isText ? Number(attrs.fontSize) : Number.NaN;

  // Highlight via outline + box-shadow ONLY. These do not form a stacking
  // context, so a selected wrapper does not trap its descendants' z-index
  // (the F5a constraint). Never use transform/opacity/filter/isolation here.
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
    // F5b: leaf boxes only — a wrapper keeps z-index `auto` (undefined here) so it
    // never forms a stacking context that would trap its descendants.
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
      {...{ [NODE_ID_ATTR]: node.nodeId }}
      {...(instanceKey !== undefined ? { [INSTANCE_KEY_ATTR]: instanceKey } : {})}
      data-gui-tag={node.tag}
      data-gui-waiting={waiting ? "" : undefined}
      className={cn(
        "select-none",
        // A faint hairline so empty/transparent boxes are still visible and
        // clickable in the editor. Border is stacking-context-safe.
        hasBorder ? null : "border border-white/10 border-dashed",
        // Waiting-binding affordance — a dashed amber ring + slight dim. Outline
        // and opacity-via-text-color are stacking-context-safe on a leaf-ish box;
        // we avoid `opacity` on wrappers to honor the F5a layering constraint.
        waiting && "rounded-[2px] outline outline-dashed outline-1 outline-amber-400/70",
      )}
      style={style}
    >
      {isText ? boxText(resolved) : null}
      {node.tag === "Component" ? (
        // F6b: a <Component> mounts its src child (or a placeholder) IN PLACE of
        // ordinary children. The child is mounted in a FRESH root scope built from
        // this element's pre-resolved overrides (F6a) — never the parent's scope.
        <ComponentMount node={node} parentScope={scope} palette={palette} ancestry={ancestry} />
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
  parentScope: ScopeStack;
  palette: Palette;
  ancestry: ReadonlySet<string>;
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
 *   3. The child mounts in a FRESH ROOT scope built from the parent-pre-resolved
 *      overrides (F6a): `ScopeStack.root(resolveOverrides(...))`. The parent scope
 *      and its `$` root do NOT cross the boundary — the child sees ONLY its props.
 *
 * The mounted child gets its OWN z-order map (its `layer`s compete within this
 * component box's local stacking context, not the parent stage's global one). This
 * keeps the mount self-contained; cross-mount global z-order is out of F6b scope.
 */
function ComponentMount({ node, parentScope, palette, ancestry }: ComponentMountProps) {
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

  // ok: mount the child subtree in a FRESH ROOT scope of pre-resolved overrides.
  const overrides = resolveOverrides(node, parentScope);
  const childScope = ScopeStack.root(overrides);
  // The child mounts as its own little stage: its boxes are positioned/ordered
  // within THIS <Component> box. A local z-order map ranks the child's own boxes.
  const childZOrder = computeZOrder(entry.root, overrides);
  return (
    <div className="absolute inset-0" style={{ position: "absolute", zIndex: 0 }}>
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
   * parsed JSON). F3 resolves against this FLAT ROOT only; F4 extends to scopes.
   * Defaults to an empty model — then every `{token}` renders styled-but-literal.
   */
  model?: unknown;
  /**
   * The resolved `name → "r,g,b,a"` palette map color props resolve against.
   * Defaults to empty — then palette-named colors render styled-but-literal.
   */
  palette?: Palette;
  /**
   * F7 drag-to-move: called at the START of a drag on the SELECTED box, with the
   * box's `nodeId`. The host captures the node's current `position` here so each
   * subsequent {@link onDragMove} can be applied to that fixed base (avoiding
   * per-move accumulation drift). Omit to disable dragging (then the preview is
   * select-only).
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
   * The render scale applied to the root stage (fit-to-container letterbox,
   * computed by the host via `computeFitScale`). Defaults to `1` (native size). It
   * does TWO things:
   * it's applied as a single `transform: scale()` on the root stage (the one
   * intentional stacking context — never on intermediate wrappers, per F5a), and
   * it converts the drag's screen-pixel delta into logical-pixel delta (÷ scale)
   * so dragging stays accurate when the stage is scaled.
   */
  scale?: number;
};

/**
 * The fixed-resolution preview stage. The `<View>` root is the stage itself
 * (1280×768, `position: relative`); its visual children render as nested
 * absolutely-positioned boxes. A click is resolved to the nearest box via the
 * DOM `closest('[data-node-id]')` — the one piece that needs a browser — and
 * the resulting node id is handed to `onSelect`.
 *
 * F4: a root-only {@link ScopeStack} is built from `model` once and threaded
 * down to every box. Descending into a `forEach` subtree pushes the current item
 * onto a derived stack (see {@link renderChildren}/{@link stampForEach}), so bare
 * tokens resolve item-relative and `$.` reaches the root. The box code only ever
 * calls `scope.asScope().lookup`, so the F3 resolver is reused unchanged.
 */
export function GuiPreview({
  root,
  selectedNodeId,
  onSelect,
  model,
  palette = {},
  onDragStart,
  onDragMove,
  scale = 1,
}: GuiPreviewProps) {
  // A root-only scope stack for the whole tree (F4). Descending into a `forEach`
  // subtree pushes the current item (see `renderChildren`/`stampForEach`); with
  // no `forEach` entered, the current item IS the root, so this is a strict
  // superset of F3's flat-root scope.
  const scope = ScopeStack.root(model);
  // F5b: compute the ONE global `boxKey → z-index` ranking for the whole component
  // up front, then hand it down so each leaf box can apply its rank. The flatten
  // mirrors this render's `forEach` expansion + scope, so the map's keys line up
  // with the boxes rendered below. The stage itself is the single shared stacking
  // context every leaf's z-index competes within (`position: relative` + an
  // explicit `zIndex: 0` below); no wrapper in between forms one.
  const zOrder = computeZOrder(root, model);
  // The DOM half of the back-reference: walk outward from the click target to
  // the nearest box carrying a node id. `closest` matches the target itself
  // first, then ancestors — exactly the "nearest enclosing box" rule. Reading
  // the chain through `nearestNodeId` keeps the (pure, tested) semantics in one
  // place; here it receives at most one candidate.
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const box = target.closest(`[${NODE_ID_ATTR}]`);
    const id = box?.getAttribute(NODE_ID_ATTR);
    onSelect(nearestNodeId([id]));
  };

  // F7 drag-to-move: a drag begins on POINTERDOWN over the box that is already the
  // current selection — dragging the selected box repositions it; pressing on any
  // other box just selects it (via the click that follows) and does NOT drag. The
  // active drag's identity + screen origin live in a ref (not state) so a move
  // doesn't re-render the preview from the pointer handler — the only render is the
  // store writeback the host performs from `onDragMove`.
  const drag = useRef<{ nodeId: string; startX: number; startY: number } | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Dragging is opt-in (host supplies the writeback) and primary-button only.
    if (!onDragMove || event.button !== 0) return;
    const target = event.target as Element;
    const box = target.closest(`[${NODE_ID_ATTR}]`);
    const id = nearestNodeId([box?.getAttribute(NODE_ID_ATTR)]);
    // Only the ALREADY-selected box drags. A forEach instance shares the template
    // nodeId, so this resolves to the template — dragging an instance moves the
    // template, the documented behavior (instances are data-driven).
    if (id === null || id !== selectedNodeId) return;
    drag.current = { nodeId: id, startX: event.clientX, startY: event.clientY };
    // Capture so moves/up are delivered here even if the cursor leaves the box.
    event.currentTarget.setPointerCapture(event.pointerId);
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
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
      className="relative overflow-visible bg-[#1b1b1f] text-[#b9b2a5]"
      style={{
        position: "relative",
        width: `${STAGE_WIDTH}px`,
        height: `${STAGE_HEIGHT}px`,
        // Scale-to-fit: a single `transform: scale()` on the ROOT stage renders the
        // 1280×768 logical canvas at the fit-to-container size. The stage is the one
        // intentional stacking context, so a transform on IT is fine and intended;
        // NEVER add transform/opacity/filter/isolation to an intermediate wrapper
        // box (the F5a trap). `top left` origin keeps the scaled box pinned to the
        // host's centering wrapper, which is sized to the scaled footprint.
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        // F5b: the stage is the ONE intentional stacking context — it is the root
        // for this subtree, so every leaf's numeric z-index is interpreted relative
        // to it. `position: relative` + a numeric `z-index` forms that context; the
        // structural wrappers in between deliberately do NOT (they stay `auto`).
        zIndex: 0,
      }}
    >
      {renderChildren(root.children, selectedNodeId, scope, palette, "", zOrder, EMPTY_ANCESTRY)}
    </div>
  );
}

/** The empty `<Component>`-`src` ancestor set at the stage root (no mounts above). */
const EMPTY_ANCESTRY: ReadonlySet<string> = new Set();
