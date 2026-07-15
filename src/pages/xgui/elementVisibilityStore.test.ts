import { describe, expect, it } from "vitest";
import type { GuiNode } from "../../lib/guiNode";
import { ELEMENT_LOCKS_KEY, type LockStorage, setPersistedLocks } from "./elementLockStore";
import {
  ELEMENT_HIDDEN_KEY,
  getPersistedHidden,
  hiddenKeysFor,
  setPersistedHidden,
} from "./elementVisibilityStore";

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
function memStorage(
  initial: Record<string, string> = {},
): LockStorage & { dump: Record<string, string> } {
  const dump = { ...initial };
  return {
    dump,
    getItem: (k: string) => (k in dump ? dump[k] : null),
    setItem: (k: string, v: string) => {
      dump[k] = v;
    },
  };
}

describe("hiddenKeysFor — hidden nodeIds → structural keys", () => {
  it("maps a hidden set to its index-path keys in document order", () => {
    expect(hiddenKeysFor(tree(), new Set(["a0", "b"]))).toEqual(["0.0", "1"]);
  });

  it("skips a hidden nodeId that is no longer in the tree", () => {
    expect(hiddenKeysFor(tree(), new Set(["a", "gone"]))).toEqual(["0"]);
  });
});

describe("getPersistedHidden / setPersistedHidden", () => {
  it("returns [] when nothing is stored", () => {
    expect(getPersistedHidden("widgets/bag.xml", memStorage())).toEqual([]);
  });

  it("round-trips per component path", () => {
    const store = memStorage();
    setPersistedHidden("a.xml", ["0", "1.2"], store);
    setPersistedHidden("b.xml", ["3"], store);
    expect(getPersistedHidden("a.xml", store)).toEqual(["0", "1.2"]);
    expect(getPersistedHidden("b.xml", store)).toEqual(["3"]);
  });

  it("removes the entry entirely when set to an empty list", () => {
    const store = memStorage();
    setPersistedHidden("a.xml", ["0"], store);
    setPersistedHidden("a.xml", [], store);
    expect(getPersistedHidden("a.xml", store)).toEqual([]);
  });

  it("persists hides under its own key, independent of locks", () => {
    const store = memStorage();
    setPersistedLocks("a.xml", ["0"], store);
    setPersistedHidden("a.xml", ["1"], store);
    // Two distinct localStorage keys — one concern can't clobber the other.
    expect(store.dump[ELEMENT_LOCKS_KEY]).toBeDefined();
    expect(store.dump[ELEMENT_HIDDEN_KEY]).toBeDefined();
    expect(getPersistedHidden("a.xml", store)).toEqual(["1"]);
  });
});
