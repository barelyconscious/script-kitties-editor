import { describe, expect, it } from "vitest";
import {
  addNode,
  canPlace,
  chainLink,
  createTree,
  DEFAULT_PREVIEW,
  deleteItems,
  deleteTree,
  detachPlacement,
  duplicateNodes,
  edgeKey,
  emptyDoc,
  flattenTree,
  getTree,
  insertIntoEdge,
  link,
  linkProblem,
  normalizeDoc,
  placeTree,
  previewClick,
  prunePreview,
  serializeDoc,
  shortestPath,
  type TalentDoc,
  toggleLink,
  translateItems,
  updateTree,
} from "./talentTree";

/** Unwrap a value the test setup guarantees exists. */
function must<T>(v: T | null | undefined): T {
  if (v == null) throw new Error("expected a value");
  return v;
}

/** A doc with a 3-node chain cluster (t1: n1–n2–n3) and an empty host tree (t2). */
function setup(): TalentDoc {
  let doc = emptyDoc();
  ({ doc } = createTree(doc, "Rogue", "cluster"));
  ({ doc } = createTree(doc, "Main", "tree"));
  doc = updateTree(doc, "t1", (t) => {
    let r = addNode(t, 0, 0);
    r = addNode(r.tree, 100, 0, r.id);
    r = addNode(r.tree, 200, 0, r.id);
    return r.tree;
  });
  return doc;
}

describe("ids", () => {
  it("never reuses node ids after a delete", () => {
    let t = must(getTree(setup(), "t1"));
    t = deleteItems(t, { nodes: ["n3"] });
    const r = addNode(t, 0, 0);
    expect(r.id).toBe("n4");
  });

  it("allocates sequential tree ids", () => {
    const doc = setup();
    expect(doc.trees.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(createTree(doc, "x", "tree").id).toBe("t3");
  });
});

describe("serialize / normalize", () => {
  it("round-trips and sorts naturally", () => {
    let doc = setup();
    doc = updateTree(doc, "t1", (t) => ({ ...t, edges: [["n3", "n2"], ["n1", "n2"]] }));
    const text = serializeDoc(doc);
    const back = normalizeDoc(JSON.parse(text));
    expect(back.trees[0].edges).toEqual([
      ["n1", "n2"],
      ["n2", "n3"],
    ]);
    expect(serializeDoc(back)).toBe(text);
  });

  it("orders n2 before n10", () => {
    let t = must(getTree(setup(), "t1"));
    t = { ...t, nodes: [{ ...t.nodes[0], id: "n10" }, { ...t.nodes[1], id: "n2" }] };
    const out = JSON.parse(serializeDoc({ version: 1, seq: 1, trees: [t] }));
    expect(out.trees[0].nodes.map((n: { id: string }) => n.id)).toEqual(["n2", "n10"]);
  });

  it("fills defaults for garbage input", () => {
    const doc = normalizeDoc({ trees: [{ id: "t1", nodes: [{ id: "a", type: "huge", x: "3.6" }] }] });
    expect(doc.trees[0].nodes[0]).toMatchObject({ type: "minor", x: 4, tint: "none", start: false });
    expect(doc.trees[0].kind).toBe("tree");
    expect(normalizeDoc(null)).toEqual(emptyDoc());
  });
});

describe("placement & flattening", () => {
  it("expands a placed cluster with offset and qualified ids", () => {
    const r = must(placeTree(setup(), "t2", "t1", 1000, 50));
    const g = flattenTree(r.doc, "t2");
    expect(r.id).toBe("p1");
    expect(g.nodes.get("p1/n2")).toMatchObject({ x: 1100, y: 50, placementId: "p1", sourceTreeId: "t1", sourceId: "n2" });
    expect(g.edges.map((e) => [e.key, e.owned])).toEqual([
      ["p1/n1|p1/n2", false],
      ["p1/n2|p1/n3", false],
    ]);
    expect(g.placements[0]).toMatchObject({ name: "Rogue", bounds: { x0: 1000, x1: 1200 } });
  });

  it("reflects cluster edits in the host", () => {
    let { doc } = must(placeTree(setup(), "t2", "t1", 0, 0));
    doc = updateTree(doc, "t1", (t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === "n1" ? { ...n, title: "Ambush" } : n)) }));
    expect(flattenTree(doc, "t2").nodes.get("p1/n1")?.title).toBe("Ambush");
  });

  it("keeps host links to placed nodes and reports broken ones", () => {
    let { doc } = must(placeTree(setup(), "t2", "t1", 0, 0));
    doc = updateTree(doc, "t2", (t) => {
      const r = addNode(t, -100, 0);
      return (link(r.tree, r.id, "p1/n1") as { tree: typeof t }).tree;
    });
    expect(flattenTree(doc, "t2").edges.find((e) => e.owned)?.key).toBe("n2|p1/n1");
    doc = updateTree(doc, "t1", (t) => deleteItems(t, { nodes: ["n1"] }));
    const g = flattenTree(doc, "t2");
    expect(g.broken).toEqual([["n2", "p1/n1"]]);
    expect(g.edges.some((e) => e.owned)).toBe(false);
  });

  it("supports nesting", () => {
    let doc = setup();
    ({ doc } = createTree(doc, "Wrapper", "cluster")); // t3
    doc = must(placeTree(doc, "t3", "t1", 10, 0)).doc;
    doc = must(placeTree(doc, "t2", "t3", 100, 0)).doc;
    const g = flattenTree(doc, "t2");
    expect(g.nodes.get("p1/p1/n1")).toMatchObject({ x: 110, placementId: "p1" });
    expect(g.edges).toHaveLength(2);
  });

  it("refuses cycles", () => {
    let doc = setup();
    expect(canPlace(doc, "t1", "t1")).toBe(false);
    doc = must(placeTree(doc, "t2", "t1", 0, 0)).doc;
    expect(canPlace(doc, "t1", "t2")).toBe(false);
    expect(placeTree(doc, "t1", "t2", 0, 0)).toBeNull();
    expect(canPlace(doc, "t2", "t1")).toBe(true); // a second instance is fine
  });

  it("blocks deleting a placed tree", () => {
    const { doc } = must(placeTree(setup(), "t2", "t1", 0, 0));
    expect(deleteTree(doc, "t1").blockedBy?.map((t) => t.id)).toEqual(["t2"]);
    expect(deleteTree(doc, "t2").doc?.trees.map((t) => t.id)).toEqual(["t1"]);
  });

  it("deleting a placement removes links into it", () => {
    let { doc } = must(placeTree(setup(), "t2", "t1", 0, 0));
    doc = updateTree(doc, "t2", (t) => {
      const r = addNode(t, 0, 0);
      return { ...r.tree, edges: [[r.id, "p1/n3"]] };
    });
    const t = deleteItems(must(getTree(doc, "t2")), { placements: ["p1"] });
    expect(t.placements).toEqual([]);
    expect(t.edges).toEqual([]);
  });

  it("detaches into plain copies, rewriting host links", () => {
    let { doc } = must(placeTree(setup(), "t2", "t1", 500, 0));
    doc = updateTree(doc, "t2", (t) => {
      const r = addNode(t, 0, 0); // n2 (p1 took seq 1)
      return { ...r.tree, edges: [[r.id, "p1/n1"]] };
    });
    doc = detachPlacement(doc, "t2", "p1");
    const t = must(getTree(doc, "t2"));
    expect(t.placements).toEqual([]);
    expect(t.nodes.map((n) => [n.id, n.x])).toEqual([
      ["n2", 0],
      ["n3", 500],
      ["n4", 600],
      ["n5", 700],
    ]);
    expect(t.edges.map(([a, b]) => edgeKey(a, b)).sort()).toEqual(["n2|n3", "n3|n4", "n4|n5"]);
  });
});

describe("edits", () => {
  it("rejects linking two nodes of one placement", () => {
    expect(linkProblem("p1/n1", "p1/n3")).toMatch(/same placed cluster/);
    expect(linkProblem("p1/n1", "p2/n3")).toBeNull();
    expect(linkProblem("n1", "n1")).toMatch(/itself/);
  });

  it("toggles links", () => {
    const t = must(getTree(setup(), "t1"));
    const r = toggleLink(t, "n1", "n2");
    expect(r.ok && r.action).toBe("unlinked");
    const r2 = r.ok ? toggleLink(r.tree, "n2", "n1") : r;
    expect(r2.ok && r2.action).toBe("linked");
  });

  it("chain-links in order, skipping existing links", () => {
    const t = must(getTree(setup(), "t1"));
    const r = chainLink(t, ["n3", "n1", "n2"]);
    expect(r.added).toBe(1);
  });

  it("inserts a node into a link", () => {
    const t = must(getTree(setup(), "t1"));
    const r = must(insertIntoEdge(t, "n1|n2", 50, 0));
    expect(r.tree.edges.map(([a, b]) => edgeKey(a, b)).sort()).toEqual(["n1|n4", "n2|n3", "n2|n4"]);
  });

  it("duplicates nodes with their internal links", () => {
    const t = must(getTree(setup(), "t1"));
    const r = duplicateNodes(t, ["n1", "n2"]);
    expect(r.ids).toEqual(["n4", "n5"]);
    expect(r.tree.edges).toContainEqual(["n4", "n5"]);
    expect(r.tree.nodes.find((n) => n.id === "n4")).toMatchObject({ x: 40, y: 40 });
  });

  it("translates from a base snapshot", () => {
    const { doc } = must(placeTree(setup(), "t2", "t1", 0, 0));
    const t = translateItems(must(getTree(doc, "t2")), { placements: ["p1"] }, 10, -5);
    expect(t.placements[0]).toMatchObject({ x: 10, y: -5 });
  });
});

describe("preview", () => {
  // Host: own start node n2 linked to the cluster's n1; cluster chain n1–n2–n3.
  function graph() {
    let { doc } = must(placeTree(setup(), "t2", "t1", 0, 0));
    doc = updateTree(doc, "t2", (t) => {
      const r = addNode(t, -100, 0);
      const nodes = r.tree.nodes.map((n) => ({ ...n, start: true }));
      return { ...r.tree, nodes, edges: [[r.id, "p1/n1"]] };
    });
    return flattenTree(doc, "t2");
  }

  it("finds the cheapest path through placed nodes", () => {
    expect(shortestPath(graph(), new Set(["n2"]), "p1/n3")).toEqual(["n2", "p1/n1", "p1/n2", "p1/n3"]);
  });

  it("requires a start point when the tree has some", () => {
    const r = previewClick(graph(), DEFAULT_PREVIEW, "p1/n2");
    expect(r.kind).toBe("noop");
  });

  it("allocates paths and refunds dependents", () => {
    const g = graph();
    let s = DEFAULT_PREVIEW;
    let r = previewClick(g, s, "n2");
    expect(r.kind).toBe("start");
    s = (r as { state: typeof s }).state;
    r = previewClick(g, s, "p1/n3");
    expect(r).toMatchObject({ kind: "allocate", added: 3 });
    s = (r as { state: typeof s }).state;
    r = previewClick(g, s, "p1/n1");
    expect(r).toMatchObject({ kind: "refund", refunded: 3 });
  });

  // Two start points: n2 (linked to the cluster's n1) and n3 (between the
  // cluster's n3 and a far node n4). n4 is only reachable through start n3.
  function twoStarts() {
    let { doc } = must(placeTree(setup(), "t2", "t1", 0, 0));
    doc = updateTree(doc, "t2", (t) => {
      let r = addNode(t, -100, 0);
      r = addNode(r.tree, 300, 0);
      r = addNode(r.tree, 400, 0);
      const nodes = r.tree.nodes.map((n) => ({ ...n, start: n.id !== "n4" }));
      return { ...r.tree, nodes, edges: [["n2", "p1/n1"], ["n3", "p1/n3"], ["n3", "n4"]] };
    });
    return flattenTree(doc, "t2");
  }

  it("never paths through another cat's start point", () => {
    const g = twoStarts();
    expect(shortestPath(g, new Set(["n2"]), "n4")).toBeNull();
    expect(shortestPath(g, new Set(["n3"]), "n4")).toEqual(["n3", "n4"]);
    const r = previewClick(g, { ...DEFAULT_PREVIEW, start: "n2" }, "n4");
    expect(r).toMatchObject({ kind: "noop", message: expect.stringMatching(/start point/) });
    // Its own region still allocates up to the wall.
    expect(previewClick(g, { ...DEFAULT_PREVIEW, start: "n2" }, "p1/n3")).toMatchObject({
      kind: "allocate",
      added: 3,
    });
  });

  it("drops a node that became another start point, with its dependents", () => {
    const g = twoStarts();
    const order = ["p1/n1", "p1/n2", "p1/n3", "n3", "n4"];
    const s = prunePreview(g, { start: "n2", order, budget: 0 });
    expect(s.order).toEqual(["p1/n1", "p1/n2", "p1/n3"]);
  });

  it("prunes allocations a graph change disconnected", () => {
    const g = graph();
    const s = prunePreview(g, { start: "n2", order: ["p1/n1", "missing", "p1/n3"], budget: 0 });
    expect(s.order).toEqual(["p1/n1"]);
  });
});
