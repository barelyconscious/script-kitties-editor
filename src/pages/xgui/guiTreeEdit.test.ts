import { describe, expect, it } from "vitest";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import type { GuiFolder } from "./guiTree";
import {
  addChild,
  allowedChildTags,
  canAddChild,
  componentPickItems,
  filterPickItems,
  findNode,
  makeChildNode,
  nodePath,
  setNodeAttrs,
} from "./guiTreeEdit";

function node(nodeId: string, tag: GuiTag, children: GuiNode[] = []): GuiNode {
  return { nodeId, tag, attrs: {}, children };
}

describe("allowedChildTags / canAddChild — element rules", () => {
  it("View accepts Panel, Text, Component, and Event", () => {
    expect(allowedChildTags("View")).toEqual(["Panel", "Text", "Component", "Event"]);
  });

  it("Panel and Text accept boxes but NOT Event (Event is View-only)", () => {
    expect(allowedChildTags("Panel")).toEqual(["Panel", "Text", "Component"]);
    expect(allowedChildTags("Text")).toEqual(["Panel", "Text", "Component"]);
    expect(canAddChild("Panel", "Event")).toBe(false);
    expect(canAddChild("Text", "Event")).toBe(false);
  });

  it("Component cannot have children", () => {
    expect(allowedChildTags("Component")).toEqual([]);
    expect(canAddChild("Component", "Panel")).toBe(false);
  });

  it("Event is a leaf — no children", () => {
    expect(allowedChildTags("Event")).toEqual([]);
  });

  it("View is never offered as a child of anything (top-level only)", () => {
    for (const parent of ["View", "Panel", "Text", "Component", "Event"] as GuiTag[]) {
      expect(allowedChildTags(parent)).not.toContain("View");
    }
  });

  it("Event is allowed only under View", () => {
    expect(canAddChild("View", "Event")).toBe(true);
    expect(canAddChild("Panel", "Event")).toBe(false);
    expect(canAddChild("Component", "Event")).toBe(false);
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
