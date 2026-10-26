/**
 * Talent-tree engine — the framework-agnostic model behind the Talent Trees tool.
 * Pure and immutable: every edit takes a value and returns a new one, so the page
 * can keep one undo history over the whole document.
 *
 * Trees are composed from clusters BY REFERENCE: a tree's `placements` point at
 * other trees, and {@link flattenTree} expands them into one plain graph with
 * path-qualified ids (`p4/n7`). Rendering, hit-testing and Preview all run on
 * that flattened graph, so a cluster edit shows up in every tree using it.
 *
 * @see design/talent_tree.md
 */

import { clampScale, type ViewTransform } from "@/lib/guiGeometry";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type NodeType = "minor" | "notable" | "keystone";
export const NODE_TYPES: Record<NodeType, { r: number; label: string }> = {
  minor: { r: 10, label: "Minor" },
  notable: { r: 17, label: "Notable" },
  keystone: { r: 26, label: "Keystone" },
};
export const NODE_TYPE_ORDER: NodeType[] = ["minor", "notable", "keystone"];

export const TINTS = {
  none: "#3a404c",
  red: "#d0614f",
  amber: "#d69a4a",
  green: "#5fb37a",
  teal: "#4fb3b0",
  blue: "#5a8fd6",
  violet: "#9b6fd0",
  rose: "#cf6f9e",
} as const;
export type TintName = keyof typeof TINTS;

export type NoteSize = "s" | "m" | "l";
export const NOTE_FONT: Record<NoteSize, number> = { s: 14, m: 22, l: 40 };

export type TreeKind = "cluster" | "tree";

export type TalentNode = {
  id: string;
  x: number;
  y: number;
  type: NodeType;
  title: string;
  text: string;
  tint: TintName;
  start: boolean;
  startName: string;
};

export type TalentNote = { id: string; x: number; y: number; text: string; size: NoteSize };

/** Another tree placed into this one at an offset. Holds no copied nodes. */
export type Placement = { id: string; treeId: string; x: number; y: number };

/** Undirected link. Endpoints may be path-qualified (`p4/n7`). */
export type Edge = [string, string];

export type TalentTree = {
  id: string;
  name: string;
  kind: TreeKind;
  /** Counter for node/note/placement ids. Ids are never reused, so a host link
   *  to a deleted cluster node can't silently attach to a newer node. */
  seq: number;
  nodes: TalentNode[];
  edges: Edge[];
  notes: TalentNote[];
  placements: Placement[];
};

export type TalentDoc = { version: 1; seq: number; trees: TalentTree[] };

export const GRID = 20;
export const PATH_SEP = "/";

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export function emptyDoc(): TalentDoc {
  return { version: 1, seq: 0, trees: [] };
}

function normNode(raw: unknown): TalentNode {
  const n = rec(raw);
  return {
    id: str(n.id),
    x: int(n.x),
    y: int(n.y),
    type: (n.type as NodeType) in NODE_TYPES ? (n.type as NodeType) : "minor",
    title: str(n.title),
    text: str(n.text),
    tint: (n.tint as TintName) in TINTS ? (n.tint as TintName) : "none",
    start: !!n.start,
    startName: str(n.startName),
  };
}

function normNote(raw: unknown): TalentNote {
  const m = rec(raw);
  return {
    id: str(m.id),
    x: int(m.x),
    y: int(m.y),
    text: str(m.text),
    size: (m.size as NoteSize) in NOTE_FONT ? (m.size as NoteSize) : "m",
  };
}

function normTree(raw: unknown): TalentTree {
  const t = rec(raw);
  const edges: Edge[] = [];
  for (const e of arr(t.edges)) {
    const [a, b] = Array.isArray(e) ? e.map((x) => str(x)) : str(e).split("|");
    if (a && b && a !== b) edges.push(sortPair(a, b));
  }
  return {
    id: str(t.id),
    name: str(t.name, "Untitled"),
    kind: t.kind === "cluster" ? "cluster" : "tree",
    seq: Math.max(0, int(t.seq)),
    nodes: arr(t.nodes).map(normNode),
    edges: dedupeEdges(edges),
    notes: arr(t.notes).map(normNote),
    placements: arr(t.placements).map((p) => {
      const o = rec(p);
      return { id: str(o.id), treeId: str(o.treeId), x: int(o.x), y: int(o.y) };
    }),
  };
}

/** Tolerant parse of the on-disk document (missing/garbled fields get defaults). */
export function normalizeDoc(raw: unknown): TalentDoc {
  const d = rec(raw);
  return { version: 1, seq: Math.max(0, int(d.seq)), trees: arr(d.trees).map(normTree) };
}

/** Natural id order (`n2` before `n10`) so files read in creation order. */
export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Canonical on-disk form: integer coords, records sorted by id, edges sorted.
 *  Keeps diffs minimal across saves. */
export function serializeDoc(doc: TalentDoc): string {
  const byId = <T extends { id: string }>(xs: T[]) =>
    [...xs].sort((a, b) => compareIds(a.id, b.id));
  const out = {
    version: 1,
    seq: doc.seq,
    trees: byId(doc.trees).map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      seq: t.seq,
      nodes: byId(t.nodes).map((n) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y) })),
      edges: dedupeEdges(t.edges.map(([a, b]) => sortPair(a, b))).sort(
        (p, q) => compareIds(p[0], q[0]) || compareIds(p[1], q[1]),
      ),
      notes: byId(t.notes).map((m) => ({ ...m, x: Math.round(m.x), y: Math.round(m.y) })),
      placements: byId(t.placements).map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) })),
    })),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Ids & edges
// ---------------------------------------------------------------------------

export function sortPair(a: string, b: string): Edge {
  return compareIds(a, b) <= 0 ? [a, b] : [b, a];
}
export function edgeKey(a: string, b: string): string {
  const [x, y] = sortPair(a, b);
  return `${x}|${y}`;
}
function dedupeEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter(([a, b]) => {
    const k = edgeKey(a, b);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The top-level placement a flat id belongs to (`p4/n7` → `p4`), or null if local. */
export function placementOf(flatId: string): string | null {
  const i = flatId.indexOf(PATH_SEP);
  return i < 0 ? null : flatId.slice(0, i);
}

function allocId(tree: TalentTree, prefix: "n" | "m" | "p"): [string, TalentTree] {
  const seq = tree.seq + 1;
  return [`${prefix}${seq}`, { ...tree, seq }];
}

// ---------------------------------------------------------------------------
// Document-level operations
// ---------------------------------------------------------------------------

export function getTree(doc: TalentDoc, id: string | null | undefined): TalentTree | undefined {
  return id ? doc.trees.find((t) => t.id === id) : undefined;
}

export function updateTree(
  doc: TalentDoc,
  id: string,
  fn: (t: TalentTree) => TalentTree,
): TalentDoc {
  return { ...doc, trees: doc.trees.map((t) => (t.id === id ? fn(t) : t)) };
}

export function createTree(
  doc: TalentDoc,
  name: string,
  kind: TreeKind,
): { doc: TalentDoc; id: string } {
  const seq = doc.seq + 1;
  const id = `t${seq}`;
  const tree: TalentTree = {
    id,
    name,
    kind,
    seq: 0,
    nodes: [],
    edges: [],
    notes: [],
    placements: [],
  };
  return { doc: { ...doc, seq, trees: [...doc.trees, tree] }, id };
}

/** Trees that place `id` directly. */
export function treeUsers(doc: TalentDoc, id: string): TalentTree[] {
  return doc.trees.filter((t) => t.id !== id && t.placements.some((p) => p.treeId === id));
}

/** Delete a tree, unless another tree places it (returns those users instead). */
export function deleteTree(
  doc: TalentDoc,
  id: string,
): { doc: TalentDoc; blockedBy?: undefined } | { doc?: undefined; blockedBy: TalentTree[] } {
  const users = treeUsers(doc, id);
  if (users.length) return { blockedBy: users };
  return { doc: { ...doc, trees: doc.trees.filter((t) => t.id !== id) } };
}

/** Does `fromId` (transitively) place `targetId`? */
function reaches(
  doc: TalentDoc,
  fromId: string,
  targetId: string,
  seen = new Set<string>(),
): boolean {
  if (fromId === targetId) return true;
  if (seen.has(fromId)) return false;
  seen.add(fromId);
  const t = getTree(doc, fromId);
  return !!t?.placements.some((p) => reaches(doc, p.treeId, targetId, seen));
}

/** Can `childId` be placed into `hostId` without creating a cycle? */
export function canPlace(doc: TalentDoc, hostId: string, childId: string): boolean {
  return !!getTree(doc, childId) && !reaches(doc, childId, hostId);
}

export function placeTree(
  doc: TalentDoc,
  hostId: string,
  childId: string,
  x: number,
  y: number,
): { doc: TalentDoc; id: string } | null {
  if (!canPlace(doc, hostId, childId)) return null;
  let id = "";
  const next = updateTree(doc, hostId, (t) => {
    const [pid, t2] = allocId(t, "p");
    id = pid;
    return {
      ...t2,
      placements: [
        ...t2.placements,
        { id: pid, treeId: childId, x: Math.round(x), y: Math.round(y) },
      ],
    };
  });
  return { doc: next, id };
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

export type FlatNode = TalentNode & {
  /** Top-level placement this node came through, or null for the tree's own nodes. */
  placementId: string | null;
  /** The tree that actually owns the node, and its id there. */
  sourceTreeId: string;
  sourceId: string;
};

export type FlatEdge = {
  a: string;
  b: string;
  key: string;
  /** Defined by the tree being flattened (editable/selectable), vs. a placed
   *  cluster's internal link (locked). */
  owned: boolean;
};

export type PlacementInfo = {
  id: string;
  treeId: string;
  /** Name of the placed tree, or null if it no longer exists. */
  name: string | null;
  x: number;
  y: number;
  /** Bounds of its flattened nodes, or null if empty/missing. */
  bounds: Bounds | null;
};

export type FlatGraph = {
  nodes: Map<string, FlatNode>;
  edges: FlatEdge[];
  /** The root tree's own links whose endpoint no longer resolves. */
  broken: Edge[];
  placements: PlacementInfo[];
};

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** Expand a tree and everything placed in it into one plain graph. */
export function flattenTree(doc: TalentDoc, treeId: string): FlatGraph {
  const nodes = new Map<string, FlatNode>();
  const edges: FlatEdge[] = [];
  const broken: Edge[] = [];
  const edgeKeys = new Set<string>();

  const expand = (
    tree: TalentTree,
    prefix: string,
    ox: number,
    oy: number,
    top: string | null,
    stack: Set<string>,
  ) => {
    for (const n of tree.nodes) {
      nodes.set(prefix + n.id, {
        ...n,
        id: prefix + n.id,
        x: n.x + ox,
        y: n.y + oy,
        placementId: top,
        sourceTreeId: tree.id,
        sourceId: n.id,
      });
    }
    for (const p of tree.placements) {
      const child = getTree(doc, p.treeId);
      if (!child || stack.has(child.id)) continue;
      stack.add(child.id);
      expand(child, `${prefix}${p.id}${PATH_SEP}`, ox + p.x, oy + p.y, top ?? p.id, stack);
      stack.delete(child.id);
    }
    for (const [a0, b0] of tree.edges) {
      const a = prefix + a0;
      const b = prefix + b0;
      if (nodes.has(a) && nodes.has(b)) {
        const key = edgeKey(a, b);
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ a, b, key, owned: prefix === "" });
      } else if (prefix === "") {
        broken.push([a0, b0]);
      }
    }
  };

  const root = getTree(doc, treeId);
  if (root) expand(root, "", 0, 0, null, new Set([root.id]));

  const placements: PlacementInfo[] = (root?.placements ?? []).map((p) => {
    const child = getTree(doc, p.treeId);
    const own = [...nodes.values()].filter((n) => n.placementId === p.id);
    return {
      id: p.id,
      treeId: p.treeId,
      name: child?.name ?? null,
      x: p.x,
      y: p.y,
      bounds: boundsOf(own),
    };
  });

  return { nodes, edges, broken, placements };
}

export function boundsOf(points: Iterable<{ x: number; y: number }>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!b) b = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    else {
      b.x0 = Math.min(b.x0, p.x);
      b.y0 = Math.min(b.y0, p.y);
      b.x1 = Math.max(b.x1, p.x);
      b.y1 = Math.max(b.y1, p.y);
    }
  }
  return b;
}

// ---------------------------------------------------------------------------
// Graph queries (on the flattened graph)
// ---------------------------------------------------------------------------

export function adjacency(g: FlatGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of g.nodes.keys()) adj.set(id, []);
  for (const e of g.edges) {
    adj.get(e.a)?.push(e.b);
    adj.get(e.b)?.push(e.a);
  }
  return adj;
}

/** Cheapest path from any allocated node to `target` (BFS), inclusive of the
 *  allocated start of the path. Null if unreachable or nothing allocated. */
export function shortestPath(
  g: FlatGraph,
  allocated: Set<string>,
  target: string,
): string[] | null {
  if (!allocated.size || !g.nodes.has(target)) return null;
  const adj = adjacency(g);
  const prev = new Map<string, string | null>();
  const q: string[] = [];
  for (const id of allocated) {
    if (!g.nodes.has(id)) continue;
    prev.set(id, null);
    q.push(id);
  }
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === target) break;
    for (const nb of adj.get(c) ?? []) {
      if (!prev.has(nb)) {
        prev.set(nb, c);
        q.push(nb);
      }
    }
  }
  if (!prev.has(target)) return null;
  const path: string[] = [];
  for (let c: string | null = target; c !== null; c = prev.get(c) ?? null) path.unshift(c);
  return path;
}

/** Preview (point allocation) state. Play-test only — not saved to the file. */
export type PreviewState = { start: string | null; order: string[]; budget: number };
export const DEFAULT_PREVIEW: PreviewState = { start: null, order: [], budget: 20 };

/** Drop allocations that no longer connect back to the start (after a refund or
 *  a graph change), keeping allocation order. */
export function prunePreview(g: FlatGraph, p: PreviewState): PreviewState {
  if (!p.start || !g.nodes.has(p.start)) return { ...p, start: null, order: [] };
  const adj = adjacency(g);
  const allowed = new Set(p.order.filter((id) => g.nodes.has(id)));
  const seen = new Set([p.start]);
  const q = [p.start];
  for (let i = 0; i < q.length; i++) {
    for (const nb of adj.get(q[i]) ?? []) {
      if (allowed.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
      }
    }
  }
  const order = p.order.filter((id, i, a) => seen.has(id) && id !== p.start && a.indexOf(id) === i);
  return { ...p, order };
}

export function allocatedSet(p: PreviewState): Set<string> {
  return p.start ? new Set([p.start, ...p.order]) : new Set();
}

export type PreviewClick =
  | { kind: "start"; state: PreviewState }
  | { kind: "allocate"; state: PreviewState; added: number }
  | { kind: "refund"; state: PreviewState; refunded: number }
  | { kind: "noop"; message: string };

/** Apply a Preview-mode click on `nodeId` (the forge's rules: start points switch
 *  the start; allocated nodes refund with everything that relied on them; others
 *  allocate the cheapest path). */
export function previewClick(g: FlatGraph, p: PreviewState, nodeId: string): PreviewClick {
  const n = g.nodes.get(nodeId);
  if (!n) return { kind: "noop", message: "" };
  const hasStarts = [...g.nodes.values()].some((x) => x.start);
  if (n.start && n.id !== p.start)
    return { kind: "start", state: { ...p, start: n.id, order: [] } };
  if (!p.start) {
    if (hasStarts)
      return { kind: "noop", message: "Pick a start point first: a node with a gold dashed ring" };
    return { kind: "start", state: { ...p, start: n.id, order: [] } };
  }
  if (n.id === p.start)
    return { kind: "noop", message: "This is the start. Click another start point to switch." };
  if (p.order.includes(n.id)) {
    const next = prunePreview(g, { ...p, order: p.order.filter((id) => id !== n.id) });
    return { kind: "refund", state: next, refunded: p.order.length - next.order.length };
  }
  const path = shortestPath(g, allocatedSet(p), n.id);
  if (!path) return { kind: "noop", message: "That node is not connected to your allocated nodes" };
  const add = path.slice(1);
  return { kind: "allocate", state: { ...p, order: [...p.order, ...add] }, added: add.length };
}

// ---------------------------------------------------------------------------
// Tree edits (on one tree; ids are flat ids from its flattened graph)
// ---------------------------------------------------------------------------

export function addNode(
  tree: TalentTree,
  x: number,
  y: number,
  linkFrom?: string | null,
): { tree: TalentTree; id: string } {
  const [id, t] = allocId(tree, "n");
  const node: TalentNode = {
    id,
    x: Math.round(x),
    y: Math.round(y),
    type: "minor",
    title: "",
    text: "",
    tint: "none",
    start: false,
    startName: "",
  };
  const edges = linkFrom ? [...t.edges, sortPair(linkFrom, id)] : t.edges;
  return { tree: { ...t, nodes: [...t.nodes, node], edges }, id };
}

export function addNote(tree: TalentTree, x: number, y: number): { tree: TalentTree; id: string } {
  const [id, t] = allocId(tree, "m");
  return {
    tree: {
      ...t,
      notes: [...t.notes, { id, x: Math.round(x), y: Math.round(y), text: "", size: "m" }],
    },
    id,
  };
}

export type LinkResult =
  | { ok: true; tree: TalentTree; action: "linked" | "unlinked" }
  | { ok: false; reason: string };

/** Why a host-level link between two flat nodes isn't allowed, or null if fine. */
export function linkProblem(a: string, b: string): string | null {
  if (a === b) return "A node can't link to itself";
  const pa = placementOf(a);
  if (pa && pa === placementOf(b))
    return "Both nodes are inside the same placed cluster. Edit the cluster to change its links.";
  return null;
}

export function hasEdge(tree: TalentTree, a: string, b: string): boolean {
  const k = edgeKey(a, b);
  return tree.edges.some(([x, y]) => edgeKey(x, y) === k);
}

/** Add a link (no-op result `unlinked` never happens here). */
export function link(tree: TalentTree, a: string, b: string): LinkResult {
  const problem = linkProblem(a, b);
  if (problem) return { ok: false, reason: problem };
  if (hasEdge(tree, a, b)) return { ok: false, reason: "Those nodes are already linked" };
  return { ok: true, tree: { ...tree, edges: [...tree.edges, sortPair(a, b)] }, action: "linked" };
}

export function toggleLink(tree: TalentTree, a: string, b: string): LinkResult {
  if (hasEdge(tree, a, b)) {
    const k = edgeKey(a, b);
    return {
      ok: true,
      tree: { ...tree, edges: tree.edges.filter(([x, y]) => edgeKey(x, y) !== k) },
      action: "unlinked",
    };
  }
  return link(tree, a, b);
}

/** Link nodes in order (a–b, b–c, …), skipping disallowed/existing pairs. */
export function chainLink(tree: TalentTree, ids: string[]): { tree: TalentTree; added: number } {
  let t = tree;
  let added = 0;
  for (let i = 1; i < ids.length; i++) {
    const r = link(t, ids[i - 1], ids[i]);
    if (r.ok) {
      t = r.tree;
      added++;
    }
  }
  return { tree: t, added };
}

export type ItemSet = {
  nodes?: Iterable<string>;
  notes?: Iterable<string>;
  placements?: Iterable<string>;
};

/** Move items by a delta from a BASE tree (the snapshot at drag start), so a drag
 *  never accumulates rounding. Placed (non-local) node ids are ignored — move
 *  their placement instead. */
export function translateItems(
  base: TalentTree,
  items: ItemSet,
  dx: number,
  dy: number,
): TalentTree {
  const ns = new Set(items.nodes ?? []);
  const ms = new Set(items.notes ?? []);
  const ps = new Set(items.placements ?? []);
  const mv = <T extends { id: string; x: number; y: number }>(xs: T[], s: Set<string>) =>
    s.size ? xs.map((o) => (s.has(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o)) : xs;
  return {
    ...base,
    nodes: mv(base.nodes, ns),
    notes: mv(base.notes, ms),
    placements: mv(base.placements, ps),
  };
}

/** Delete local nodes (with their links), notes, placements (with links into
 *  them) and links by key. */
export function deleteItems(
  tree: TalentTree,
  items: ItemSet & { edges?: Iterable<string> },
): TalentTree {
  const ns = new Set(items.nodes ?? []);
  const ms = new Set(items.notes ?? []);
  const ps = new Set(items.placements ?? []);
  const es = new Set(items.edges ?? []);
  const gone = (id: string) => ns.has(id) || ps.has(placementOf(id) ?? "");
  return {
    ...tree,
    nodes: tree.nodes.filter((n) => !ns.has(n.id)),
    notes: tree.notes.filter((m) => !ms.has(m.id)),
    placements: tree.placements.filter((p) => !ps.has(p.id)),
    edges: tree.edges.filter(([a, b]) => !gone(a) && !gone(b) && !es.has(edgeKey(a, b))),
  };
}

/** Split an owned link with a new node at (x, y). */
export function insertIntoEdge(
  tree: TalentTree,
  key: string,
  x: number,
  y: number,
): { tree: TalentTree; id: string } | null {
  const e = tree.edges.find(([a, b]) => edgeKey(a, b) === key);
  if (!e) return null;
  const r = addNode(deleteItems(tree, { edges: [key] }), x, y);
  return {
    tree: { ...r.tree, edges: [...r.tree.edges, sortPair(e[0], r.id), sortPair(r.id, e[1])] },
    id: r.id,
  };
}

export type NodePatch = Partial<Omit<TalentNode, "id" | "x" | "y">>;

export function patchNodes(tree: TalentTree, ids: Iterable<string>, patch: NodePatch): TalentTree {
  const s = new Set(ids);
  return { ...tree, nodes: tree.nodes.map((n) => (s.has(n.id) ? { ...n, ...patch } : n)) };
}

export function patchNote(
  tree: TalentTree,
  id: string,
  patch: Partial<Omit<TalentNote, "id">>,
): TalentTree {
  return { ...tree, notes: tree.notes.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

/** Duplicate local nodes (offset +40,+40) with the links among them. */
export function duplicateNodes(
  tree: TalentTree,
  ids: Iterable<string>,
): { tree: TalentTree; ids: string[] } {
  const s = new Set(ids);
  const map = new Map<string, string>();
  let t = tree;
  const copies: TalentNode[] = [];
  for (const n of tree.nodes) {
    if (!s.has(n.id)) continue;
    const [id, t2] = allocId(t, "n");
    t = t2;
    map.set(n.id, id);
    copies.push({ ...n, id, x: n.x + 40, y: n.y + 40 });
  }
  const edges = [...t.edges];
  for (const [a, b] of tree.edges) {
    const ma = map.get(a);
    const mb = map.get(b);
    if (ma && mb) edges.push(sortPair(ma, mb));
  }
  return { tree: { ...t, nodes: [...t.nodes, ...copies], edges }, ids: [...map.values()] };
}

/** Replace a placement with plain copies of its nodes (fresh ids), carrying its
 *  internal links and rewriting the host's links onto the copies. Host links to
 *  nodes that no longer resolve inside it are dropped. */
export function detachPlacement(doc: TalentDoc, hostId: string, placementId: string): TalentDoc {
  const g = flattenTree(doc, hostId);
  return updateTree(doc, hostId, (tree) => {
    let t = tree;
    const map = new Map<string, string>();
    const copies: TalentNode[] = [];
    for (const n of g.nodes.values()) {
      if (n.placementId !== placementId) continue;
      const [id, t2] = allocId(t, "n");
      t = t2;
      map.set(n.id, id);
      const { placementId: _p, sourceTreeId: _t, sourceId: _s, ...plain } = n;
      copies.push({ ...plain, id });
    }
    const inside = (id: string) => placementOf(id) === placementId;
    const edges: Edge[] = [];
    for (const [a, b] of t.edges) {
      if (!inside(a) && !inside(b)) edges.push([a, b]);
      else {
        const ma = inside(a) ? map.get(a) : a;
        const mb = inside(b) ? map.get(b) : b;
        if (ma && mb) edges.push(sortPair(ma, mb));
      }
    }
    for (const e of g.edges) {
      if (e.owned) continue;
      const ma = map.get(e.a);
      const mb = map.get(e.b);
      if (ma && mb) edges.push(sortPair(ma, mb));
    }
    return {
      ...t,
      nodes: [...t.nodes, ...copies],
      edges: dedupeEdges(edges),
      placements: t.placements.filter((p) => p.id !== placementId),
    };
  });
}

// ---------------------------------------------------------------------------
// Hit-testing & view
// ---------------------------------------------------------------------------

export type Point = { x: number; y: number };

/** The node under world point `w` (radius + a few screen px of slop), optionally
 *  restricted to nodes `accept` allows (e.g. only the tree's own nodes). */
export function hitNode(
  g: FlatGraph,
  w: Point,
  scale: number,
  accept?: (n: FlatNode) => boolean,
): FlatNode | null {
  let best: FlatNode | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const n of g.nodes.values()) {
    if (accept && !accept(n)) continue;
    const d = Math.hypot(n.x - w.x, n.y - w.y);
    if (d <= NODE_TYPES[n.type].r + 5 / scale && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** The link closest to `w` within 7 screen px. */
export function hitEdge(g: FlatGraph, w: Point, scale: number): FlatEdge | null {
  let best: FlatEdge | null = null;
  let bd = 7 / scale;
  for (const e of g.edges) {
    const A = g.nodes.get(e.a);
    const B = g.nodes.get(e.b);
    if (!A || !B) continue;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((w.x - A.x) * dx + (w.y - A.y) * dy) / L));
    const d = Math.hypot(w.x - (A.x + t * dx), w.y - (A.y + t * dy));
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

export function snapToGrid(v: number, on: boolean): number {
  return on ? Math.round(v / GRID) * GRID : Math.round(v);
}

/** Fit-and-center a world-space box in a `w × h` viewport (padded, capped at 1.4×). */
export function fitBounds(b: Bounds | null, w: number, h: number, pad = 90): ViewTransform {
  if (!b) return { scale: 1, panX: w / 2, panY: h / 2 };
  const bw = b.x1 - b.x0 + pad * 2;
  const bh = b.y1 - b.y0 + pad * 2;
  const scale = clampScale(Math.min(1.4, w / bw, h / bh));
  return {
    scale,
    panX: w / 2 - ((b.x0 + b.x1) / 2) * scale,
    panY: h / 2 - ((b.y0 + b.y1) / 2) * scale,
  };
}
