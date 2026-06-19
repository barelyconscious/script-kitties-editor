import { describe, expect, it } from "vitest";
import type { GuiNode } from "../../lib/guiNode";
import {
  ELEMENT_LOCKS_KEY,
  getPersistedLocks,
  lockedKeysFor,
  type LockStorage,
  nodeIdsForKeys,
  nodeIndexPath,
  setPersistedLocks,
} from "./elementLockStore";

function node(nodeId: string, children: GuiNode[] = []): GuiNode {
  return { nodeId, tag: "Panel", attrs: {}, children };
}

/**
 * A small tree:
 *   root
 *   ├─ a
 *   │  └─ a0
 *   └─ b
 */
function tree(): GuiNode {
  return node("root", [node("a", [node("a0")]), node("b")]);
}

/** An in-memory Storage stand-in satisfying the injected surface. */
function memStorage(initial: Record<string, string> = {}): LockStorage & { dump: Record<string, string> } {
  const dump = { ...initial };
  return {
    dump,
    getItem: (k: string) => (k in dump ? dump[k] : null),
    setItem: (k: string, v: string) => {
      dump[k] = v;
    },
  };
}

describe("nodeIndexPath — stable structural key", () => {
  it("returns the empty string for the root", () => {
    expect(nodeIndexPath(tree(), "root")).toBe("");
  });

  it("returns the dotted child-index path for descendants", () => {
    expect(nodeIndexPath(tree(), "a")).toBe("0");
    expect(nodeIndexPath(tree(), "b")).toBe("1");
    expect(nodeIndexPath(tree(), "a0")).toBe("0.0");
  });

  it("returns null for a nodeId not in the tree", () => {
    expect(nodeIndexPath(tree(), "missing")).toBeNull();
  });
});

describe("lockedKeysFor / nodeIdsForKeys — round-trip across re-mint", () => {
  it("maps locked nodeIds to keys in document order", () => {
    expect(lockedKeysFor(tree(), new Set(["a0", "b"]))).toEqual(["0.0", "1"]);
  });

  it("skips locked nodeIds no longer present (self-pruning)", () => {
    expect(lockedKeysFor(tree(), new Set(["a", "gone"]))).toEqual(["0"]);
  });

  it("resolves persisted keys back to the CURRENT tree's nodeIds", () => {
    // Simulate a re-parse: identical structure, different nodeIds.
    const reparsed = node("R", [node("A", [node("A0")]), node("B")]);
    const keys = lockedKeysFor(tree(), new Set(["a0", "b"])); // ["0.0", "1"]
    expect(nodeIdsForKeys(reparsed, keys)).toEqual(new Set(["A0", "B"]));
  });

  it("drops keys that no longer address a node", () => {
    expect(nodeIdsForKeys(tree(), ["0.0", "5", "0.9", "bad"])).toEqual(new Set(["a0"]));
  });
});

describe("getPersistedLocks / setPersistedLocks", () => {
  it("returns [] when nothing is stored", () => {
    expect(getPersistedLocks("widgets/bag.xml", memStorage())).toEqual([]);
  });

  it("persists keys per component path, preserving other entries", () => {
    const store = memStorage();
    setPersistedLocks("a.xml", ["0", "1.2"], store);
    setPersistedLocks("b.xml", ["3"], store);
    expect(getPersistedLocks("a.xml", store)).toEqual(["0", "1.2"]);
    expect(getPersistedLocks("b.xml", store)).toEqual(["3"]);
  });

  it("removes the entry entirely when persisting an empty list", () => {
    const store = memStorage();
    setPersistedLocks("a.xml", ["0"], store);
    setPersistedLocks("a.xml", [], store);
    expect(getPersistedLocks("a.xml", store)).toEqual([]);
    expect(JSON.parse(store.dump[ELEMENT_LOCKS_KEY])).not.toHaveProperty("a.xml");
  });

  it("degrades to [] on a corrupt store rather than throwing", () => {
    const store = memStorage({ [ELEMENT_LOCKS_KEY]: "{not json" });
    expect(getPersistedLocks("a.xml", store)).toEqual([]);
  });

  it("drops malformed (non-string-array) entries defensively", () => {
    const store = memStorage({
      [ELEMENT_LOCKS_KEY]: JSON.stringify({ good: ["0"], bad: [1, 2], alsoBad: "x" }),
    });
    expect(getPersistedLocks("good", store)).toEqual(["0"]);
    expect(getPersistedLocks("bad", store)).toEqual([]);
    expect(getPersistedLocks("alsoBad", store)).toEqual([]);
  });
});
