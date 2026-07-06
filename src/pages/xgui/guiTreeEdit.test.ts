import { describe, expect, it } from "vitest";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import type { GuiFolder } from "./guiTree";
import {
  addChild,
  allowedChildTags,
  canAddChild,
  canMoveTo,
  componentPickItems,
  EVENT_PLACEHOLDER_LABEL,
  filterPickItems,
  findNode,
  makeChildNode,
  moveNode,
  nextAutoId,
  nodeLabel,
  nodePath,
  pruneNodes,
  removeNode,
  setNodeAttrs,
  treeNodePrimaryLabel,
} from "./guiTreeEdit";

function node(nodeId: string, tag: GuiTag, children: GuiNode[] = []): GuiNode {
  return { nodeId, tag, attrs: {}, children };
}

/** Child nodeIds under the node addressed by `parentId`, for terse assertions. */
function childIds(root: GuiNode, parentId: string): string[] {
  const parent = findNode(root, parentId);
  if (!parent) throw new Error(`no node ${parentId}`);
  return parent.children.map((c) => c.nodeId);
}

/** A node with explicit attrs, for label/attr-sensitive tests. */
function nodeWith(tag: GuiTag, attrs: Record<string, string>): GuiNode {
  return { nodeId: `${tag}-x`, tag, attrs, children: [] };
}

describe("nextAutoId — running auto-id for newly-added elements", () => {
  it("starts at 1 for the tag when no numeric ids exist", () => {
    const root = node("root", "View");
    expect(nextAutoId(root, "Panel")).toBe("Panel1");
    expect(nextAutoId(root, "Text")).toBe("Text1");
  });

  it("uses ONE running counter shared across tags (Panel1 then Text2)", () => {
    const root: GuiNode = {
      nodeId: "root",
      tag: "View",
      attrs: { id: "view" },
      children: [nodeWith("Panel", { id: "Panel1" })],
    };
    // The highest trailing number anywhere is 1, so the next id — whatever tag —
    // is …2, matching the intended Panel1 / Text2 sequence.
    expect(nextAutoId(root, "Text")).toBe("Text2");
  });

  it("scans the WHOLE tree and out-numbers the highest trailing number", () => {
    const root: GuiNode = {
      nodeId: "root",
      tag: "View",
      attrs: { id: "view" },
      children: [
        nodeWith("Panel", { id: "Panel1" }),
        {
          nodeId: "p2",
          tag: "Panel",
          attrs: { id: "Panel2" },
          children: [nodeWith("Text", { id: "Text7" })],
        },
      ],
    };
    expect(nextAutoId(root, "Panel")).toBe("Panel8");
  });

  it("ignores ids that don't end in a number (renamed ids never seed a collision)", () => {
    const root: GuiNode = {
      nodeId: "root",
      tag: "View",
      attrs: { id: "view" },
      children: [nodeWith("Panel", { id: "healthBar" }), nodeWith("Text", { id: "title" })],
    };
    expect(nextAutoId(root, "Panel")).toBe("Panel1");
  });

  it("respects an explicit numbered id so the next auto-id won't collide with it", () => {
    const root: GuiNode = {
      nodeId: "root",
      tag: "View",
      attrs: { id: "view" },
      children: [nodeWith("Panel", { id: "Panel7" })],
    };
    expect(nextAutoId(root, "Panel")).toBe("Panel8");
  });
});

describe("allowedChildTags / canAddChild — element rules (children-aware)", () => {
  it("an empty View accepts Panel, Text, Component, GridLayout, and Event", () => {
    expect(allowedChildTags(node("v", "View"))).toEqual([
      "Panel",
      "Text",
      "Component",
      "GridLayout",
      "Event",
    ]);
  });

  it("an empty Panel accepts boxes plus a GridLayout, but NOT Event (Event is View-only)", () => {
    const panel = node("p", "Panel");
    expect(allowedChildTags(panel)).toEqual(["Panel", "Text", "Component", "GridLayout"]);
    expect(canAddChild(panel, "Event")).toBe(false);
  });

  it("Text is a leaf — no children (nesting under a Text is a runtime parse error)", () => {
    const text = node("t", "Text");
    expect(allowedChildTags(text)).toEqual([]);
    expect(canAddChild(text, "Panel")).toBe(false);
    expect(canAddChild(text, "Text")).toBe(false);
    expect(canAddChild(text, "Component")).toBe(false);
    expect(canAddChild(text, "GridLayout")).toBe(false);
    expect(canAddChild(text, "Event")).toBe(false);
  });

  it("Component cannot have children", () => {
    expect(allowedChildTags(node("c", "Component"))).toEqual([]);
    expect(canAddChild(node("c", "Component"), "Panel")).toBe(false);
  });

  it("Event is a leaf — no children", () => {
    expect(allowedChildTags(node("e", "Event"))).toEqual([]);
  });

  it("View is never offered as a child of anything (top-level only)", () => {
    for (const tag of ["View", "Panel", "Text", "Component", "Event", "GridLayout"] as GuiTag[]) {
      expect(allowedChildTags(node("x", tag))).not.toContain("View");
    }
  });

  it("Event is allowed only under View", () => {
    expect(canAddChild(node("v", "View"), "Event")).toBe(true);
    expect(canAddChild(node("p", "Panel"), "Event")).toBe(false);
    expect(canAddChild(node("c", "Component"), "Event")).toBe(false);
  });

  it("a Panel/View that ALREADY contains a GridLayout no longer offers GridLayout", () => {
    const panelWithGrid = node("p", "Panel", [node("g", "GridLayout")]);
    expect(allowedChildTags(panelWithGrid)).toEqual(["Panel", "Text", "Component"]);
    expect(canAddChild(panelWithGrid, "GridLayout")).toBe(false);

    const viewWithGrid = node("v", "View", [node("g", "GridLayout")]);
    expect(allowedChildTags(viewWithGrid)).toEqual(["Panel", "Text", "Component", "Event"]);
    expect(canAddChild(viewWithGrid, "GridLayout")).toBe(false);
  });

  it("an EMPTY GridLayout offers its single child tags (Panel, Text, Component)", () => {
    expect(allowedChildTags(node("g", "GridLayout"))).toEqual(["Panel", "Text", "Component"]);
  });

  it("a GridLayout that already has a child offers NOTHING (no +)", () => {
    const gridWithChild = node("g", "GridLayout", [node("p", "Panel")]);
    expect(allowedChildTags(gridWithChild)).toEqual([]);
    expect(canAddChild(gridWithChild, "Panel")).toBe(false);
  });

  it("never offers a nested GridLayout under a GridLayout", () => {
    expect(allowedChildTags(node("g", "GridLayout"))).not.toContain("GridLayout");
  });
});

describe("nodeLabel — tree row labeling", () => {
  it("labels an <Event> by its name attribute (events have no id)", () => {
    const ev = nodeWith("Event", { name: "Battle:OnCreatureDied", handler: "onDied" });
    expect(nodeLabel(ev)).toEqual({ tag: "Event", secondary: "Battle:OnCreatureDied" });
  });

  it("uses the placeholder when an <Event> name is empty or whitespace", () => {
    expect(nodeLabel(nodeWith("Event", { name: "", handler: "" })).secondary).toBe(
      EVENT_PLACEHOLDER_LABEL,
    );
    expect(nodeLabel(nodeWith("Event", { name: "   " })).secondary).toBe(EVENT_PLACEHOLDER_LABEL);
    // A missing name attr (not just empty) also falls back to the placeholder.
    expect(nodeLabel(nodeWith("Event", {})).secondary).toBe(EVENT_PLACEHOLDER_LABEL);
  });

  it("ignores an <Event> id even if one is somehow present (events label by name)", () => {
    const ev = nodeWith("Event", { id: "evt1", name: "Tick" });
    expect(nodeLabel(ev).secondary).toBe("Tick");
  });

  it("labels non-Event tags by their trimmed id", () => {
    expect(nodeLabel(nodeWith("Panel", { id: "  stats " })).secondary).toBe("stats");
    expect(nodeLabel(nodeWith("View", { id: "view" }))).toEqual({ tag: "View", secondary: "view" });
  });

  it("gives a non-Event node with no id a null secondary label", () => {
    expect(nodeLabel(nodeWith("Panel", {})).secondary).toBeNull();
    expect(nodeLabel(nodeWith("Text", { id: "  " })).secondary).toBeNull();
  });
});

describe("treeNodePrimaryLabel — id-as-identity tree label", () => {
  it("labels a non-Event node by its trimmed id (replacing the tag name)", () => {
    expect(treeNodePrimaryLabel(nodeWith("Panel", { id: " Panel1 " }))).toEqual({
      text: "Panel1",
      placeholder: false,
    });
  });

  it("falls back to the bare tag name when a non-Event node has no id", () => {
    expect(treeNodePrimaryLabel(nodeWith("Panel", {}))).toEqual({
      text: "Panel",
      placeholder: false,
    });
    expect(treeNodePrimaryLabel(nodeWith("Text", { id: "  " }))).toEqual({
      text: "Text",
      placeholder: false,
    });
  });

  it("labels an <Event> by its name, flagging the placeholder when blank", () => {
    expect(treeNodePrimaryLabel(nodeWith("Event", { name: "Tick" }))).toEqual({
      text: "Tick",
      placeholder: false,
    });
    expect(treeNodePrimaryLabel(nodeWith("Event", {}))).toEqual({
      text: EVENT_PLACEHOLDER_LABEL,
      placeholder: true,
    });
  });
});

describe("makeChildNode", () => {
  it("mints a fresh, unique nodeId per node", () => {
    const a = makeChildNode("Panel");
    const b = makeChildNode("Panel");
    expect(a.nodeId).not.toBe(b.nodeId);
  });

  it("Panel gets default geometry and no children", () => {
    const n = makeChildNode("Panel");
    expect(n.tag).toBe("Panel");
    expect(n.attrs.position).toBe("0,0,0,0");
    expect(n.attrs.size).toBeDefined();
    expect(n.children).toEqual([]);
  });

  it("Text gets placeholder text so it paints", () => {
    expect(makeChildNode("Text").attrs.text).toBe("Text");
  });

  it("Component carries the chosen src basename and stays childless", () => {
    const n = makeChildNode("Component", "bag_slot");
    expect(n.attrs.src).toBe("bag_slot");
    expect(n.children).toEqual([]);
  });

  it("Component defaults src to empty when none supplied", () => {
    expect(makeChildNode("Component").attrs.src).toBe("");
  });

  it("Event gets empty name/handler for the Events slice to fill", () => {
    const n = makeChildNode("Event");
    expect(n.attrs).toEqual({ name: "", handler: "" });
  });

  it("does NOT auto-set the local id attribute (user chooses it in Properties)", () => {
    expect(makeChildNode("Panel").attrs.id).toBeUndefined();
  });

  it("GridLayout gets rows=1/columns=1, no id, and no geometry", () => {
    const n = makeChildNode("GridLayout");
    expect(n.tag).toBe("GridLayout");
    expect(n.attrs).toEqual({ rows: "1", columns: "1" });
    expect(n.attrs.id).toBeUndefined();
    expect(n.attrs.position).toBeUndefined();
    expect(n.attrs.size).toBeUndefined();
    expect(n.children).toEqual([]);
  });

  it("omits default position/size for a child created UNDER a GridLayout", () => {
    const panel = makeChildNode("Panel", undefined, "GridLayout");
    expect(panel.attrs.position).toBeUndefined();
    expect(panel.attrs.size).toBeUndefined();
    expect(panel.attrs).toEqual({});

    const text = makeChildNode("Text", undefined, "GridLayout");
    expect(text.attrs.position).toBeUndefined();
    expect(text.attrs.size).toBeUndefined();
    expect(text.attrs).toEqual({ text: "Text" });

    const comp = makeChildNode("Component", "bag_slot", "GridLayout");
    expect(comp.attrs.position).toBeUndefined();
    expect(comp.attrs.size).toBeUndefined();
    expect(comp.attrs).toEqual({ src: "bag_slot" });
  });

  it("keeps default geometry for a child created under a non-grid parent", () => {
    const panel = makeChildNode("Panel", undefined, "View");
    expect(panel.attrs.position).toBe("0,0,0,0");
    expect(panel.attrs.size).toBeDefined();
  });
});

describe("addChild — immutable tree mutation", () => {
  it("appends the child under the matching node", () => {
    const root = node("root", "View", [node("a", "Panel")]);
    const child = makeChildNode("Text");
    const next = addChild(root, "a", child);
    const a = next.children[0];
    expect(a.children).toHaveLength(1);
    expect(a.children[0]).toBe(child);
  });

  it("appends to the root itself when the root is the parent", () => {
    const root = node("root", "View");
    const child = makeChildNode("Panel");
    const next = addChild(root, "root", child);
    expect(next.children).toEqual([child]);
    expect(next).not.toBe(root); // fresh root
  });

  it("appends as the LAST child (preserves order)", () => {
    const root = node("root", "View", [node("a", "Panel"), node("b", "Text")]);
    const child = makeChildNode("Panel");
    const next = addChild(root, "root", child);
    expect(next.children.map((c) => c.nodeId)).toEqual(["a", "b", child.nodeId]);
  });

  it("reaches a deeply nested parent", () => {
    const root = node("root", "View", [node("a", "Panel", [node("b", "Panel")])]);
    const child = makeChildNode("Text");
    const next = addChild(root, "b", child);
    expect(next.children[0].children[0].children[0]).toBe(child);
  });

  it("returns the SAME root reference (no-op) when the parent is not found", () => {
    const root = node("root", "View", [node("a", "Panel")]);
    expect(addChild(root, "missing", makeChildNode("Panel"))).toBe(root);
  });

  it("reuses untouched sibling subtrees by reference", () => {
    const sibling = node("sib", "Panel", [node("deep", "Text")]);
    const root = node("root", "View", [node("a", "Panel"), sibling]);
    const next = addChild(root, "a", makeChildNode("Text"));
    // The sibling branch was not on the mutation path — reused as-is.
    expect(next.children[1]).toBe(sibling);
    // The mutated branch is a fresh object.
    expect(next.children[0]).not.toBe(root.children[0]);
  });

  it("does not mutate the original tree", () => {
    const root = node("root", "View", [node("a", "Panel")]);
    addChild(root, "a", makeChildNode("Text"));
    expect(root.children[0].children).toEqual([]);
  });
});

describe("setNodeAttrs — immutable attr replace", () => {
  function attrNode(
    nodeId: string,
    tag: GuiTag,
    attrs: Record<string, string>,
    children: GuiNode[] = [],
  ): GuiNode {
    return { nodeId, tag, attrs, children };
  }

  it("replaces the matching node's attrs, preserving tag/nodeId/children", () => {
    const child = attrNode("c", "Text", {});
    const root = attrNode("root", "View", { id: "view" }, [
      attrNode("a", "Panel", { id: "old" }, [child]),
    ]);
    const next = setNodeAttrs(root, "a", { id: "new", position: "0,0,0,0" });
    const a = next.children[0];
    expect(a.attrs).toEqual({ id: "new", position: "0,0,0,0" });
    expect(a.tag).toBe("Panel");
    expect(a.nodeId).toBe("a");
    expect(a.children[0]).toBe(child); // untouched subtree reused
  });

  it("replaces the root's attrs when the root matches", () => {
    const root = attrNode("root", "View", { id: "view" });
    const next = setNodeAttrs(root, "root", { id: "view", controller: "x.lua" });
    expect(next.attrs).toEqual({ id: "view", controller: "x.lua" });
    expect(next).not.toBe(root);
  });

  it("returns the SAME root reference (no-op) when the node is not found", () => {
    const root = attrNode("root", "View", {}, [attrNode("a", "Panel", {})]);
    expect(setNodeAttrs(root, "missing", { id: "x" })).toBe(root);
  });

  it("reuses untouched sibling subtrees by reference", () => {
    const sib = attrNode("sib", "Panel", { id: "sib" });
    const root = attrNode("root", "View", {}, [attrNode("a", "Panel", { id: "a" }), sib]);
    const next = setNodeAttrs(root, "a", { id: "changed" });
    expect(next.children[1]).toBe(sib);
    expect(next.children[0]).not.toBe(root.children[0]);
  });

  it("does not mutate the original node's attrs", () => {
    const root = attrNode("root", "View", {}, [attrNode("a", "Panel", { id: "a" })]);
    setNodeAttrs(root, "a", { id: "b" });
    expect(root.children[0].attrs).toEqual({ id: "a" });
  });
});

describe("removeNode — immutable detach (F9c Event delete)", () => {
  it("removes a matching child, preserving sibling order", () => {
    const root = node("root", "View", [
      node("e1", "Event"),
      node("e2", "Event"),
      node("e3", "Event"),
    ]);
    const next = removeNode(root, "e2");
    expect(next.children.map((c) => c.nodeId)).toEqual(["e1", "e3"]);
  });

  it("removes a deeply nested node", () => {
    const root = node("root", "View", [node("a", "Panel", [node("b", "Text")])]);
    const next = removeNode(root, "b");
    expect(next.children[0].children).toEqual([]);
  });

  it("never removes the root itself (returns the SAME reference)", () => {
    const root = node("root", "View", [node("a", "Panel")]);
    expect(removeNode(root, "root")).toBe(root);
  });

  it("returns the SAME root reference (no-op) when the node is not found", () => {
    const root = node("root", "View", [node("a", "Panel")]);
    expect(removeNode(root, "missing")).toBe(root);
  });

  it("reuses untouched sibling subtrees by reference", () => {
    const sib = node("sib", "Panel", [node("deep", "Text")]);
    const root = node("root", "View", [node("a", "Panel", [node("target", "Text")]), sib]);
    const next = removeNode(root, "target");
    // The sibling branch was not on the removal path — reused as-is.
    expect(next.children[1]).toBe(sib);
    // The mutated branch is a fresh object.
    expect(next.children[0]).not.toBe(root.children[0]);
  });

  it("does not mutate the original tree", () => {
    const root = node("root", "View", [node("a", "Panel"), node("b", "Text")]);
    removeNode(root, "b");
    expect(root.children.map((c) => c.nodeId)).toEqual(["a", "b"]);
  });
});

describe("pruneNodes — multi-node render-only prune (editor visibility)", () => {
  it("drops every listed node AND its subtree, keeping the rest in order", () => {
    const root = node("root", "View", [
      node("a", "Panel", [node("a1", "Text")]),
      node("b", "Panel"),
      node("c", "Panel"),
    ]);
    const next = pruneNodes(root, new Set(["a", "c"]));
    expect(next.children.map((n) => n.nodeId)).toEqual(["b"]);
  });

  it("prunes a deeply nested node without touching its siblings", () => {
    const root = node("root", "View", [node("a", "Panel", [node("x", "Text"), node("y", "Text")])]);
    const next = pruneNodes(root, new Set(["x"]));
    expect(next.children[0].children.map((n) => n.nodeId)).toEqual(["y"]);
  });

  it("returns the SAME root reference when nothing is hidden (empty set or no match)", () => {
    const root = node("root", "View", [node("a", "Panel")]);
    expect(pruneNodes(root, new Set())).toBe(root);
    expect(pruneNodes(root, new Set(["missing"]))).toBe(root);
  });

  it("reuses untouched sibling subtrees by reference; does not mutate the original", () => {
    const sib = node("sib", "Panel", [node("deep", "Text")]);
    const root = node("root", "View", [node("a", "Panel", [node("t", "Text")]), sib]);
    const next = pruneNodes(root, new Set(["t"]));
    expect(next.children[1]).toBe(sib);
    expect(root.children[0].children.map((n) => n.nodeId)).toEqual(["t"]); // original intact
  });
});

describe("nodePath", () => {
  it("returns the root→target chain", () => {
    const target = node("deep", "Text");
    const root = node("root", "View", [node("a", "Panel", [target])]);
    const path = nodePath(root, "deep");
    expect(path?.map((n) => n.nodeId)).toEqual(["root", "a", "deep"]);
  });

  it("returns just the root when the root is the target", () => {
    const root = node("root", "View");
    expect(nodePath(root, "root")).toEqual([root]);
  });

  it("returns null when the node is absent", () => {
    expect(nodePath(node("root", "View"), "nope")).toBeNull();
  });
});

describe("findNode", () => {
  it("finds the root", () => {
    const root = node("root", "View");
    expect(findNode(root, "root")).toBe(root);
  });

  it("finds a nested node", () => {
    const target = node("deep", "Text");
    const root = node("root", "View", [node("a", "Panel", [target])]);
    expect(findNode(root, "deep")).toBe(target);
  });

  it("returns null when absent", () => {
    expect(findNode(node("root", "View"), "nope")).toBeNull();
  });
});

describe("componentPickItems / filterPickItems", () => {
  const tree: GuiFolder = {
    name: "",
    path: "",
    folders: [
      {
        name: "widgets",
        path: "widgets",
        folders: [],
        components: [
          {
            name: "bag_slot",
            fileName: "bag_slot.xml",
            path: "widgets/bag_slot.xml",
            kind: "widget",
            controllerFileName: null,
          },
        ],
      },
    ],
    components: [
      {
        name: "battle",
        fileName: "battle.xml",
        path: "battle.xml",
        kind: "view",
        controllerFileName: null,
      },
    ],
  };

  it("spans the whole tree and sorts by basename", () => {
    const items = componentPickItems(tree);
    expect(items.map((i) => i.name)).toEqual(["bag_slot", "battle"]);
  });

  it("carries the folder hint (root is empty string)", () => {
    const items = componentPickItems(tree);
    expect(items.find((i) => i.name === "bag_slot")?.folder).toBe("widgets");
    expect(items.find((i) => i.name === "battle")?.folder).toBe("");
  });

  it("filters by basename substring (case-insensitive)", () => {
    const items = componentPickItems(tree);
    expect(filterPickItems(items, "BAG").map((i) => i.name)).toEqual(["bag_slot"]);
  });

  it("filters by folder hint too", () => {
    const items = componentPickItems(tree);
    expect(filterPickItems(items, "widgets").map((i) => i.name)).toEqual(["bag_slot"]);
  });

  it("returns the full list for an empty query", () => {
    const items = componentPickItems(tree);
    expect(filterPickItems(items, "  ")).toEqual(items);
  });
});

describe("moveNode — immutable re-parent / reorder", () => {
  // A flat View with four Panel siblings, for reorder-within-parent cases.
  const flat = (): GuiNode =>
    node("root", "View", [
      node("a", "Panel"),
      node("b", "Panel"),
      node("c", "Panel"),
      node("d", "Panel"),
    ]);

  it("reorders EARLIER within a parent (index in the current array)", () => {
    // Move d (idx 3) to index 1 → before b.
    const next = moveNode(flat(), "d", "root", 1);
    expect(childIds(next, "root")).toEqual(["a", "d", "b", "c"]);
  });

  it("reorders LATER within a parent, handling the remove-then-insert shift", () => {
    // Move a (idx 0) to index 2 (current-array slot of c) → a lands before c.
    const next = moveNode(flat(), "a", "root", 2);
    expect(childIds(next, "root")).toEqual(["b", "a", "c", "d"]);
  });

  it("appends within a parent when index is the current length (later move)", () => {
    // Move b (idx 1) to index 4 (== length) → append.
    const next = moveNode(flat(), "b", "root", 4);
    expect(childIds(next, "root")).toEqual(["a", "c", "d", "b"]);
  });

  it("clamps an over-large index to append", () => {
    const next = moveNode(flat(), "a", "root", 99);
    expect(childIds(next, "root")).toEqual(["b", "c", "d", "a"]);
  });

  it("is a NO-OP (same root reference) when the node would land on its own slot", () => {
    const root = flat();
    // Move b (idx 1) to index 1 (before itself) and to index 2 (before c) — both
    // leave b exactly where it is.
    expect(moveNode(root, "b", "root", 1)).toBe(root);
    expect(moveNode(root, "b", "root", 2)).toBe(root);
  });

  it("re-parents a node ACROSS parents at the requested index", () => {
    const root = node("root", "View", [
      node("p1", "Panel", [node("x", "Text"), node("y", "Text")]),
      node("p2", "Panel", [node("z", "Text")]),
    ]);
    // Move x out of p1 and into p2 at index 0 → before z.
    const next = moveNode(root, "x", "p2", 0);
    expect(childIds(next, "p1")).toEqual(["y"]);
    expect(childIds(next, "p2")).toEqual(["x", "z"]);
  });

  it("moves the WHOLE subtree and preserves its node objects (nodeIds survive)", () => {
    const grandchild = node("gc", "Text");
    const movingSubtree = node("p1", "Panel", [grandchild]);
    const root = node("root", "View", [movingSubtree, node("p2", "Panel")]);
    const next = moveNode(root, "p1", "p2", 0);
    const moved = findNode(next, "p1");
    // Same object identity for the moved subtree AND its descendant.
    expect(moved).toBe(movingSubtree);
    expect(moved?.children[0]).toBe(grandchild);
    expect(childIds(next, "p2")).toEqual(["p1"]);
  });

  it("re-parents a node UP to an ancestor (target unaffected by the removal)", () => {
    const root = node("root", "View", [
      node("p1", "Panel", [node("inner", "Panel", [node("t", "Text")])]),
    ]);
    // Move t up two levels to become a child of root at index 0.
    const next = moveNode(root, "t", "root", 0);
    expect(childIds(next, "root")).toEqual(["t", "p1"]);
    expect(childIds(next, "inner")).toEqual([]);
  });

  it("does not mutate the original tree", () => {
    const root = flat();
    moveNode(root, "a", "root", 3);
    expect(childIds(root, "root")).toEqual(["a", "b", "c", "d"]);
  });

  it("is a no-op for the root, an unknown node, an unknown target, or a cycle", () => {
    const root = node("root", "View", [node("p", "Panel", [node("t", "Text")])]);
    expect(moveNode(root, "root", "p", 0)).toBe(root); // root immovable
    expect(moveNode(root, "ghost", "p", 0)).toBe(root); // unknown node
    expect(moveNode(root, "t", "ghost", 0)).toBe(root); // unknown target
    expect(moveNode(root, "p", "p", 0)).toBe(root); // self-target
    expect(moveNode(root, "p", "t", 0)).toBe(root); // into own descendant
  });
});

describe("canMoveTo — drop-legality predicate", () => {
  it("rejects moving the root", () => {
    const root = node("root", "View", [node("p", "Panel")]);
    expect(canMoveTo(root, "root", "p")).toBe(false);
  });

  it("rejects a self-target and a deep-descendant target (cycle)", () => {
    const root = node("root", "View", [
      node("p", "Panel", [node("inner", "Panel", [node("t", "Text")])]),
    ]);
    expect(canMoveTo(root, "p", "p")).toBe(false); // into itself
    expect(canMoveTo(root, "p", "inner")).toBe(false); // into a child
    expect(canMoveTo(root, "p", "t")).toBe(false); // into a deep descendant
  });

  it("allows an ordinary re-parent into a Panel", () => {
    const root = node("root", "View", [
      node("p1", "Panel", [node("t", "Text")]),
      node("p2", "Panel"),
    ]);
    expect(canMoveTo(root, "t", "p2")).toBe(true);
  });

  it("allows reordering a GridLayout within its OWN parent (self-exclusion)", () => {
    // The View already holds this grid; a same-parent reorder must not fail the
    // one-grid-per-container rule against the grid ITSELF.
    const root = node("root", "View", [node("g", "GridLayout"), node("p", "Panel")]);
    expect(canMoveTo(root, "g", "root")).toBe(true);
  });

  it("rejects moving a GridLayout into a container that ALREADY has a different grid", () => {
    const root = node("root", "View", [
      node("g1", "GridLayout"),
      node("p", "Panel", [node("g2", "GridLayout")]),
    ]);
    // p already has g2, so g1 cannot join it (one grid per container).
    expect(canMoveTo(root, "g1", "p")).toBe(false);
  });

  it("allows moving a Panel into an EMPTY grid but not an OCCUPIED one", () => {
    const root = node("root", "View", [
      node("panelA", "Panel"),
      node("empty", "GridLayout"),
      node("full", "GridLayout", [node("kid", "Panel")]),
    ]);
    expect(canMoveTo(root, "panelA", "empty")).toBe(true);
    expect(canMoveTo(root, "panelA", "full")).toBe(false);
  });

  it("allows an Event only under the View, never under a Panel", () => {
    const root = node("root", "View", [node("p", "Panel"), node("e", "Event")]);
    expect(canMoveTo(root, "e", "root")).toBe(true); // self-exclusion: reorder under View
    expect(canMoveTo(root, "e", "p")).toBe(false); // Event not allowed under Panel
  });

  it("rejects any child under a leaf (Text / Component / Event)", () => {
    const root = node("root", "View", [
      node("t", "Text"),
      node("c", "Component"),
      node("e", "Event"),
      node("p", "Panel"),
    ]);
    expect(canMoveTo(root, "p", "t")).toBe(false);
    expect(canMoveTo(root, "p", "c")).toBe(false);
    expect(canMoveTo(root, "p", "e")).toBe(false);
  });

  it("rejects an unknown node or an unknown target", () => {
    const root = node("root", "View", [node("p", "Panel")]);
    expect(canMoveTo(root, "ghost", "root")).toBe(false);
    expect(canMoveTo(root, "p", "ghost")).toBe(false);
  });
});
