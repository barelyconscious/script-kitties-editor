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
 * The tags a user can ADD as a child under a parent of the given tag, honoring the
 * phase-1 structural rules:
 *
 *  - `<View>` is the TOP-LEVEL element only — it is never added as a child, so it
 *    never appears in any parent's allow-list.
 *  - `<Component>` cannot have children (design: "Components cannot have
 *    children"), so its allow-list is empty.
 *  - `<Event>` may appear ONLY as an immediate child of `<View>`, so it is offered
 *    under `View` and nowhere else.
 *  - `<Panel>` / `<Text>` are ordinary visual containers and may be added under
 *    `View`, `Panel`, or `Text`.
 *
 * Returned in a stable, human-sensible order (containers first, then Event) so the
 * context menu reads the same every time.
 */
export function allowedChildTags(parentTag: GuiTag): GuiTag[] {
  switch (parentTag) {
    case "View":
      // Visual children plus the View-only <Event> and nestable <Component>.
      return ["Panel", "Text", "Component", "Event"];
    case "Panel":
    case "Text":
      // Visual containers: any box-producing child, but NOT a top-level <Event>.
      return ["Panel", "Text", "Component"];
    case "Component":
    case "Event":
      // <Component> is childless by rule; <Event> is a leaf registration.
      return [];
    default: {
      const _never: never = parentTag;
      return _never;
    }
  }
}

/** Whether a child of `childTag` may be added under a parent of `parentTag`. */
export function canAddChild(parentTag: GuiTag, childTag: GuiTag): boolean {
  return allowedChildTags(parentTag).includes(childTag);
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
 *
 * `id` is intentionally left UNSET — the local id is the user's to choose in the
 * Properties panel (F9b); the design's computed-id is derived from the hierarchy,
 * not auto-minted here.
 */
export function makeChildNode(tag: GuiTag, src?: string): GuiNode {
  const node: GuiNode = { nodeId: mintNodeId(), tag, attrs: {}, children: [] };
  switch (tag) {
    case "Panel":
      node.attrs = { position: "0,0,0,0", size: "0,0,100,100" };
      break;
    case "Text":
      node.attrs = { position: "0,0,0,0", size: "0,0,100,32", text: "Text" };
      break;
    case "Component":
      node.attrs = { src: src ?? "", position: "0,0,0,0", size: "0,0,100,100" };
      break;
    case "Event":
      node.attrs = { name: "", handler: "" };
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
