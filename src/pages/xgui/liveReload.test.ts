import { describe, expect, it } from "vitest";
import { type GuiNode, type GuiTag, parseGui } from "../../lib/guiNode";
import {
  changedPathIsOpenComponent,
  decideLiveReload,
  nodeIdAtIndexPath,
  nodeIndexPath,
  remapSelection,
} from "./liveReload";

function node(nodeId: string, tag: GuiTag, children: GuiNode[] = []): GuiNode {
  return { nodeId, tag, attrs: {}, children };
}

describe("decideLiveReload — the three reconciliation branches", () => {
  const base = { openName: "bag", openPath: "widgets/bag.xml", dirty: false };

  it("refresh-only when nothing is open (list still refreshes upstream)", () => {
    expect(
      decideLiveReload({ openName: null, openPath: null, dirty: false }, "widgets/bag.xml"),
    ).toBe("refresh-only");
  });

  it("refresh-only when the changed file is a DIFFERENT component", () => {
    expect(decideLiveReload(base, "widgets/shop.xml")).toBe("refresh-only");
  });

  it("refresh-only on a coarse (null-path) signal — never reload/stomp on ambiguity", () => {
    // A null payload means "something under gui/ changed" without attribution: the
    // list refreshes, but we never disturb the open document on a signal we can't
    // attribute to it.
    expect(decideLiveReload({ ...base, dirty: false }, null)).toBe("refresh-only");
    expect(decideLiveReload({ ...base, dirty: true }, null)).toBe("refresh-only");
  });

  it("reload-open when the OPEN component changed and the editor is CLEAN", () => {
    expect(decideLiveReload({ ...base, dirty: false }, "widgets/bag.xml")).toBe("reload-open");
  });

  it("notice-dirty when the OPEN component changed and the editor is DIRTY (no stomp)", () => {
    expect(decideLiveReload({ ...base, dirty: true }, "widgets/bag.xml")).toBe("notice-dirty");
  });
});

describe("changedPathIsOpenComponent", () => {
  it("matches the open component's exact .xml path", () => {
    expect(changedPathIsOpenComponent({ openPath: "widgets/bag.xml" }, "widgets/bag.xml")).toBe(
      true,
    );
  });

  it("is false for a different path, a null payload, or nothing open", () => {
    expect(changedPathIsOpenComponent({ openPath: "widgets/bag.xml" }, "widgets/shop.xml")).toBe(
      false,
    );
    expect(changedPathIsOpenComponent({ openPath: "widgets/bag.xml" }, null)).toBe(false);
    expect(changedPathIsOpenComponent({ openPath: null }, "widgets/bag.xml")).toBe(false);
  });
});

describe("nodeIndexPath / nodeIdAtIndexPath — structural addressing", () => {
  // root(n1) ─ a(n2) ─ a1(n4)
  //          └ b(n3)
  const tree = node("n1", "View", [node("n2", "Panel", [node("n4", "Text")]), node("n3", "Panel")]);

  it("addresses the root as the empty path", () => {
    expect(nodeIndexPath(tree, "n1")).toEqual([]);
    expect(nodeIdAtIndexPath(tree, [])).toBe("n1");
  });

  it("round-trips a nested node by child-index path", () => {
    const path = nodeIndexPath(tree, "n4");
    expect(path).toEqual([0, 0]);
    expect(nodeIdAtIndexPath(tree, path as number[])).toBe("n4");
  });

  it("addresses a second-child node", () => {
    expect(nodeIndexPath(tree, "n3")).toEqual([1]);
    expect(nodeIdAtIndexPath(tree, [1])).toBe("n3");
  });

  it("returns null for an unknown node id", () => {
    expect(nodeIndexPath(tree, "nope")).toBeNull();
  });

  it("returns null when an index path no longer addresses a node", () => {
    expect(nodeIdAtIndexPath(tree, [1, 0])).toBeNull(); // n3 has no children
    expect(nodeIdAtIndexPath(tree, [5])).toBeNull(); // out of range
  });
});

describe("remapSelection — preserve selection across a re-parse", () => {
  // parseGui re-mints nodeIds fresh every call, so the old selection's id is
  // meaningless against a freshly-parsed tree — selection must survive by POSITION.
  const xml = `
    <View>
      <Panel id="header">
        <Text id="title" />
      </Panel>
      <Panel id="body" />
    </View>`;

  it("preserves the selected node when it still exists after a re-parse", () => {
    const oldRoot = parseGui(xml);
    const newRoot = parseGui(xml); // same XML, brand-new nodeIds
    // Select the <Text id="title"> in the OLD tree (path [0,0]).
    const selected = nodeIdAtIndexPath(oldRoot, [0, 0]) as string;
    const remapped = remapSelection(oldRoot, newRoot, selected);
    // Remapped id is the NEW tree's id at the same structural position.
    expect(remapped).toBe(nodeIdAtIndexPath(newRoot, [0, 0]));
    // And it's genuinely a different id object than the old one (re-minted).
    expect(remapped).not.toBe(selected);
  });

  it("drops the selection when the selected node no longer exists after the edit", () => {
    const oldRoot = parseGui(xml);
    // The external edit removed the nested <Text> (and the second <Panel>).
    const newRoot = parseGui(`<View><Panel id="header" /></View>`);
    const selected = nodeIdAtIndexPath(oldRoot, [0, 0]) as string; // the <Text>
    expect(remapSelection(oldRoot, newRoot, selected)).toBeNull();
  });

  it("keeps a null selection null", () => {
    const root = node("n1", "View");
    expect(remapSelection(root, root, null)).toBeNull();
  });

  it("preserves the ROOT selection across a re-parse", () => {
    const oldRoot = parseGui(xml);
    const newRoot = parseGui(xml);
    expect(remapSelection(oldRoot, newRoot, oldRoot.nodeId)).toBe(newRoot.nodeId);
  });
});
