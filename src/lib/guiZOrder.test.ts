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

describe("flattenBoxes — document order + structure", () => {
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
    // View is the stage (not a box); Event is non-visual. a, a1, a2, b in order.
    expect(boxes.map((box) => box.boxKey)).toEqual([
      makeBoxKey("", nodeId("a"), undefined),
      makeBoxKey(makeBoxKey("", nodeId("a"), undefined), nodeId("a1"), undefined),
      makeBoxKey(makeBoxKey("", nodeId("a"), undefined), nodeId("a2"), undefined),
      makeBoxKey("", nodeId("b"), undefined),
    ]);
    expect(boxes.map((box) => box.docOrderIndex)).toEqual([0, 1, 2, 3]);
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
    // Each instance keyed positionally, layer resolved from its own item.
    expect(boxes.map((box) => box.boxKey)).toEqual([
      makeBoxKey("", nodeId("row"), "0"),
      makeBoxKey("", nodeId("row"), "1"),
      makeBoxKey("", nodeId("row"), "2"),
    ]);
    expect(boxes.map((box) => box.resolvedLayer)).toEqual([3, 1, 2]);
  });

  it("renders zero boxes for an empty/unresolved forEach collection", () => {
    const { root } = parse(`<View><Panel id="row" forEach="{rows}"/></View>`);
    expect(flattenBoxes(root, { rows: [] })).toHaveLength(0);
    expect(flattenBoxes(root, {})).toHaveLength(0);
  });
});

describe("assignZOrder — global (layer, doc-order) ranking", () => {
  it("orders by layer ascending, breaking ties by document order", () => {
    const map = assignZOrder([
      { boxKey: "k0", resolvedLayer: 0, docOrderIndex: 0 },
      { boxKey: "k1", resolvedLayer: 10, docOrderIndex: 1 },
      { boxKey: "k2", resolvedLayer: 0, docOrderIndex: 2 },
    ]);
    // sorted: (0,0) k0, (0,2) k2, (10,1) k1  → ranks 0,1,2
    expect(map.get("k0")).toBe(0);
    expect(map.get("k2")).toBe(1);
    expect(map.get("k1")).toBe(2);
  });

  it("assigns a dense, distinct rank to every box (no z-index ties)", () => {
    const boxes = Array.from({ length: 5 }, (_, i) => ({
      boxKey: `k${i}`,
      resolvedLayer: 0, // all equal layer → document order decides, ranks still distinct
      docOrderIndex: i,
    }));
    const ranks = [...assignZOrder(boxes).values()].sort((a, b) => a - b);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("F5a regression — cross-branch global z-order (the load-bearing case)", () => {
  // The exact shape F5a specifies: a deeply-nested, earliest-in-document-order box
  // with a HIGH layer in one branch must out-rank a shallow, later-in-document-order
  // box with a LOW layer in a different branch.
  const XML = `
    <View>
      <Panel id="branchA" position="0,0,0,0" size="0,0,400,400" backgroundColor="0,0,255,255">
        <Panel id="a1" position="0,0,20,20" size="0,0,360,360">
          <Panel id="a2" position="0,0,20,20" size="0,0,320,320">
            <Panel id="deepHigh" layer="10"
                   position="0,0,40,40" size="0,0,240,240" backgroundColor="255,0,0,255"/>
          </Panel>
        </Panel>
      </Panel>
      <Panel id="shallowLow" layer="0"
             position="0,0,120,120" size="0,0,240,240" backgroundColor="0,255,0,255"/>
    </View>
  `;

  it("paints the deep high-layer box ABOVE the shallow low-layer box in another branch", () => {
    const { root, nodeId } = parse(XML);
    const map = computeZOrder(root);

    const deepHighKey = makeBoxKey(
      makeBoxKey(
        makeBoxKey(makeBoxKey("", nodeId("branchA"), undefined), nodeId("a1"), undefined),
        nodeId("a2"),
        undefined,
      ),
      nodeId("deepHigh"),
      undefined,
    );
    const shallowLowKey = makeBoxKey("", nodeId("shallowLow"), undefined);

    const deepHighRank = map.get(deepHighKey);
    const shallowLowRank = map.get(shallowLowKey);
    expect(deepHighRank).toBeDefined();
    expect(shallowLowRank).toBeDefined();

    // The load-bearing assertion: deepHigh out-ranks (paints above) shallowLow.
    expect(deepHighRank as number).toBeGreaterThan(shallowLowRank as number);
  });

  it("ranks the whole tree bottom→top: branchA < a1 < a2 < shallowLow < deepHigh", () => {
    const { root, nodeId } = parse(XML);
    const map = computeZOrder(root);

    const branchAKey = makeBoxKey("", nodeId("branchA"), undefined);
    const a1Key = makeBoxKey(branchAKey, nodeId("a1"), undefined);
    const a2Key = makeBoxKey(a1Key, nodeId("a2"), undefined);
    const deepHighKey = makeBoxKey(a2Key, nodeId("deepHigh"), undefined);
    const shallowLowKey = makeBoxKey("", nodeId("shallowLow"), undefined);

    // All layer 0 (branchA/a1/a2/shallowLow) sort by document order; deepHigh (10) last.
    // Document order: branchA, a1, a2, deepHigh, shallowLow — but deepHigh's high
    // layer pushes it to the top, so the layer-0 group keeps doc order and deepHigh
    // lands above all of them.
    const r = (k: string) => map.get(k) as number;
    expect(r(branchAKey)).toBeLessThan(r(a1Key));
    expect(r(a1Key)).toBeLessThan(r(a2Key));
    expect(r(a2Key)).toBeLessThan(r(shallowLowKey));
    expect(r(shallowLowKey)).toBeLessThan(r(deepHighKey));
  });

  it("tie-break sub-case: equal layer → later document order paints on top", () => {
    // Same shape but deepHigh now shares shallowLow's layer (0). Document order then
    // decides, and shallowLow (LATER in document order) must out-rank deepHigh.
    const { root, nodeId } = parse(
      XML.replace('id="deepHigh" layer="10"', 'id="deepHigh" layer="0"'),
    );
    const map = computeZOrder(root);

    const deepHighKey = makeBoxKey(
      makeBoxKey(
        makeBoxKey(makeBoxKey("", nodeId("branchA"), undefined), nodeId("a1"), undefined),
        nodeId("a2"),
        undefined,
      ),
      nodeId("deepHigh"),
      undefined,
    );
    const shallowLowKey = makeBoxKey("", nodeId("shallowLow"), undefined);

    // deepHigh is EARLIER in document order, so with equal layer it sits underneath.
    expect(map.get(shallowLowKey) as number).toBeGreaterThan(map.get(deepHighKey) as number);
  });

  it("resolves a BOUND layer before sorting (the bound-layer-resolves-first case)", () => {
    // deepHigh's layer comes from the data model, not a literal. It must still win.
    const { root, nodeId } = parse(XML.replace('layer="10"', 'layer="{deepLayer}"'));
    const map = computeZOrder(root, { deepLayer: 10 });

    const deepHighKey = makeBoxKey(
      makeBoxKey(
        makeBoxKey(makeBoxKey("", nodeId("branchA"), undefined), nodeId("a1"), undefined),
        nodeId("a2"),
        undefined,
      ),
      nodeId("deepHigh"),
      undefined,
    );
    const shallowLowKey = makeBoxKey("", nodeId("shallowLow"), undefined);
    expect(map.get(deepHighKey) as number).toBeGreaterThan(map.get(shallowLowKey) as number);
  });

  it("an unresolved bound layer falls back to the default and does NOT win", () => {
    // If the binding is missing, deepHigh's layer defaults to 0 — equal to shallowLow,
    // so document order decides and shallowLow (later) ends up on top.
    const { root, nodeId } = parse(XML.replace('layer="10"', 'layer="{missing}"'));
    const map = computeZOrder(root, {}); // no `missing` field

    const deepHighKey = makeBoxKey(
      makeBoxKey(
        makeBoxKey(makeBoxKey("", nodeId("branchA"), undefined), nodeId("a1"), undefined),
        nodeId("a2"),
        undefined,
      ),
      nodeId("deepHigh"),
      undefined,
    );
    const shallowLowKey = makeBoxKey("", nodeId("shallowLow"), undefined);
    expect(map.get(shallowLowKey) as number).toBeGreaterThan(map.get(deepHighKey) as number);
  });
});
