/**
 * guiZOrder — the pure, unit-testable z-order pass for the XGUI preview.
 *
 * **The intuitive NESTED model (supersedes the old global-flat one).** An
 * element's `layer` controls its draw order RELATIVE TO ITS SIBLINGS: a higher
 * `layer` paints above a lower-`layer` sibling, and ties break by document order.
 * A container's `layer` lifts the container AND ITS WHOLE SUBTREE as a group,
 * because each box forms a normal CSS stacking context that contains its own
 * descendants — exactly how UI engines (and a user's mental model) treat z-order.
 * See `design/xgui_ta.md`, "F5a/F5b — nested z-order model".
 *
 * Why this replaced the global-flat scheme: the previous model ranked every LEAF
 * box in ONE global `(layer, doc-order)` ordering and gave wrappers `z-index:
 * auto`. That made a CONTAINER's `layer` a silent no-op (it never reached the DOM)
 * and meant `layer` was not inherited — setting `layer` on a Panel-with-children
 * did nothing visible. The nested model fixes both: every box (leaf or container)
 * gets a `z-index` from its own resolved `layer` among its siblings.
 *
 * The pass (pure, no React/DOM):
 *
 *   1. FLATTEN pass. Walk the tree in DOCUMENT ORDER (depth-first, pre-order),
 *      expanding `forEach` exactly as the renderer does (same {@link stampForEach}
 *      + {@link ScopeStack}, so flatten and render agree on which boxes exist).
 *      For each visual box capture `{ boxKey, parentKey, resolvedLayer,
 *      siblingIndex }`. `resolvedLayer` is the `layer` attribute AFTER
 *      token/literal resolution (layer is bindable — F3), defaulting to `0`.
 *      `siblingIndex` is the box's 0-based position AMONG ITS SIBLINGS (the
 *      document-order tiebreaker WITHIN a sibling group).
 *   2. RANK pass. Within EACH sibling group (boxes sharing a `parentKey`),
 *      stable-sort by `(resolvedLayer asc, siblingIndex asc)` and assign each box a
 *      `z-index` equal to its rank in that group (a dense `0..k-1` sequence per
 *      group — only the relative order within the group matters). The renderer
 *      applies the mapped `z-index` to EVERY box; a box with a non-default layer
 *      legitimately forms a stacking context, and that is the DESIRED grouping
 *      (each subtree stays contained within its parent's stacking context).
 *
 * Assigning RANK (not raw `layer`) as the z-index removes duplicate-z-index
 * document-order ambiguity: equal-`layer` siblings get distinct, document-ordered
 * ranks within their group, so paint order is fully determined and never relies on
 * the browser's tie-break.
 *
 * The renderer computes the SAME {@link boxKey} per box as it descends (see
 * {@link makeBoxKey}) and looks its z-index up in the returned map.
 *
 * @see design/xgui_ta.md — "F5a/F5b — nested z-order model".
 */

import { resolveTypedProp } from "./guiBinding";
import { isForEachTemplate, stampForEach } from "./guiForEach";
import type { GuiNode } from "./guiNode";
import { ScopeStack } from "./guiScope";

/** The attribute name carrying a box's paint order among its siblings. Bindable (F3). */
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
 * One box captured by the flatten pass, before ranking: its render identity, its
 * parent's identity (the sibling-group key), its resolved layer, and its
 * position among its siblings (the within-group document-order tiebreaker).
 */
export type FlatBox = {
  /** The render-reproducible identity of this box (see {@link BoxKey}). */
  boxKey: BoxKey;
  /** The {@link BoxKey} of this box's parent box (`""` for a direct child of the stage). */
  parentKey: BoxKey;
  /** The `layer` attribute resolved against this box's scope; {@link DEFAULT_LAYER} if absent/unresolved. */
  resolvedLayer: number;
  /** This box's 0-based position AMONG ITS SIBLINGS (the within-group tiebreaker). */
  siblingIndex: number;
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
 * box. Each box records its `parentKey` (the sibling-group key) and its
 * `siblingIndex` (its position among the boxes sharing that parent).
 *
 * `root` is expected to be the `<View>` stage; its children are the first
 * participating boxes (the stage itself is not a box, so its children's
 * `parentKey` is `""`). The traversal pushes each `forEach` item onto the scope
 * stack as it descends, so a child's `layer` token resolves item-relative —
 * identical to how the renderer resolves the rest of the child's attributes.
 */
export function flattenBoxes(root: GuiNode, model?: unknown): FlatBox[] {
  const boxes: FlatBox[] = [];
  const scope = ScopeStack.root(model);

  /**
   * Visit the visual children of `parent` in document order. Each plain child is
   * one box; each `forEach` template is expanded into its instances (in order),
   * each in its own item scope. All boxes produced here share `parentKey` and are
   * numbered by their position in this sibling group. Descends into a box's own
   * children (their OWN sibling group) after recording it (pre-order).
   */
  function visitChildren(children: GuiNode[], parentKey: BoxKey, parentScope: ScopeStack): void {
    let siblingIndex = 0; // position WITHIN this sibling group (forEach instances count)
    for (const child of children) {
      if (!isVisualTag(child.tag)) continue; // <Event> et al. — non-visual, no box

      if (!isForEachTemplate(child)) {
        emit(child, parentKey, parentScope, undefined, siblingIndex);
        siblingIndex += 1;
        continue;
      }
      // A `forEach` template: one box per stamped instance, each item-scoped, each
      // its own sibling slot. An empty/unresolved collection yields zero instances —
      // the template paints nothing here, exactly as the renderer does.
      for (const instance of stampForEach(child, parentScope)) {
        emit(child, parentKey, instance.scope, instance.instanceKey, siblingIndex);
        siblingIndex += 1;
      }
    }
  }

  /** Record one box (with its sibling position) then recurse into its children. */
  function emit(
    node: GuiNode,
    parentKey: BoxKey,
    boxScope: ScopeStack,
    instanceKey: string | undefined,
    siblingIndex: number,
  ): void {
    const boxKey = makeBoxKey(parentKey, node.nodeId, instanceKey);
    boxes.push({
      boxKey,
      parentKey,
      resolvedLayer: resolveLayer(node, boxScope),
      siblingIndex,
    });
    // Descend into this box's children in the SAME item scope (a `forEach` instance
    // carries its item scope into its subtree). `<Component>` has no children. This
    // box's key becomes the parentKey of its own children's sibling group.
    visitChildren(node.children, boxKey, boxScope);
  }

  visitChildren(root.children, "", scope);
  return boxes;
}

/**
 * The z-order assignment: a map from each box's {@link BoxKey} to its `z-index`.
 * The integers are dense `0..k-1` rank sequences ASSIGNED PER SIBLING GROUP — only
 * a box's rank relative to its siblings is meaningful (its parent's own z-index
 * contains the whole group within the parent's stacking context). A box styled
 * with its mapped `z-index` competes only within its parent's stacking context.
 */
export type ZOrderMap = ReadonlyMap<BoxKey, number>;

/**
 * RANK pass: within EACH sibling group (boxes sharing a `parentKey`), stable-sort
 * by `(resolvedLayer asc, siblingIndex asc)` and assign each box its RANK in that
 * group as a `z-index`.
 *
 * Each sibling group is ranked independently: a box's z-index orders it only among
 * its siblings, and because the parent box carries its OWN z-index (its rank in the
 * grandparent group), the whole subtree is lifted/lowered as a group via normal
 * nested CSS stacking. The `siblingIndex` tiebreaker makes the within-group sort
 * fully deterministic, so equal-`layer` siblings fall back to document order and
 * the assigned ranks are distinct.
 */
export function assignZOrder(boxes: readonly FlatBox[]): ZOrderMap {
  // Bucket boxes by their sibling-group key (parentKey).
  const groups = new Map<BoxKey, FlatBox[]>();
  for (const box of boxes) {
    const group = groups.get(box.parentKey);
    if (group === undefined) groups.set(box.parentKey, [box]);
    else group.push(box);
  }

  const map = new Map<BoxKey, number>();
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      if (a.resolvedLayer !== b.resolvedLayer) return a.resolvedLayer - b.resolvedLayer;
      return a.siblingIndex - b.siblingIndex;
    });
    sorted.forEach((box, rank) => {
      map.set(box.boxKey, rank);
    });
  }
  return map;
}

/**
 * The whole nested z-order pass in one call: flatten the tree (document order,
 * `forEach` expanded, `layer` resolved against each box's scope) then assign the
 * per-sibling-group z-order. Returns the `boxKey → zIndex` map the renderer applies
 * to each box.
 *
 * This is what `GuiPreview` calls once per render; the two stages are exported
 * separately so each is independently testable.
 */
export function computeZOrder(root: GuiNode, model?: unknown): ZOrderMap {
  return assignZOrder(flattenBoxes(root, model));
}
