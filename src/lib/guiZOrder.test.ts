import { describe, expect, it } from "vitest";
import { parseGui } from "./guiNode";
import { ScopeStack } from "./guiScope";
import {
  assignZOrder,
  computeZOrder,
  DEFAULT_LAYER,
  flattenBoxes,
  makeBoxKey,
  resolveLayer,
} from "./guiZOrder";

/**
 * Parse XML into a tree and find the (single) box matching an `id` attribute, so
 * tests can refer to a box by its authored id and recover its session `nodeId`,
 * then build the BoxKey the flatten/render would.
 */
function parse(xml: string) {
  const root = parseGui(xml);
  const byId = new Map<string, string>(); // authored id → session nodeId
  const walk = (node: ReturnType<typeof parseGui>) => {
    if (node.attrs.id) byId.set(node.attrs.id, node.nodeId);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return { root, nodeId: (id: string) => byId.get(id) ?? `?${id}` };
}

describe("makeBoxKey", () => {
  it("starts a path from the stage with no parent prefix", () => {
    expect(makeBoxKey("", "n1", undefined)).toBe("n1");
  });

  it("appends a nodeId segment under a parent", () => {
    expect(makeBoxKey("n1", "n2", undefined)).toBe("n1/n2");
  });

  it("stamps a forEach instance key onto its segment", () => {
    expect(makeBoxKey("n1", "n2", "3")).toBe("n1/n2#3");
    expect(makeBoxKey("", "n2", "0")).toBe("n2#0");
  });
});

describe("resolveLayer", () => {
  const root = ScopeStack.root({ hi: 10, notNumber: "abc" });

  it("defaults to 0 when there is no layer attribute", () => {
    const node = { nodeId: "n", tag: "Panel" as const, attrs: {}, children: [] };
    expect(resolveLayer(node, root)).toBe(DEFAULT_LAYER);
  });

  it("reads a literal integer layer", () => {
    const node = { nodeId: "n", tag: "Panel" as const, attrs: { layer: "7" }, children: [] };
    expect(resolveLayer(node, root)).toBe(7);
  });

  it("resolves a bound {token} layer against the scope (layer is bindable)", () => {
    const node = { nodeId: "n", tag: "Panel" as const, attrs: { layer: "{hi}" }, children: [] };
    expect(resolveLayer(node, root)).toBe(10);
  });

  it("falls back to the default for an unresolved token", () => {
    const node = {
      nodeId: "n",
      tag: "Panel" as const,
      attrs: { layer: "{missing}" },
      children: [],
    };
    expect(resolveLayer(node, root)).toBe(DEFAULT_LAYER);
  });

  it("falls back to the default for a non-numeric resolved value", () => {
    const node = {
      nodeId: "n",
      tag: "Panel" as const,
      attrs: { layer: "{notNumber}" },
      children: [],
    };
    expect(resolveLayer(node, root)).toBe(DEFAULT_LAYER);
  });

  it("resolves a layer bound to the current forEach item, not the root", () => {
    const itemScope = ScopeStack.root({ z: 1 }).push({ z: 99 });
    const node = { nodeId: "n", tag: "Panel" as const, attrs: { layer: "{z}" }, children: [] };
    expect(resolveLayer(node, itemScope)).toBe(99);
  });
});

describe("flattenBoxes — document order + sibling-group structure", () => {
  it("walks visual boxes in pre-order (document order) and skips the View + Event", () => {
    const { root, nodeId } = parse(`
      <View>
        <Event name="OnX" handler="h"/>
        <Panel id="a">
          <Panel id="a1"/>
          <Text id="a2"/>
        </Panel>
        <Panel id="b"/>
      </View>
    `);
    const boxes = flattenBoxes(root);
    const aKey = makeBoxKey("", nodeId("a"), undefined);
    // View is the stage (not a box); Event is non-visual. a, a1, a2, b in order.
    expect(boxes.map((box) => box.boxKey)).toEqual([
      aKey,
      makeBoxKey(aKey, nodeId("a1"), undefined),
      makeBoxKey(aKey, nodeId("a2"), undefined),
      makeBoxKey("", nodeId("b"), undefined),
    ]);
  });

  it("records each box's parentKey (the sibling-group key)", () => {
    const { root, nodeId } = parse(`
      <View>
        <Panel id="a">
          <Panel id="a1"/>
          <Text id="a2"/>
        </Panel>
        <Panel id="b"/>
      </View>
    `);
    const boxes = flattenBoxes(root);
    const aKey = makeBoxKey("", nodeId("a"), undefined);
    const byKey = new Map(boxes.map((box) => [box.boxKey, box]));
    // a and b are stage children → parentKey "".
    expect(byKey.get(aKey)?.parentKey).toBe("");
    expect(byKey.get(makeBoxKey("", nodeId("b"), undefined))?.parentKey).toBe("");
    // a1 and a2 are children of a → parentKey === a's key.
    expect(byKey.get(makeBoxKey(aKey, nodeId("a1"), undefined))?.parentKey).toBe(aKey);
    expect(byKey.get(makeBoxKey(aKey, nodeId("a2"), undefined))?.parentKey).toBe(aKey);
  });

  it("numbers boxes by their position AMONG SIBLINGS (each group restarts at 0)", () => {
    const { root, nodeId } = parse(`
      <View>
        <Panel id="a">
          <Panel id="a1"/>
          <Text id="a2"/>
        </Panel>
        <Panel id="b"/>
      </View>
    `);
    const boxes = flattenBoxes(root);
    const aKey = makeBoxKey("", nodeId("a"), undefined);
    const byKey = new Map(boxes.map((box) => [box.boxKey, box]));
    // Stage children: a (0), b (1).
    expect(byKey.get(aKey)?.siblingIndex).toBe(0);
    expect(byKey.get(makeBoxKey("", nodeId("b"), undefined))?.siblingIndex).toBe(1);
    // a's children restart at 0: a1 (0), a2 (1).
    expect(byKey.get(makeBoxKey(aKey, nodeId("a1"), undefined))?.siblingIndex).toBe(0);
    expect(byKey.get(makeBoxKey(aKey, nodeId("a2"), undefined))?.siblingIndex).toBe(1);
  });

  it("captures the resolved layer per box (default 0)", () => {
    const { root } = parse(`
      <View>
        <Panel id="a" layer="5"/>
        <Panel id="b"/>
      </View>
    `);
    const boxes = flattenBoxes(root);
    expect(boxes.map((box) => box.resolvedLayer)).toEqual([5, 0]);
  });

  it("expands a forEach template into one box per item, in order, item-scoped", () => {
    const { root, nodeId } = parse(`
      <View>
        <Panel id="row" forEach="{rows}" layer="{z}"/>
      </View>
    `);
    const boxes = flattenBoxes(root, { rows: [{ z: 3 }, { z: 1 }, { z: 2 }] });
    expect(boxes).toHaveLength(3);
    // Each instance keyed positionally, layer resolved from its own item, and each
    // an adjacent sibling slot (siblingIndex 0,1,2) sharing parentKey "".
    expect(boxes.map((box) => box.boxKey)).toEqual([
      makeBoxKey("", nodeId("row"), "0"),
      makeBoxKey("", nodeId("row"), "1"),
      makeBoxKey("", nodeId("row"), "2"),
    ]);
    expect(boxes.map((box) => box.resolvedLayer)).toEqual([3, 1, 2]);
    expect(boxes.map((box) => box.siblingIndex)).toEqual([0, 1, 2]);
    expect(boxes.every((box) => box.parentKey === "")).toBe(true);
  });

  it("renders zero boxes for an empty/unresolved forEach collection", () => {
    const { root } = parse(`<View><Panel id="row" forEach="{rows}"/></View>`);
    expect(flattenBoxes(root, { rows: [] })).toHaveLength(0);
    expect(flattenBoxes(root, {})).toHaveLength(0);
  });
});

describe("assignZOrder — per-sibling-group (layer, doc-order) ranking", () => {
  it("ranks siblings by layer ascending, breaking ties by document order", () => {
    const map = assignZOrder([
      { boxKey: "k0", parentKey: "", resolvedLayer: 0, siblingIndex: 0 },
      { boxKey: "k1", parentKey: "", resolvedLayer: 10, siblingIndex: 1 },
      { boxKey: "k2", parentKey: "", resolvedLayer: 0, siblingIndex: 2 },
    ]);
    // Within the "" group: (0,0) k0, (0,2) k2, (10,1) k1 → ranks 0,1,2.
    expect(map.get("k0")).toBe(0);
    expect(map.get("k2")).toBe(1);
    expect(map.get("k1")).toBe(2);
  });

  it("ranks EACH sibling group independently (ranks restart per group)", () => {
    // Two groups: stage children (parentKey "") and a's children (parentKey "a").
    const map = assignZOrder([
      { boxKey: "a", parentKey: "", resolvedLayer: 0, siblingIndex: 0 },
      { boxKey: "b", parentKey: "", resolvedLayer: 5, siblingIndex: 1 },
      { boxKey: "a/x", parentKey: "a", resolvedLayer: 0, siblingIndex: 0 },
      { boxKey: "a/y", parentKey: "a", resolvedLayer: 9, siblingIndex: 1 },
    ]);
    // Stage group: a (rank 0) under b (rank 1).
    expect(map.get("a")).toBe(0);
    expect(map.get("b")).toBe(1);
    // a's children group: ranks restart at 0 — x (0) under y (1).
    expect(map.get("a/x")).toBe(0);
    expect(map.get("a/y")).toBe(1);
  });

  it("assigns a dense, distinct rank within each group (no z-index ties)", () => {
    const boxes = Array.from({ length: 5 }, (_, i) => ({
      boxKey: `k${i}`,
      parentKey: "",
      resolvedLayer: 0, // all equal layer → document order decides, ranks still distinct
      siblingIndex: i,
    }));
    const ranks = [...assignZOrder(boxes).values()].sort((a, b) => a - b);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("nested z-order — the intuitive model (replaces global-flat)", () => {
  it("paints a higher-layer element above its lower-layer sibling (overlap case)", () => {
    const { root, nodeId } = parse(`
      <View>
        <Panel id="low"  layer="0" position="0,0,0,0"   size="0,0,200,200"/>
        <Panel id="high" layer="5" position="0,0,100,100" size="0,0,200,200"/>
      </View>
    `);
    const map = computeZOrder(root);
    const lowKey = makeBoxKey("", nodeId("low"), undefined);
    const highKey = makeBoxKey("", nodeId("high"), undefined);
    // Higher layer → higher rank → paints on top, even though it overlaps `low`.
    expect(map.get(highKey) as number).toBeGreaterThan(map.get(lowKey) as number);
  });

  it("breaks ties between equal-layer siblings by document order (later on top)", () => {
    const { root, nodeId } = parse(`
      <View>
        <Panel id="first"  position="0,0,0,0"  size="0,0,200,200"/>
        <Panel id="second" position="0,0,50,50" size="0,0,200,200"/>
      </View>
    `);
    const map = computeZOrder(root);
    const firstKey = makeBoxKey("", nodeId("first"), undefined);
    const secondKey = makeBoxKey("", nodeId("second"), undefined);
    // Equal (default) layer → later in document order paints above.
    expect(map.get(secondKey) as number).toBeGreaterThan(map.get(firstKey) as number);
  });

  it("a container's layer lifts its WHOLE subtree above a lower-layer sibling subtree", () => {
    // groupHigh has a high layer; groupLow has a low layer. The nested model ranks
    // them as siblings, and because each box carries its own z-index its subtree is
    // contained in its stacking context — so groupHigh's child outranks groupLow at
    // the GROUP level (groupHigh > groupLow), lifting the whole subtree as a group.
    const { root, nodeId } = parse(`
      <View>
        <Panel id="groupLow" layer="0" position="0,0,0,0" size="0,0,400,400">
          <Panel id="lowChild" layer="50" position="0,0,0,0" size="0,0,200,200"/>
        </Panel>
        <Panel id="groupHigh" layer="5" position="0,0,100,100" size="0,0,400,400">
          <Panel id="highChild" layer="0" position="0,0,0,0" size="0,0,200,200"/>
        </Panel>
      </View>
    `);
    const map = computeZOrder(root);

    const lowKey = makeBoxKey("", nodeId("groupLow"), undefined);
    const highKey = makeBoxKey("", nodeId("groupHigh"), undefined);
    const lowChildKey = makeBoxKey(lowKey, nodeId("lowChild"), undefined);
    const highChildKey = makeBoxKey(highKey, nodeId("highChild"), undefined);

    // Container-level: groupHigh ranks above groupLow among the stage's children.
    expect(map.get(highKey) as number).toBeGreaterThan(map.get(lowKey) as number);

    // The grouping is what matters: lowChild's high (50) layer ranks it within
    // groupLow's context, but groupLow as a whole sits UNDER groupHigh — so the
    // child z-indexes are scoped to their parent group and never compete globally.
    // Both children rank 0 within their own (single-child) group; the SUBTREE
    // ordering is decided entirely by the parents' relative rank.
    expect(map.get(lowChildKey)).toBe(0);
    expect(map.get(highChildKey)).toBe(0);
    // groupHigh (the parent of highChild) > groupLow (parent of lowChild): the whole
    // groupHigh subtree paints above the whole groupLow subtree, regardless of the
    // very high layer on lowChild — that high layer only lifts it WITHIN groupLow.
    expect(map.get(highKey) as number).toBeGreaterThan(map.get(lowKey) as number);
  });

  it("does NOT let a deep high-layer box escape its branch (the supersede case)", () => {
    // The OLD global-flat model would float `deepHigh` (layer 10) above a shallow
    // sibling regardless of branch. The nested model deliberately does NOT: deepHigh
    // is ranked only among ITS siblings (it is the sole child of a2), so whether its
    // subtree paints above `shallow` is decided by branchA's rank vs shallow's rank.
    const { root, nodeId } = parse(`
      <View>
        <Panel id="branchA" layer="0" position="0,0,0,0" size="0,0,400,400">
          <Panel id="a1" position="0,0,20,20" size="0,0,360,360">
            <Panel id="a2" position="0,0,20,20" size="0,0,320,320">
              <Panel id="deepHigh" layer="10" position="0,0,40,40" size="0,0,240,240"/>
            </Panel>
          </Panel>
        </Panel>
        <Panel id="shallow" layer="0" position="0,0,120,120" size="0,0,240,240"/>
      </View>
    `);
    const map = computeZOrder(root);

    const branchAKey = makeBoxKey("", nodeId("branchA"), undefined);
    const a1Key = makeBoxKey(branchAKey, nodeId("a1"), undefined);
    const a2Key = makeBoxKey(a1Key, nodeId("a2"), undefined);
    const deepHighKey = makeBoxKey(a2Key, nodeId("deepHigh"), undefined);
    const shallowKey = makeBoxKey("", nodeId("shallow"), undefined);

    // deepHigh is the only child of a2 → rank 0 within its group; its high layer is
    // moot with no siblings. Its subtree is contained within branchA's context.
    expect(map.get(deepHighKey)).toBe(0);
    // At the stage level, branchA (layer 0, earlier) ranks UNDER shallow (layer 0,
    // later) by document order — so the entire branchA subtree (deepHigh included)
    // paints BELOW shallow. This is the intuitive, nested behavior.
    expect(map.get(shallowKey) as number).toBeGreaterThan(map.get(branchAKey) as number);
  });

  it("resolves a BOUND sibling layer before ranking (bound-layer-resolves-first)", () => {
    const { root, nodeId } = parse(`
      <View>
        <Panel id="low"  layer="0"            position="0,0,0,0"   size="0,0,200,200"/>
        <Panel id="high" layer="{topLayer}"   position="0,0,50,50" size="0,0,200,200"/>
      </View>
    `);
    const map = computeZOrder(root, { topLayer: 9 });
    const lowKey = makeBoxKey("", nodeId("low"), undefined);
    const highKey = makeBoxKey("", nodeId("high"), undefined);
    // The bound layer (9) resolves before ranking → high paints above low.
    expect(map.get(highKey) as number).toBeGreaterThan(map.get(lowKey) as number);
  });

  it("an unresolved bound layer falls back to the default (does not win)", () => {
    const { root, nodeId } = parse(`
      <View>
        <Panel id="early" layer="{missing}" position="0,0,0,0"  size="0,0,200,200"/>
        <Panel id="late"  layer="0"         position="0,0,50,50" size="0,0,200,200"/>
      </View>
    `);
    const map = computeZOrder(root, {}); // no `missing` field
    const earlyKey = makeBoxKey("", nodeId("early"), undefined);
    const lateKey = makeBoxKey("", nodeId("late"), undefined);
    // `early`'s layer defaults to 0 (== late) → document order decides, late on top.
    expect(map.get(lateKey) as number).toBeGreaterThan(map.get(earlyKey) as number);
  });

  it("orders forEach-stamped Component-like siblings by their per-item layer", () => {
    // forEach instances are siblings; each instance's bound layer orders it among
    // the others (a stand-in for Component leaves whose layer must order siblings).
    const { root, nodeId } = parse(`
      <View>
        <Component id="card" src="card.xml" forEach="{cards}" layer="{z}"/>
      </View>
    `);
    const map = computeZOrder(root, { cards: [{ z: 0 }, { z: 7 }, { z: 3 }] });
    const k0 = makeBoxKey("", nodeId("card"), "0");
    const k1 = makeBoxKey("", nodeId("card"), "1");
    const k2 = makeBoxKey("", nodeId("card"), "2");
    // Ranked by layer: instance0 (0) < instance2 (3) < instance1 (7).
    expect(map.get(k0) as number).toBeLessThan(map.get(k2) as number);
    expect(map.get(k2) as number).toBeLessThan(map.get(k1) as number);
  });
});
