import { describe, expect, it } from "vitest";
import type { GuiNode } from "./guiNode";
import { findNodeById, isNodeSelected, NODE_ID_ATTR, nearestNodeId } from "./guiSelection";

/** A small hand-built tree for selection tests (no parser dependency). */
function makeTree(): GuiNode {
  const coin: GuiNode = { nodeId: "n3", tag: "Panel", attrs: { id: "coin" }, children: [] };
  const money: GuiNode = { nodeId: "n4", tag: "Text", attrs: { id: "money" }, children: [] };
  const moneyBg: GuiNode = {
    nodeId: "n2",
    tag: "Panel",
    attrs: { id: "moneyBg" },
    children: [coin, money],
  };
  const root: GuiNode = {
    nodeId: "n1",
    tag: "View",
    attrs: {},
    children: [moneyBg],
  };
  return root;
}

describe("nearestNodeId", () => {
  it("returns the innermost id (closest box to the click)", () => {
    // Click landed on a child; chain is innermost-first.
    expect(nearestNodeId(["n4", "n2", "n1"])).toBe("n4");
  });

  it("skips ancestors with no node id (intermediate non-box elements)", () => {
    // A click on a text span (no data-node-id) inside panel n2 resolves to n2.
    expect(nearestNodeId([null, undefined, "n2", "n1"])).toBe("n2");
  });

  it("skips empty-string ids", () => {
    expect(nearestNodeId(["", "n2"])).toBe("n2");
  });

  it("returns null when no ancestor carries an id (clicked the bare stage)", () => {
    expect(nearestNodeId([null, undefined])).toBeNull();
    expect(nearestNodeId([])).toBeNull();
  });

  it("returns the single candidate when given a one-element chain", () => {
    // Mirrors the runtime path: closest() yields at most one matched box.
    expect(nearestNodeId(["n3"])).toBe("n3");
    expect(nearestNodeId([null])).toBeNull();
  });
});

describe("findNodeById", () => {
  const root = makeTree();

  it("finds the root itself", () => {
    expect(findNodeById(root, "n1")).toBe(root);
  });

  it("finds a deeply nested node", () => {
    expect(findNodeById(root, "n4")?.attrs.id).toBe("money");
  });

  it("returns null for an unknown id (e.g. stale selection)", () => {
    expect(findNodeById(root, "n999")).toBeNull();
  });

  it("returns null for a null id", () => {
    expect(findNodeById(root, null)).toBeNull();
  });
});

describe("isNodeSelected", () => {
  it("is true only when the ids match", () => {
    expect(isNodeSelected("n2", "n2")).toBe(true);
    expect(isNodeSelected("n2", "n3")).toBe(false);
  });

  it("is false when nothing is selected", () => {
    expect(isNodeSelected("n2", null)).toBe(false);
  });
});

describe("NODE_ID_ATTR", () => {
  it("is the data-node-id attribute the design specifies", () => {
    expect(NODE_ID_ATTR).toBe("data-node-id");
  });
});
