# Talent Trees

A PoE-style passive-tree editor inside Script Kitties Editor, ported from the
"Talent Forge" prototype artifact. One big shared tree; cats begin at different
named **start points**. Trees are built out of reusable **clusters** that are
placed by reference, so tweaking a cluster updates every tree that uses it.

Status: editor-only design data. The game does not read it yet, and nothing
links to creatures yet.

## Storage

One committed, editor-owned file: `src-tauri/editor.talents.json` (next to
`editor.registry.json`, relative to the backend cwd; listed in
`src-tauri/.taurignore` so saving doesn't restart `tauri dev`). One file keeps a
cluster and the trees that link into it consistent on every save.

```jsonc
{
  "version": 1,
  "seq": 3,                         // tree-id counter (never reused)
  "trees": [{
    "id": "t1",
    "name": "Rogue",
    "kind": "cluster",              // "cluster" | "tree" — list grouping only
    "seq": 12,                      // node/note/placement id counter (never reused)
    "nodes": [{ "id": "n1", "x": 0, "y": 0, "type": "minor",   // minor | notable | keystone
                "title": "", "text": "", "tint": "none",
                "start": false, "startName": "" }],
    "edges": [["n1", "n2"], ["n2", "p4/n7"]],   // undirected, sorted
    "notes": [{ "id": "n9", "x": 0, "y": 0, "text": "", "size": "m" }],
    "placements": [{ "id": "p4", "treeId": "t2", "x": 320, "y": -40 }]
  }]
}
```

Writes are normalized for minimal diffs: integer coordinates, records sorted by
id, each edge's endpoints sorted, the edge list sorted.

**Start points are walls.** In Preview, a cat's paths can never pass through (or
end on) another cat's start point, so regions meeting at a start node stay
separate. Only the chosen start is ever allocated.

Preview state (chosen start, allocation order, point budget) is play-test state.
It lives in localStorage per tree, not in the file.

## Clusters are placed by reference

Any tree can be **placed** into any other (`kind` only groups the picker). A
placement is `{id, treeId, x, y}`. It is an offset, with no rotation and no
copied nodes.

- **Flattening.** `flattenTree` expands placements recursively into one plain
  graph. Placed node ids are path-qualified (`p4/n7`, or `p4/p1/n7` when nested),
  positions are offset, and the cluster's own edges are re-prefixed. All
  rendering, hit-testing and Preview math run on the flattened graph.
- **Host links** are ordinary edges in the host tree whose endpoints may be
  qualified ids (`["n1", "p4/n7"]`).
- **Placed nodes are locked** in the host. In Build they are hover-only: they
  highlight and show their tooltip, but they can't be selected or edited. A press
  anywhere inside a placement's frame (on its nodes or empty space) selects and
  drags the whole placement; the host's own nodes, notes and links inside the
  frame still take the click first. Double-click inside the frame to open the
  cluster. Link to a placed
  node by dropping one of the host's own nodes onto it, or with `N` while hovering
  it. Two nodes inside the same placement can't be linked from the host, because
  that would be a cluster-internal link. In Preview every node is clickable.
- **Never-reused ids** (`seq` counters) mean a deleted cluster node can never be
  silently replaced by a new one that inherits a host's links.
- **Broken links.** A host edge whose endpoint no longer resolves is kept on
  disk, its surviving end is ringed red, and it is listed in the inspector to
  remove. It is never auto-deleted.
- **Cycles.** Placing a tree into itself, directly or transitively, is refused
  by `canPlace`, and `flattenTree` also guards against cycles.
- **Detach** turns a placement into plain copied nodes with fresh ids,
  rewriting host links onto the copies.
- **Deleting a tree** that other trees place is refused, with the list of users.
- **Notes** of a placed cluster are not shown in the host.

## UI

A NavRail tool, **Talent Trees**, laid out like the GUI Editor: a collapsible
tree list on the left (search; TREES and CLUSTERS sections with hover create /
delete; unsaved dots; the rail icon toggles it), a Build/Preview segmented tab
bar (plus name, Place cluster, undo/redo, Save), a full-bleed dark SVG
star-chart canvas, and an inspector on the right.

- **Interactions** are ported from the forge: double-click to add or edit,
  `N`, drag-onto-node to link, `L`, shift-select/box, `1`/`2`/`3`, `S`, `T`,
  `Del`, `Ctrl+D`, `G`, `F`, `P`, and pan/zoom.
- **Snap to grid** (`G`) is on by default and remembered across sessions
  (localStorage `talents.grid`).
- **Saving** is manual (`Ctrl+S` / Save), per the editor's no-auto-save
  convention.
- **Undo** has one history over the whole document.

Engine: `src/lib/talentTree.ts` (pure, vitest-covered). UI:
`src/pages/talent-trees/`.
