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

import type { CSSProperties } from "react";
import {
  colorCodeToCss,
  flatRootScope,
  type Palette,
  type ResolvedAttrs,
  type ResolveScope,
  resolveAttrs,
} from "../../lib/guiBinding";
import { computeBoxGeometry, STAGE_HEIGHT, STAGE_WIDTH } from "../../lib/guiGeometry";
import type { GuiNode } from "../../lib/guiNode";
import { isNodeSelected, NODE_ID_ATTR, nearestNodeId } from "../../lib/guiSelection";
import { cn } from "../../lib/utils";

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
  scope: ResolveScope;
  palette: Palette;
};

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
function GuiBox({ node, selectedNodeId, scope, palette }: GuiBoxProps) {
  // Resolve the whole attribute bag once: geometry, colors, and text all read
  // off the resolved values, and `unresolved` drives the waiting-binding styling.
  const resolved = resolveAttrs(node.attrs, scope, palette);
  const { attrs, unresolved } = resolved;

  // `visible="false"` (literal or bound) hides the box; any other value shows it.
  if (attrs.visible?.trim().toLowerCase() === "false") return null;

  const geometry = computeBoxGeometry(attrs.position, attrs.size);
  const selected = isNodeSelected(node.nodeId, selectedNodeId);

  const backgroundColor = colorCodeToCss(attrs.backgroundColor);
  const borderColor = colorCodeToCss(attrs.borderColor);
  const borderSize = attrs.borderSize?.trim();
  const hasBorder = borderColor !== undefined && borderColor !== "transparent";
  const isText = node.tag === "Text";
  const textColor = isText ? colorCodeToCss(attrs.textColor ?? DEFAULT_TEXT_COLOR) : undefined;
  const fontSize = isText ? Number(attrs.fontSize) : Number.NaN;

  // Highlight via outline + box-shadow ONLY. These do not form a stacking
  // context, so a selected wrapper does not trap its descendants' z-index
  // (the F5a constraint). Never use transform/opacity/filter/isolation here.
  const style: CSSProperties = {
    ...geometry,
    backgroundColor,
    // Authored border wins over the editor hairline; otherwise the hairline shows.
    border: hasBorder
      ? `${borderSize && Number.isFinite(Number(borderSize)) ? Number(borderSize) : 1}px solid ${borderColor}`
      : undefined,
    color: textColor,
    fontSize: isText && Number.isFinite(fontSize) ? `${fontSize}px` : undefined,
    textAlign: isText ? cssTextAlign(attrs.textAlign) : undefined,
    // No `overflow` key at all → defaults to `visible` → overflow paints out.
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
      {node.children
        .filter((child) => isVisualTag(child.tag))
        .map((child) => (
          <GuiBox
            key={child.nodeId}
            node={child}
            selectedNodeId={selectedNodeId}
            scope={scope}
            palette={palette}
          />
        ))}
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
};

/**
 * The fixed-resolution preview stage. The `<View>` root is the stage itself
 * (1280×768, `position: relative`); its visual children render as nested
 * absolutely-positioned boxes. A click is resolved to the nearest box via the
 * DOM `closest('[data-node-id]')` — the one piece that needs a browser — and
 * the resulting node id is handed to `onSelect`.
 *
 * F3: a flat-root resolution scope is built from `model` once and threaded down
 * to every box so token/palette resolution happens at render time. F4 swaps this
 * single scope for a stack-backed scope that pushes/pops item scopes inside a
 * `forEach` subtree — the box code is unchanged because it only calls
 * `scope.lookup`.
 */
export function GuiPreview({
  root,
  selectedNodeId,
  onSelect,
  model,
  palette = {},
}: GuiPreviewProps) {
  // One flat-root scope for the whole tree (F3). F4 replaces this with a
  // stack-backed scope and pushes item scopes as it descends a forEach subtree.
  const scope = flatRootScope(model);
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

  return (
    // The stage is the preview canvas: selection is by click (and later
    // drag/F7). Keyboard-driven selection is the tree panel's job (F9), so the
    // canvas intentionally has no key handler and is not a button/role.
    // biome-ignore lint/a11y/noStaticElementInteractions: preview canvas selected by click; keyboard selection lives in the tree panel (F9)
    // biome-ignore lint/a11y/useKeyWithClickEvents: preview canvas selected by click; keyboard selection lives in the tree panel (F9)
    <div
      data-gui-stage=""
      onClick={handleClick}
      className="relative overflow-visible bg-[#1b1b1f] text-[#b9b2a5]"
      style={{
        position: "relative",
        width: `${STAGE_WIDTH}px`,
        height: `${STAGE_HEIGHT}px`,
      }}
    >
      {root.children
        .filter((child) => isVisualTag(child.tag))
        .map((child) => (
          <GuiBox
            key={child.nodeId}
            node={child}
            selectedNodeId={selectedNodeId}
            scope={scope}
            palette={palette}
          />
        ))}
    </div>
  );
}
