/**
 * guiZOrder — the pure, unit-testable FLATTEN + GLOBAL z-order pass for the XGUI
 * preview (F5b).
 *
 * The `layer` attribute is a GLOBAL paint order across the WHOLE component, not a
 * per-branch one: a deeply-nested box with a high `layer` must paint above a
 * shallow box with a low `layer` in a DIFFERENT branch. CSS can express that only
 * if every leaf's `z-index` competes inside ONE shared stacking context (the root
 * stage) — see `design/xgui_ta.md`, "F5a — confirmed render contract for the
 * layer / global z-order model". This module computes the single global ordering
 * the renderer assigns as `z-index`.
 *
 * The two-pass approach (F5a, confirmed against React's render output):
 *
 *   1. FLATTEN pass. Walk the tree in DOCUMENT ORDER (depth-first, pre-order — the
 *      order nodes appear in the serialized XML), expanding `forEach` exactly as
 *      the renderer does (same {@link stampForEach} + {@link ScopeStack}, so the
 *      flatten and the render agree on which boxes exist and in what order). For
 *      each visual box capture `{ boxKey, resolvedLayer, docOrderIndex }`.
 *      `resolvedLayer` is the `layer` attribute AFTER token/literal resolution
 *      (layer is bindable — F3), defaulting to `0`. `docOrderIndex` is the box's
 *      position in this pre-order walk: the stable tiebreaker.
 *   2. SORT + ASSIGN pass. Stable-sort by `(resolvedLayer asc, docOrderIndex asc)`
 *      and assign each box a `z-index` equal to its RANK in the sorted list (a
 *      dense `0..N-1` sequence — only the relative order matters). The result is a
 *      `boxKey → zIndex` map the renderer hands to each LEAF `<div>`; structural
 *      wrappers get NO `z-index` (they stay `z-index: auto` and therefore do NOT
 *      form stacking contexts, which is the load-bearing CSS guarantee).
 *
 * Assigning RANK (not raw `layer`) as the z-index also removes duplicate-z-index
 * document-order ambiguity: equal-`layer` boxes get distinct, document-ordered
 * ranks, so paint order is fully determined and never relies on the browser's
 * tie-break.
 *
 * This module is PURE (no React, no DOM). The renderer computes the SAME
 * {@link boxKey} per box as it descends (see {@link makeBoxKey}) and looks its
 * z-index up in the returned map. Keeping the flatten here as a clean, standalone
 * seam is also the forward-compat hook for a future flat-emit renderer (the
 * escape hatch for when a panel needs `opacity`/`transform` — NOT built here).
 *
 * @see design/xgui_ta.md — "F5a — confirmed render contract for the layer /
 *   global z-order model".
 */

import { resolveTypedProp } from "./guiBinding";
import { isForEachTemplate, stampForEach } from "./guiForEach";
import type { GuiNode } from "./guiNode";
import { ScopeStack } from "./guiScope";

/** The attribute name carrying a box's global paint order. Bindable (F3). */
export const LAYER_ATTR = "layer";

/** The `layer` value used when a box has no `layer` attribute (or it's unresolved). */
export const DEFAULT_LAYER = 0;

/**
 * A box-producing element tag. Mirrors the renderer's `isVisualTag`: `View` is the
 * stage (not itself a participating box) and `Event` is non-visual. Kept in lockstep
 * with `GuiPreview` so the flatten enumerates exactly the boxes the renderer paints.
 */
function isVisualTag(tag: GuiNode["tag"]): boolean {
  return tag === "Panel" || tag === "Text" || tag === "Component";
}

/**
 * The stable, render-reproducible identity of ONE rendered box.
 *
 * A `nodeId` alone is NOT unique once `forEach` is in play: every instance of a
 * template shares the template's `nodeId` (that is what makes selection collapse to
 * the template). So a box is identified by the PATH of segments from the stage root
 * down to it, where each `forEach` instance contributes its positional instance key.
 * The renderer builds the identical key as it descends, so the z-index map keys line
 * up exactly with the DOM boxes.
 *
 * Format: segments joined by `/`. A plain (once-rendered) box contributes its
 * `nodeId`; a `forEach` instance contributes `nodeId#instanceKey`. Example:
 * `"n1/n4#2/n7"`.
 */
export type BoxKey = string;

/** The segment a box contributes to its {@link BoxKey} path. */
function keySegment(nodeId: string, instanceKey: string | undefined): string {
  return instanceKey === undefined ? nodeId : `${nodeId}#${instanceKey}`;
}

/**
 * Build the {@link BoxKey} for a box given its parent's key and its own segment.
 * The renderer calls this with the same arguments it uses to build its React keys,
 * so the keys it looks up in the z-index map match the ones the flatten produced.
 *
 * `parentKey` is `""` for a direct child of the stage (the `<View>` root is not
 * itself a participating box, so its children start the path).
 */
export function makeBoxKey(
  parentKey: BoxKey,
  nodeId: string,
  instanceKey: string | undefined,
): BoxKey {
  const segment = keySegment(nodeId, instanceKey);
  return parentKey === "" ? segment : `${parentKey}/${segment}`;
}

/**
 * One box captured by the flatten pass, before sorting: its render identity, its
 * resolved global layer, and its document-order position (the tiebreaker).
 */
export type FlatBox = {
  /** The render-reproducible identity of this box (see {@link BoxKey}). */
  boxKey: BoxKey;
  /** The `layer` attribute resolved against this box's scope; {@link DEFAULT_LAYER} if absent/unresolved. */
  resolvedLayer: number;
  /** This box's 0-based position in the pre-order (document-order) walk. */
  docOrderIndex: number;
};

/**
 * Resolve a box's `layer` to a number, against the box's own scope (layer is
 * bindable — a `{token}` resolves through F3's {@link resolveTypedProp}). Falls back
 * to {@link DEFAULT_LAYER} when:
 *   - the attribute is absent;
 *   - a bound token did not resolve (renders styled-but-literal elsewhere — for
 *     ordering, an unresolved layer is treated as the default rather than NaN);
 *   - the resolved value is not a finite number.
 *
 * Non-integer numeric layers are accepted (sort is numeric); the design treats
 * `layer` as an integer, but the resolver doesn't reject a fractional literal, and
 * numeric sort handles it correctly either way.
 */
export function resolveLayer(node: GuiNode, scope: ScopeStack): number {
  const raw = node.attrs[LAYER_ATTR];
  if (raw === undefined) return DEFAULT_LAYER;
  const { value, resolved } = resolveTypedProp(raw, scope.asScope());
  if (!resolved) return DEFAULT_LAYER;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : DEFAULT_LAYER;
}

/**
 * FLATTEN pass: walk the tree in document order (pre-order DFS), expanding
 * `forEach` exactly as the renderer does, and emit one {@link FlatBox} per visual
 * box. The returned list is in DOCUMENT ORDER (its index IS each box's
 * `docOrderIndex`).
 *
 * `root` is expected to be the `<View>` stage; its children are the first
 * participating boxes (the stage itself is not a box). The traversal pushes each
 * `forEach` item onto the scope stack as it descends, so a child's `layer` token
 * resolves item-relative — identical to how the renderer resolves the rest of the
 * child's attributes.
 */
export function flattenBoxes(root: GuiNode, model?: unknown): FlatBox[] {
  const boxes: FlatBox[] = [];
  const scope = ScopeStack.root(model);

  /**
   * Visit the visual children of `parent` in document order. Each plain child is
   * one box; each `forEach` template is expanded into its instances (in order),
   * each in its own item scope. Descends into a box's own children after recording
   * it (pre-order).
   */
  function visitChildren(children: GuiNode[], parentKey: BoxKey, parentScope: ScopeStack): void {
    for (const child of children) {
      if (!isVisualTag(child.tag)) continue; // <Event> et al. — non-visual, no box

      if (!isForEachTemplate(child)) {
        emit(child, parentKey, parentScope, undefined);
        continue;
      }
      // A `forEach` template: one box per stamped instance, each item-scoped. An
      // empty/unresolved collection yields zero instances — the template paints
      // nothing here, exactly as the renderer does.
      for (const instance of stampForEach(child, parentScope)) {
        emit(child, parentKey, instance.scope, instance.instanceKey);
      }
    }
  }

  /** Record one box (assigning its doc-order index) then recurse into its children. */
  function emit(
    node: GuiNode,
    parentKey: BoxKey,
    boxScope: ScopeStack,
    instanceKey: string | undefined,
  ): void {
    const boxKey = makeBoxKey(parentKey, node.nodeId, instanceKey);
    boxes.push({
      boxKey,
      resolvedLayer: resolveLayer(node, boxScope),
      docOrderIndex: boxes.length, // pre-order position == insertion order
    });
    // Descend into this box's children in the SAME item scope (a `forEach` instance
    // carries its item scope into its subtree). `<Component>` has no children.
    visitChildren(node.children, boxKey, boxScope);
  }

  visitChildren(root.children, "", scope);
  return boxes;
}

/**
 * The z-order assignment: a map from each box's {@link BoxKey} to its `z-index`.
 * The integers are a dense `0..N-1` rank sequence — only their relative order is
 * meaningful. A leaf `<div>` styled with its mapped `z-index` participates directly
 * in the root stage's single stacking context.
 */
export type ZOrderMap = ReadonlyMap<BoxKey, number>;

/**
 * SORT + ASSIGN pass: stable-sort the flattened boxes by `(resolvedLayer asc,
 * docOrderIndex asc)` and assign each its RANK in that order as a `z-index`.
 *
 * The sort is made fully deterministic by the `docOrderIndex` tiebreaker, so two
 * boxes never compare equal — equal-`layer` boxes fall back to document order, and
 * the assigned ranks are distinct. Stability of the underlying sort is therefore
 * not even relied upon, but the comparator is total regardless.
 */
export function assignZOrder(boxes: readonly FlatBox[]): ZOrderMap {
  const sorted = [...boxes].sort((a, b) => {
    if (a.resolvedLayer !== b.resolvedLayer) return a.resolvedLayer - b.resolvedLayer;
    return a.docOrderIndex - b.docOrderIndex;
  });
  const map = new Map<BoxKey, number>();
  sorted.forEach((box, rank) => {
    map.set(box.boxKey, rank);
  });
  return map;
}

/**
 * The whole F5b pass in one call: flatten the tree (document order, `forEach`
 * expanded, `layer` resolved against each box's scope) then assign the global
 * `(layer, doc-order)` z-order. Returns the `boxKey → zIndex` map the renderer
 * applies to each leaf box.
 *
 * This is what `GuiPreview` calls once per render; the two stages are exported
 * separately so each is independently testable (and so a future flat-emit renderer
 * can reuse {@link flattenBoxes} directly).
 */
export function computeZOrder(root: GuiNode, model?: unknown): ZOrderMap {
  return assignZOrder(flattenBoxes(root, model));
}
