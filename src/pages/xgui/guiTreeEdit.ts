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
 *  - `<Event>` gets empty `name`/`handler` the Events slice (F9c) fills in.
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
