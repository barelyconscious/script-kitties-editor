/**
 * TalentInspector — the right-hand panel of the Talent Trees tool. Shows whatever
 * is selected (node / several nodes / link / note), the tree overview when
 * nothing is, or the allocation panel in Preview. Placed cluster nodes are
 * read-only here; their actions (edit the cluster, detach, remove) act on the
 * placement.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type Edge,
  type FlatGraph,
  type FlatNode,
  NODE_TYPE_ORDER,
  NODE_TYPES,
  type NodePatch,
  type NodeType,
  type NoteSize,
  type PreviewState,
  type TalentNote,
  type TalentTree,
  TINTS,
  type TintName,
} from "@/lib/talentTree";
import { cn } from "@/lib/utils";
import { selectNodes, selectPlacement, type TalentMode, type TalentSelection } from "./talentTypes";

export type InspectorActions = {
  select: (sel: TalentSelection) => void;
  setHighlight: (id: string | null) => void;
  patchNodes: (ids: string[], patch: NodePatch, soft?: boolean) => void;
  patchNote: (id: string, patch: Partial<Omit<TalentNote, "id">>, soft?: boolean) => void;
  linkSelection: () => void;
  duplicate: () => void;
  deleteSelection: () => void;
  removeBroken: (edge: Edge) => void;
  openTree: (treeId: string, focusNode?: string) => void;
  detachPlacement: (placementId: string) => void;
  removePlacement: (placementId: string) => void;
  setPreview: (p: PreviewState) => void;
  previewClick: (nodeId: string) => void;
  commitHistory: () => void;
};

type Props = {
  tree: TalentTree;
  graph: FlatGraph;
  trees: TalentTree[];
  mode: TalentMode;
  selection: TalentSelection;
  preview: PreviewState;
  actions: InspectorActions;
};

export function TalentInspector(props: Props) {
  const { tree, graph, mode, selection } = props;
  if (mode === "preview") return <PreviewPanel {...props} />;
  const note = selection.note ? tree.notes.find((m) => m.id === selection.note) : undefined;
  if (note) return <NotePanel note={note} actions={props.actions} />;
  if (selection.edge) return <EdgePanel {...props} edgeKey={selection.edge} />;
  if (selection.placement) return <PlacementPanel {...props} placementId={selection.placement} />;
  const nodes = selection.nodes.map((id) => graph.nodes.get(id)).filter((n): n is FlatNode => !!n);
  if (nodes.length === 1) return <NodePanel {...props} node={nodes[0]} />;
  if (nodes.length > 1) return <MultiPanel {...props} nodes={nodes} />;
  return <TreePanel {...props} />;
}

// ---------------------------------------------------------------------------

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b p-4">
      <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>;
}

function nodeName(n: { title: string; type: NodeType } | undefined) {
  if (!n) return "Missing node";
  return n.title || `Untitled ${NODE_TYPES[n.type].label.toLowerCase()}`;
}

function TypeIcon({ t }: { t: NodeType }) {
  const r = { minor: 6, notable: 9, keystone: 12 }[t];
  return (
    <svg width="30" height="30" viewBox="-15 -15 30 30" aria-hidden="true">
      {t === "keystone" && (
        <circle r="14" fill="none" stroke="#b08a52" strokeWidth="1.6" strokeDasharray="1.5 3" />
      )}
      <circle r={r} fill="#1b2029" stroke="#b08a52" strokeWidth={t === "minor" ? 1.8 : 2.4} />
      {t !== "minor" && <circle r={r - 3.5} fill="none" stroke="#6b5534" />}
    </svg>
  );
}

function TypePicker({ value, onPick }: { value?: NodeType; onPick: (t: NodeType) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {NODE_TYPE_ORDER.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick(t)}
          className={cn(
            "grid justify-items-center gap-1 rounded-md border px-1 pt-2 pb-1.5 text-muted-foreground text-xs",
            value === t && "border-primary text-foreground",
          )}
        >
          <TypeIcon t={t} />
          {NODE_TYPES[t].label}
        </button>
      ))}
    </div>
  );
}

function TintPicker({ value, onPick }: { value?: TintName; onPick: (t: TintName) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(TINTS) as TintName[]).map((k) => (
        <button
          key={k}
          type="button"
          title={k}
          aria-label={`Tint ${k}`}
          onClick={() => onPick(k)}
          className={cn(
            "size-6 rounded-full border-2",
            value === k ? "border-foreground" : "border-border",
          )}
          style={{ background: TINTS[k] }}
        />
      ))}
    </div>
  );
}

function NodeChips({
  ids,
  graph,
  actions,
}: {
  ids: string[];
  graph: FlatGraph;
  actions: InspectorActions;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="rounded-full border px-2.5 py-0.5 text-xs hover:border-primary"
          onClick={() => actions.select(selectFor(graph, id))}
          onMouseEnter={() => actions.setHighlight(id)}
          onMouseLeave={() => actions.setHighlight(null)}
        >
          {nodeName(graph.nodes.get(id))}
        </button>
      ))}
    </div>
  );
}

/** Selecting a node from a list: the tree's own nodes select directly; a placed
 *  node selects its placement (placed nodes aren't individually selectable). */
function selectFor(graph: FlatGraph, id: string): TalentSelection {
  const p = graph.nodes.get(id)?.placementId;
  return p ? selectPlacement(p) : selectNodes([id]);
}

function neighbours(graph: FlatGraph, id: string): string[] {
  const out: string[] = [];
  for (const e of graph.edges) {
    if (e.a === id) out.push(e.b);
    else if (e.b === id) out.push(e.a);
  }
  return out;
}

// ---------------------------------------------------------------------------

function NodePanel({ node, graph, actions }: Props & { node: FlatNode }) {
  const adj = neighbours(graph, node.id);
  const links = (
    <Section title={`Links · ${adj.length}`}>
      {adj.length ? (
        <NodeChips ids={adj} graph={graph} actions={actions} />
      ) : (
        <Muted>
          Not linked yet. Drag this node onto another, or shift-click a second node and press L.
        </Muted>
      )}
    </Section>
  );

  const ids = [node.id];
  return (
    <>
      <Section title="Node">
        <div className="grid gap-1.5">
          <Label htmlFor="tt-title">Title</Label>
          <Input
            id="tt-title"
            value={node.title}
            placeholder="e.g. Ambush"
            spellCheck={false}
            onChange={(e) => actions.patchNodes(ids, { title: e.target.value }, true)}
            onBlur={actions.commitHistory}
          />
        </div>
        <TypePicker value={node.type} onPick={(type) => actions.patchNodes(ids, { type })} />
        <div className="grid gap-1.5">
          <Label htmlFor="tt-text">Description</Label>
          <Textarea
            id="tt-text"
            value={node.text}
            rows={4}
            placeholder="e.g. Your first attack from stealth each battle is a critical hit."
            onChange={(e) => actions.patchNodes(ids, { text: e.target.value }, true)}
            onBlur={actions.commitHistory}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Tint</Label>
          <TintPicker value={node.tint} onPick={(tint) => actions.patchNodes(ids, { tint })} />
        </div>
      </Section>
      <Section title="Start point">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={node.start}
            onChange={(e) => actions.patchNodes(ids, { start: e.target.checked })}
          />
          Cats can start here
        </label>
        {node.start ? (
          <div className="grid gap-1.5">
            <Label htmlFor="tt-start">Start name</Label>
            <Input
              id="tt-start"
              value={node.startName}
              placeholder="e.g. Big Dam"
              spellCheck={false}
              onChange={(e) => actions.patchNodes(ids, { startName: e.target.value }, true)}
              onBlur={actions.commitHistory}
            />
          </div>
        ) : (
          <Muted>A start point is where a cat begins. It is free in Preview, and other cats can't path through it.</Muted>
        )}
      </Section>
      {links}
      <section className="flex gap-2 p-4">
        <Button size="sm" variant="outline" onClick={actions.duplicate}>
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          onClick={actions.deleteSelection}
        >
          Delete node
        </Button>
      </section>
    </>
  );
}

function PlacementPanel(props: Props & { placementId: string }) {
  const { graph, actions, placementId } = props;
  const p = graph.placements.find((x) => x.id === placementId);
  if (!p) return <TreePanel {...props} />;
  const inside = [...graph.nodes.values()].filter((n) => n.placementId === p.id);
  const links = graph.edges.filter(
    (e) => e.owned && (inside.some((n) => n.id === e.a) || inside.some((n) => n.id === e.b)),
  );
  const count = (t: NodeType) => inside.filter((n) => n.type === t).length;
  return (
    <>
      <Section title="Placed cluster">
        <div className={cn("font-medium", !p.name && "text-destructive")}>
          {p.name ?? "Missing cluster"}
        </div>
        <Muted>
          {count("minor")} minor · {count("notable")} notable · {count("keystone")} keystone. Drag
          anywhere inside its frame to move it. Its nodes are edited in the cluster, and
          every tree that places it updates.
        </Muted>
        <div className="flex flex-wrap gap-2">
          {p.name && (
            <Button size="sm" onClick={() => actions.openTree(p.treeId)}>
              Edit {p.name}
            </Button>
          )}
          {p.name && (
            <Button size="sm" variant="outline" onClick={() => actions.detachPlacement(p.id)}>
              Detach as copy
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => actions.removePlacement(p.id)}
          >
            Remove from tree
          </Button>
        </div>
      </Section>
      <Section title={`Links into it · ${links.length}`}>
        {links.length ? (
          <div className="grid gap-1 text-sm">
            {links.map((e) => {
              const [outside, inner] = inside.some((n) => n.id === e.a) ? [e.b, e.a] : [e.a, e.b];
              return (
                <button
                  key={e.key}
                  type="button"
                  title="Select the linked node"
                  className="truncate rounded px-1 py-0.5 text-left hover:bg-muted"
                  onClick={() => actions.select(selectFor(graph, outside))}
                  onMouseEnter={() => actions.setHighlight(inner)}
                  onMouseLeave={() => actions.setHighlight(null)}
                >
                  {nodeName(graph.nodes.get(outside))} → <b>{nodeName(graph.nodes.get(inner))}</b>
                </button>
              );
            })}
          </div>
        ) : (
          <Muted>
            Nothing links into it yet. Drag one of this tree's nodes onto a cluster node to link
            them.
          </Muted>
        )}
      </Section>
    </>
  );
}

function MultiPanel({ nodes, actions }: Props & { nodes: FlatNode[] }) {
  const local = nodes.map((n) => n.id);
  const count = (t: NodeType) => nodes.filter((n) => n.type === t).length;
  return (
    <Section title={`${nodes.length} nodes selected`}>
      <Muted>
        {count("minor")} minor · {count("notable")} notable · {count("keystone")} keystone
      </Muted>
      {local.length > 0 && (
        <>
          <TypePicker onPick={(type) => actions.patchNodes(local, { type })} />
          <TintPicker onPick={(tint) => actions.patchNodes(local, { tint })} />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={actions.linkSelection}>
          Link in selection order
        </Button>
        {local.length > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={actions.duplicate}>
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={actions.deleteSelection}
            >
              Delete
            </Button>
          </>
        )}
      </div>
    </Section>
  );
}

function EdgePanel({ graph, actions, edgeKey }: Props & { edgeKey: string }) {
  const e = graph.edges.find((x) => x.key === edgeKey);
  return (
    <Section title="Link">
      {e ? (
        <Muted>
          Connects <b className="text-foreground">{nodeName(graph.nodes.get(e.a))}</b> and{" "}
          <b className="text-foreground">{nodeName(graph.nodes.get(e.b))}</b>. Press <kbd>N</kbd> to
          insert a node into it.
        </Muted>
      ) : (
        <Muted>This link no longer exists.</Muted>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          onClick={actions.deleteSelection}
        >
          Remove link
        </Button>
      </div>
    </Section>
  );
}

function NotePanel({ note, actions }: { note: TalentNote; actions: InspectorActions }) {
  return (
    <Section title="Note">
      <Muted>
        A reminder for you. Notes only show in Build, and only in the tree they belong to.
      </Muted>
      <Textarea
        id="tt-note"
        value={note.text}
        rows={4}
        placeholder="e.g. This is the Stalker cluster"
        onChange={(e) => actions.patchNote(note.id, { text: e.target.value }, true)}
        onBlur={actions.commitHistory}
      />
      <div className="flex gap-1">
        {(
          [
            ["s", "Small"],
            ["m", "Medium"],
            ["l", "Large"],
          ] as [NoteSize, string][]
        ).map(([k, l]) => (
          <Button
            key={k}
            size="sm"
            variant={note.size === k ? "default" : "outline"}
            onClick={() => actions.patchNote(note.id, { size: k })}
          >
            {l}
          </Button>
        ))}
      </div>
      <div>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          onClick={actions.deleteSelection}
        >
          Delete note
        </Button>
      </div>
    </Section>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="font-semibold text-xl tabular-nums">{value}</div>
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["Double-click", "Add a node, or edit an existing one"],
  [
    "N",
    "Add a node at the cursor linked to the selection; over another node, link to it; with a link selected, insert a node",
  ],
  ["Drag onto node", "Link the dragged node to the one under it (including a placed cluster's nodes)"],
  ["Placed cluster", "Drag anywhere inside its frame to move it; double-click it to edit the cluster"],
  ["L", "Link or unlink two selected nodes; 3+ link in order"],
  ["Shift", "Click to add to the selection, drag for a box"],
  ["1 · 2 · 3", "Minor · Notable · Keystone"],
  ["S", "Toggle start point"],
  ["T", "Add a note at the cursor"],
  ["Del", "Delete selected nodes, link or note"],
  ["Ctrl D", "Duplicate selection with its links"],
  ["Ctrl Z", "Undo · Ctrl Shift Z redo"],
  ["Ctrl S", "Save"],
  ["G · F", "Snap to grid · fit view"],
  ["P", "Switch Build and Preview"],
  ["Drag empty", "Pan · wheel to zoom · Space or middle-drag pans too"],
];

function TreePanel({ tree, graph, trees, actions }: Props) {
  const all = [...graph.nodes.values()];
  const count = (t: NodeType) => all.filter((n) => n.type === t).length;
  const users = trees.filter(
    (t) => t.id !== tree.id && t.placements.some((p) => p.treeId === tree.id),
  );
  return (
    <>
      <Section title={tree.kind === "cluster" ? "This cluster" : "This tree"}>
        <div className="grid grid-cols-2 gap-2">
          <Stat value={count("minor")} label="Minor" />
          <Stat value={count("notable")} label="Notable" />
          <Stat value={count("keystone")} label="Keystone" />
          <Stat value={all.filter((n) => n.start).length} label="Start points" />
        </div>
        <Muted>
          {graph.edges.length} links
          {tree.notes.length
            ? ` · ${tree.notes.length} note${tree.notes.length > 1 ? "s" : ""}`
            : ""}
          {graph.placements.length
            ? ` · ${graph.placements.length} placed cluster${graph.placements.length > 1 ? "s" : ""}`
            : ""}
          . Counts include placed clusters.
        </Muted>
      </Section>

      {users.length > 0 && (
        <Section title="Placed in">
          <Muted>Changes here show up in:</Muted>
          <div className="flex flex-wrap gap-1.5">
            {users.map((u) => (
              <Button key={u.id} size="sm" variant="outline" onClick={() => actions.openTree(u.id)}>
                {u.name}
              </Button>
            ))}
          </div>
        </Section>
      )}

      {graph.placements.length > 0 && (
        <Section title="Placed clusters">
          <div className="grid gap-2">
            {graph.placements.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className={cn("min-w-0 flex-1 truncate", !p.name && "text-destructive")}>
                  {p.name ?? "Missing cluster"}
                </span>
                {p.name && (
                  <Button size="sm" variant="ghost" onClick={() => actions.openTree(p.treeId)}>
                    Edit
                  </Button>
                )}
                {p.name && (
                  <Button size="sm" variant="ghost" onClick={() => actions.detachPlacement(p.id)}>
                    Detach
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => actions.removePlacement(p.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {graph.broken.length > 0 && (
        <Section
          title={<span className="text-destructive">Broken links · {graph.broken.length}</span>}
        >
          <Muted>
            These links point at nodes that were deleted from a cluster. Re-link the surviving end
            if needed, then remove them.
          </Muted>
          <div className="grid gap-2">
            {graph.broken.map(([a, b]) => {
              const end = graph.nodes.get(a) ?? graph.nodes.get(b);
              return (
                <div key={`${a}|${b}`} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {end ? nodeName(end) : a} ↔ <span className="text-destructive">missing</span>
                  </span>
                  {end && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => actions.select(selectFor(graph, end.id))}
                    >
                      Show
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => actions.removeBroken([a, b])}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Controls">
        <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-muted-foreground text-sm">
          {KEYS.map(([k, v]) => (
            <div key={k} className="contents">
              <kbd className="whitespace-nowrap rounded border border-b-2 bg-muted px-1.5 text-foreground text-xs">
                {k}
              </kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function PreviewPanel({ graph, preview, actions }: Props) {
  const start = preview.start ? graph.nodes.get(preview.start) : undefined;
  const spent = preview.order.length;
  const { budget } = preview;
  const over = budget > 0 && spent > budget;
  const picked = preview.order.map((id) => graph.nodes.get(id)).filter((n): n is FlatNode => !!n);
  const big = picked.filter((n) => n.type !== "minor").length;
  const starts = [...graph.nodes.values()].filter((n) => n.start);
  return (
    <>
      <Section title="Build preview">
        {start ? (
          <Muted>
            Starting from <b className="text-foreground">{start.startName || nodeName(start)}</b>.
          </Muted>
        ) : starts.length ? (
          <div className="grid gap-2">
            <Muted>Click a start point to begin:</Muted>
            <div className="flex flex-wrap gap-1.5">
              {starts.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant="outline"
                  onClick={() => actions.previewClick(s.id)}
                >
                  {s.startName || nodeName(s)}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <Muted>This tree has no start points yet, so click any node to start there.</Muted>
        )}
        <div className={cn("font-semibold text-3xl tabular-nums", over && "text-destructive")}>
          {spent}
          <span className="font-normal text-muted-foreground text-sm">
            {" "}
            / {budget > 0 ? budget : "∞"} points
          </span>
        </div>
        {budget > 0 && (
          <div className="h-2 overflow-hidden rounded-full border">
            <div
              className={cn("h-full", over ? "bg-destructive" : "bg-amber-500")}
              style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }}
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="tt-budget">Point budget (0 for unlimited)</Label>
          <Input
            id="tt-budget"
            type="number"
            min={0}
            step={1}
            value={budget}
            onChange={(e) =>
              actions.setPreview({
                ...preview,
                budget: Math.max(0, Math.round(Number(e.target.value) || 0)),
              })
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat value={picked.filter((n) => n.type === "minor").length} label="Minor" />
          <Stat value={picked.filter((n) => n.type === "notable").length} label="Notable" />
          <Stat value={picked.filter((n) => n.type === "keystone").length} label="Keystone" />
          <Stat value={spent && big ? (spent / big).toFixed(1) : "–"} label="Pts / big node" />
        </div>
        <Muted>
          Hover a node to see the cheapest path to it, then click to allocate the whole path. Click
          an allocated node to refund it and everything that relied on it.
        </Muted>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!start}
            onClick={() => actions.setPreview({ ...preview, order: [] })}
          >
            Refund all
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!start}
            onClick={() => actions.setPreview({ ...preview, start: null, order: [] })}
          >
            Choose another start
          </Button>
        </div>
      </Section>
      <Section title="Allocation order">
        {picked.length ? (
          <ol className="grid gap-0.5">
            {picked.map((n, i) => (
              <li
                key={n.id}
                className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                onMouseEnter={() => actions.setHighlight(n.id)}
                onMouseLeave={() => actions.setHighlight(null)}
              >
                <span className="text-right text-muted-foreground tabular-nums">{i + 1}</span>
                <div>
                  <b className="font-medium">{nodeName(n)}</b>
                  {n.text && <span className="block text-muted-foreground text-xs">{n.text}</span>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Muted>Nothing allocated yet.</Muted>
        )}
      </Section>
    </>
  );
}
