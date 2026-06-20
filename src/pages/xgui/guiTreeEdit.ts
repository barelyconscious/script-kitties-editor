/**
 * guiTreeEdit — the pure, testable core behind the structure column's TREE slice
 * (F9a): the element-rule table, the add-child tree mutation, and the component
 * picker's basename source list. No React, no IO — the {@link StructureTree}
 * panel and {@link ComponentPicker} render and dispatch off these.
 *
 * The structure tree mutates the open component's {@link GuiNode} root through the
 * shared editor store (`replaceRoot`). To keep that mutation correct and testable,
 * the actual "append a child under nodeId" transform lives HERE as a pure
 * immutable function, returning a fresh root (the store's `replaceRoot` reducer
 * marks dirty). The panel is then a thin shell that calls this and dispatches.
 *
 * SCOPE (F9a): ADD a child only. Delete and reparent are explicitly deferred
 * (design subsection 2 / task 452), so this module offers no remove/move — adding
 * them later is a new function here, not a reshaping of these.
 *
 * @see design/xgui_ta.md — "Structure column" (the tree slice) and "XML Elements"
 *   (the element rules: View top-level, Event only under View, Component childless).
 */

import { type GuiNode, type GuiTag, mintNodeId } from "../../lib/guiNode";
import type { GuiFolder } from "./guiTree";

/** The placeholder shown for an `<Event>` row whose `name` attr is empty. */
export const EVENT_PLACEHOLDER_LABEL = "(event)";

/**
 * The secondary label for a tree row, beside its tag chip:
 *  - `<Event>` nodes have NO `id` (events are name→handler, not id'd), so they are
 *    labeled by their `name` attribute — falling back to {@link EVENT_PLACEHOLDER_LABEL}
 *    when the name is blank/whitespace so a freshly-added event is still visible and
 *    selectable in the tree.
 *  - Every other tag keeps its authored `id` (trimmed) as the secondary label, or
 *    `null` when it has none (the panel then shows just the tag chip).
 *
 * Pure (no React) so the labeling rule is unit-tested without rendering the tree;
 * the {@link StructureTree} row is a thin consumer of this.
 */
export function nodeLabel(node: GuiNode): { tag: GuiTag; secondary: string | null } {
  if (node.tag === "Event") {
    const name = node.attrs.name?.trim();
    return { tag: node.tag, secondary: name ? name : EVENT_PLACEHOLDER_LABEL };
  }
  const id = node.attrs.id?.trim();
  return { tag: node.tag, secondary: id ? id : null };
}

/**
 * The PRIMARY label a tree row shows — the element's IDENTITY rather than its tag
 * (the tag is conveyed by the row's per-tag icon + color), so e.g. a `<Panel
 * id="Panel1">` reads as `Panel1`, not `Panel`:
 *  - `<Event>` has no id (events are name→handler), so it labels by its `name`,
 *    falling back to {@link EVENT_PLACEHOLDER_LABEL} (flagged `placeholder`) when blank;
 *  - every other tag labels by its authored `id` (trimmed) when present, and falls
 *    back to the bare tag name when it has none — so the row is never empty (an idless
 *    id-bearing element is additionally flagged by the tree's missing-id warning).
 *
 * Pure (no React) so the labeling rule is unit-tested without rendering the tree.
 */
export function treeNodePrimaryLabel(node: GuiNode): { text: string; placeholder: boolean } {
  if (node.tag === "Event") {
    const name = node.attrs.name?.trim();
    return name
      ? { text: name, placeholder: false }
      : { text: EVENT_PLACEHOLDER_LABEL, placeholder: true };
  }
  const id = node.attrs.id?.trim();
  return id ? { text: id, placeholder: false } : { text: node.tag, placeholder: false };
}

/**
 * The tags a user can ADD as a child under the given parent NODE, honoring the
 * phase-1 structural rules. This is CHILDREN-AWARE — some rules depend not just on
 * the parent's tag but on what it already contains (a GridLayout holds one child; a
 * Panel/View holds at most one GridLayout), so it takes the parent node, not just
 * its tag.
 *
 *  - `<View>` is the TOP-LEVEL element only — it is never added as a child, so it
 *    never appears in any parent's allow-list.
 *  - `<Component>` cannot have children (design: "Components cannot have
 *    children"), so its allow-list is empty.
 *  - `<Text>` is a LEAF — it carries text content and cannot hold children (nesting
 *    under it is a runtime parse error), so its allow-list is empty too.
 *  - `<Event>` may appear ONLY as an immediate child of `<View>`, so it is offered
 *    under `View` and nowhere else.
 *  - `<Panel>` is an ordinary visual container: it may hold `<Panel>`/`<Text>`/
 *    `<Component>` and a single `<GridLayout>` (only when it doesn't ALREADY contain
 *    one — a grid fills its container, so sibling grids are meaningless). `<View>`
 *    holds the same plus the View-only `<Event>`.
 *  - `<GridLayout>` repeats a SINGLE child of tag Panel/Text/Component — so it
 *    offers those three ONLY while it is empty, and offers NOTHING once it has its
 *    one child (no `+`).
 *
 * Returned in a stable, human-sensible order (containers first, then GridLayout,
 * then Event) so the context menu reads the same every time.
 */
export function allowedChildTags(parent: GuiNode): GuiTag[] {
  const hasGrid = parent.children.some((c) => c.tag === "GridLayout");
  switch (parent.tag) {
    case "View":
      // Visual children plus the View-only <Event> and nestable <Component>; a
      // single <GridLayout> when one isn't already present.
      return hasGrid
        ? ["Panel", "Text", "Component", "Event"]
        : ["Panel", "Text", "Component", "GridLayout", "Event"];
    case "Panel":
      // Visual container: any box-producing child plus a single <GridLayout>.
      return hasGrid
        ? ["Panel", "Text", "Component"]
        : ["Panel", "Text", "Component", "GridLayout"];
    case "Text":
      // A <Text> is a LEAF: it carries text content and cannot hold child elements
      // (nesting children under a <Text> is a parse error in the runtime). Empty.
      return [];
    case "GridLayout":
      // A grid repeats ONE child; offer its legal child tags only while empty.
      return parent.children.length === 0 ? ["Panel", "Text", "Component"] : [];
    case "Component":
    case "Event":
      // <Component> is childless by rule; <Event> is a leaf registration.
      return [];
    default: {
      const _never: never = parent.tag;
      return _never;
    }
  }
}

/** Whether a child of `childTag` may be added under the given parent NODE. */
export function canAddChild(parent: GuiNode, childTag: GuiTag): boolean {
  return allowedChildTags(parent).includes(childTag);
}

/**
 * Mint a fresh {@link GuiNode} for a newly-added element, with the minimal
 * sensible default attributes so it is visible/selectable in the preview the
 * instant it is added (the Properties slice F9b edits the rest):
 *
 *  - `<Panel>` / `<Text>` get a small default `position`/`size` so the new box is
 *    a visible, clickable target rather than a zero/full-bleed surprise. `<Text>`
 *    also gets placeholder `text` so it paints something.
 *  - `<Component>` carries the chosen `src` basename (the picker supplies it) plus
 *    the same default geometry; it has NO children by rule.
 *  - `<Event>` gets empty `name`/`handler` the Properties panel (F9b) fills in.
 *  - `<GridLayout>` gets `rows="1"`/`columns="1"` (the documented defaults);
 *    `gutter` defaults to "0,0" at render time so it need not be written, and
 *    `dataCollection` is left empty for the user to fill. A grid is a non-visual
 *    control element — it gets NO `position`/`size` and NO auto-id.
 *
 * When the new node is being inserted UNDER a `<GridLayout>` (`parentTag` is
 * "GridLayout"), its default `position`/`size` are OMITTED — the grid owns that
 * child's geometry (design req 4), so a default would only serialize as an ignored
 * attr. Pass the parent's tag so the factory can drop them at creation time.
 *
 * `id` is left UNSET here — the auto-id (`Panel1`, `Text2`, …) is assigned at
 * INSERTION time by the store's `addChildNode` action (which needs the whole tree
 * to pick a free running number), not minted in this per-node factory. The user
 * then renames it in the Properties panel (F9b). `<Event>`, `<GridLayout>`, and the
 * root `<View>` get no auto-id (see {@link nextAutoId} / {@link nodeHasId}).
 */
export function makeChildNode(tag: GuiTag, src?: string, parentTag?: GuiTag): GuiNode {
  const node: GuiNode = { nodeId: mintNodeId(), tag, attrs: {}, children: [] };
  // A child laid out by a grid does not own its own geometry — omit defaults.
  const underGrid = parentTag === "GridLayout";
  switch (tag) {
    case "Panel":
      node.attrs = underGrid ? {} : { position: "0,0,0,0", size: "0,0,100,100" };
      break;
    case "Text":
      node.attrs = underGrid
        ? { text: "Text" }
        : { position: "0,0,0,0", size: "0,0,100,32", text: "Text" };
      break;
    case "Component":
      node.attrs = underGrid
        ? { src: src ?? "" }
        : { src: src ?? "", position: "0,0,0,0", size: "0,0,100,100" };
      break;
    case "Event":
      node.attrs = { name: "", handler: "" };
      break;
    case "GridLayout":
      // Non-visual control element: documented defaults, no geometry, no id.
      node.attrs = { rows: "1", columns: "1" };
      break;
    case "View":
      // A <View> is never created as a child (it is top-level only); guarded by
      // allowedChildTags, but keep the switch exhaustive.
      node.attrs = {};
      break;
    default: {
      const _never: never = tag;
      return _never;
    }
  }
  return node;
}

/**
 * The next auto-assigned local `id` for a newly-added element of `tag` — e.g.
 * `Panel1`, `Text2`, `Component3`. Numbering is a single running counter SHARED
 * across tags (the second element added is `…2` whatever its tag, matching the
 * intended `Panel1` / `Text2` sequence), derived by scanning every existing `id`
 * in the tree for a trailing number and returning one more than the highest found.
 *
 * That scheme makes the new id unique tree-wide (it always out-numbers every
 * existing numeric id) AND deterministic — it needs no persisted counter, so it
 * survives reload/undo without drift. Ids that don't end in a number (a
 * user-renamed `healthBar`, the root `view`) simply don't contribute to the max,
 * so renaming away from the auto scheme never seeds a future collision; an
 * explicit `Panel7` pushes the next number past 7.
 *
 * This computes the value only; the store's `addChildNode` decides WHICH tags get
 * one (id-bearing tags — not `<Event>`, `<GridLayout>`, or the root `<View>`) and
 * assigns it at insertion time, when the whole tree is in hand.
 */
export function nextAutoId(root: GuiNode, tag: GuiTag): string {
  let max = 0;
  const visit = (node: GuiNode): void => {
    const id = node.attrs.id?.trim();
    if (id) {
      const match = /(\d+)$/.exec(id);
      if (match) {
        const num = Number.parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return `${tag}${max + 1}`;
}

/**
 * Append `child` as the last child of the node identified by `parentNodeId`,
 * returning a NEW root (immutable — untouched subtrees are reused by reference, so
 * React can diff cheaply and the store's `replaceRoot` swaps one object).
 *
 * If `parentNodeId` is not found, the original root is returned UNCHANGED (same
 * reference) — callers can treat an unchanged reference as "no-op". The structural
 * rules are NOT re-checked here (the menu only offers legal tags via
 * {@link allowedChildTags}); pass {@link canAddChild} at the call site if a tag
 * could arrive from an untrusted path.
 */
export function addChild(root: GuiNode, parentNodeId: string, child: GuiNode): GuiNode {
  if (root.nodeId === parentNodeId) {
    return { ...root, children: [...root.children, child] };
  }
  let changed = false;
  const children = root.children.map((c) => {
    const next = addChild(c, parentNodeId, child);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

/**
 * Replace the `attrs` of the node identified by `nodeId`, returning a NEW root
 * (immutable — untouched subtrees are reused by reference, so React diffs cheaply
 * and the store's `setNodeAttrs` reducer swaps one object). The node's `tag`,
 * `nodeId`, and `children` are preserved; only `attrs` is swapped.
 *
 * If `nodeId` is not found, the original root is returned UNCHANGED (same
 * reference) — callers (and the store) treat an unchanged reference as a no-op
 * (don't dirty on a phantom write). This is the Properties-panel (F9b) and
 * drag-writeback (F7) write path: both edit one node's attrs by id.
 */
export function setNodeAttrs(
  root: GuiNode,
  nodeId: string,
  attrs: Record<string, string>,
): GuiNode {
  if (root.nodeId === nodeId) {
    return { ...root, attrs };
  }
  let changed = false;
  const children = root.children.map((c) => {
    const next = setNodeAttrs(c, nodeId, attrs);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

/**
 * Remove the node identified by `nodeId` from the tree, returning a NEW root
 * (immutable — untouched subtrees are reused by reference, so React diffs cheaply
 * and the store's `removeNode` reducer swaps one object). Only DESCENDANTS are
 * removable: the root itself is never removed (removing the `<View>` root is
 * meaningless), so a `nodeId` equal to the root's is a no-op.
 *
 * If `nodeId` is not found (or is the root), the original root is returned
 * UNCHANGED (same reference) — callers (and the store) treat an unchanged
 * reference as a no-op (don't dirty on a phantom remove).
 *
 * The structure TREE exposes this on every non-root row (right-click "Delete" /
 * the inline trash button) — removing the element and its whole subtree. `<Event>`
 * removal is one case of this general delete. This function is the shared immutable
 * primitive; root-protection lives here (a root `nodeId` is a no-op).
 */
export function removeNode(root: GuiNode, nodeId: string): GuiNode {
  // The root is never removable — only descendants.
  if (root.nodeId === nodeId) return root;
  let changed = false;
  const children: GuiNode[] = [];
  for (const child of root.children) {
    if (child.nodeId === nodeId) {
      changed = true;
      continue; // drop this child
    }
    const next = removeNode(child, nodeId);
    if (next !== child) changed = true;
    children.push(next);
  }
  return changed ? { ...root, children } : root;
}

/**
 * Drop every node in `nodeIds` (and its whole subtree) from the tree, returning a
 * NEW root — the multi-node analogue of {@link removeNode}, used by the preview's
 * EDITOR-VISIBILITY prune (hidden elements are pruned before rendering, not removed
 * from the document). Immutable + structure-sharing: an empty set, or a tree with no
 * hidden nodes, returns the SAME root reference (so a no-op never churns the preview
 * memo). The root itself is never pruned (the `<View>` stage always renders); to hide
 * everything, the caller empties the root's children. Unlike a save-time edit, this is
 * a render-only transform — the store keeps the full tree.
 */
export function pruneNodes(root: GuiNode, nodeIds: ReadonlySet<string>): GuiNode {
  if (nodeIds.size === 0) return root;
  let changed = false;
  const children: GuiNode[] = [];
  for (const child of root.children) {
    if (nodeIds.has(child.nodeId)) {
      changed = true;
      continue; // drop this child and its whole subtree
    }
    const next = pruneNodes(child, nodeIds);
    if (next !== child) changed = true;
    children.push(next);
  }
  return changed ? { ...root, children } : root;
}

/**
 * The chain of nodes from the root DOWN TO (and including) the node identified by
 * `nodeId`, or `null` if the node is not in the tree. Used to derive the computed
 * hierarchical id (the parent chain of authored `id` attrs) for the Properties
 * panel — index 0 is the root `<View>`, the last entry is the target node.
 */
export function nodePath(root: GuiNode, nodeId: string): GuiNode[] | null {
  if (root.nodeId === nodeId) return [root];
  for (const child of root.children) {
    const sub = nodePath(child, nodeId);
    if (sub) return [root, ...sub];
  }
  return null;
}

/**
 * Find a node by `nodeId` anywhere in the tree, or `null`. The structure panel
 * uses it to resolve the right-clicked node's tag for the add-child menu.
 */
export function findNode(root: GuiNode, nodeId: string): GuiNode | null {
  if (root.nodeId === nodeId) return root;
  for (const child of root.children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

/**
 * One pickable component for the add-`<Component>` picker: the bare basename it
 * writes into `src`, plus the folder it lives in as a human disambiguating hint.
 *
 * Per design subsection (3), `<Component src>` resolves by BASENAME across the
 * whole tree (the manifest is basename-keyed and basenames are unique tree-wide),
 * so the picker spans every folder and writes only the bare basename — the folder
 * is shown to the user but never written into `src`.
 */
export type ComponentPickItem = {
  /** Bare basename written into `src`, e.g. "bag_slot". */
  name: string;
  /** gui-relative folder the component lives in ("" = gui/ root), a UI hint only. */
  folder: string;
};

/**
 * Flatten a {@link GuiFolder} tree into the sorted basename list the component
 * picker renders. Spans the WHOLE tree (every subfolder), since `src` is a
 * tree-wide basename lookup. Sorted by basename so the searchable list is stable.
 */
export function componentPickItems(tree: GuiFolder): ComponentPickItem[] {
  const items: ComponentPickItem[] = [];
  function walk(folder: GuiFolder): void {
    for (const component of folder.components) {
      items.push({ name: component.name, folder: folder.path });
    }
    for (const sub of folder.folders) walk(sub);
  }
  walk(tree);
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/**
 * Filter the pick list by a case-insensitive substring over the basename (and the
 * folder hint, so a user can narrow by where it lives). An empty query returns the
 * full list unchanged.
 */
export function filterPickItems(items: ComponentPickItem[], query: string): ComponentPickItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return items;
  return items.filter(
    (item) => item.name.toLowerCase().includes(q) || item.folder.toLowerCase().includes(q),
  );
}
