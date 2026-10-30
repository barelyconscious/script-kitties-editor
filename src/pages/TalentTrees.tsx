/**
 * TalentTrees — the Talent Trees tool: a PoE-style passive-tree editor ported
 * from the Talent Forge prototype. Clusters and trees live in one editor-owned
 * file (`editor.talents.json`); trees place clusters BY REFERENCE, so editing a
 * cluster updates every tree that uses it.
 *
 * Layout: toolbar · dark SVG canvas ({@link TalentCanvas}) · inspector
 * ({@link TalentInspector}). One undo history covers the whole document; saving
 * is manual (Ctrl+S), like the rest of the editor.
 *
 * @see design/talent_tree.md
 */

import { invoke } from "@tauri-apps/api/core";
import {
  Hammer,
  Loader2,
  type LucideIcon,
  PanelLeftOpen,
  Play,
  Redo2,
  Save,
  Shapes,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setPreference } from "@/lib/preferences";
import {
  addNode,
  addNote,
  boundsOf,
  canPlace,
  chainLink,
  createTree,
  DEFAULT_PREVIEW,
  deleteItems,
  deleteTree,
  detachPlacement,
  duplicateNodes,
  type Edge,
  edgeKey,
  emptyDoc,
  flattenTree,
  getTree,
  insertIntoEdge,
  link,
  type NodePatch,
  type NodeType,
  normalizeDoc,
  type PreviewState,
  patchNodes,
  patchNote,
  placeTree,
  previewClick,
  prunePreview,
  serializeDoc,
  type TalentDoc,
  type TalentNote,
  type TalentTree,
  type TreeKind,
  toggleLink,
  updateTree,
} from "@/lib/talentTree";
import { useHistoryState } from "@/lib/useHistoryState";
import { cn } from "@/lib/utils";
import { TalentCanvas, type TalentCanvasHandle } from "./talent-trees/TalentCanvas";
import { type InspectorActions, TalentInspector } from "./talent-trees/TalentInspector";
import { TalentTreeList } from "./talent-trees/TalentTreeList";
import {
  EMPTY_SELECTION,
  selectNodes,
  selectNote,
  selectPlacement,
  type TalentMode,
  type TalentSelection,
} from "./talent-trees/talentTypes";

// Per-viewer conveniences (not design data): the last open tree and each tree's
// Preview allocation. Guarded — storage can be unavailable.
const LS_LAST = "talents.lastTree";
const LS_PREVIEW = "talents.preview";
const LS_GRID = "talents.grid";
function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const isField = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
};

export type TalentTreesProps = {
  /** Whether this is the FOREGROUND tool (the page stays mounted; shortcuts only fire when active). */
  active?: boolean;
  /** Whether the tree list is collapsed. Owned by App via preferences; the rail icon toggles it. */
  listCollapsed?: boolean;
};

export default function TalentTrees({ active = false, listCollapsed = false }: TalentTreesProps) {
  const history = useHistoryState<TalentDoc>(emptyDoc());
  const doc = history.value;
  const [savedText, setSavedText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [treeId, setTreeIdState] = useState<string | null>(null);
  const [mode, setMode] = useState<TalentMode>("build");
  // Snap-to-grid defaults on and is remembered across sessions.
  const [grid, setGrid] = useState(() => lsGet(LS_GRID, true));
  const [selection, setSelection] = useState<TalentSelection>(EMPTY_SELECTION);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [transient, setTransient] = useState<TalentTree | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>(() =>
    lsGet(LS_PREVIEW, {}),
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const canvasRef = useRef<TalentCanvasHandle>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 2200);
  }, []);

  const setTreeId = useCallback((id: string | null) => {
    setTreeIdState(id);
    setSelection(EMPTY_SELECTION);
    setTransient(null);
    if (id) lsSet(LS_LAST, id);
  }, []);

  // ---- Load ---------------------------------------------------------------
  const { reset } = history;
  useEffect(() => {
    invoke<unknown>("get_talents")
      .then((raw) => {
        const loaded = normalizeDoc(raw);
        reset(loaded);
        setSavedText(serializeDoc(loaded));
        const last = lsGet<string | null>(LS_LAST, null);
        setTreeIdState(getTree(loaded, last) ? last : (loaded.trees[0]?.id ?? null));
      })
      .catch((e) => setLoadError(String(e)));
  }, [reset]);

  // ---- Derived ------------------------------------------------------------
  const viewDoc = useMemo(
    () => (transient ? updateTree(doc, transient.id, () => transient) : doc),
    [doc, transient],
  );
  const tree = getTree(viewDoc, treeId);
  const graph = useMemo(() => flattenTree(viewDoc, treeId ?? ""), [viewDoc, treeId]);
  const preview = useMemo(
    () => prunePreview(graph, (treeId && previews[treeId]) || DEFAULT_PREVIEW),
    [graph, previews, treeId],
  );
  const docText = useMemo(() => serializeDoc(doc), [doc]);
  const dirty = savedText !== null && docText !== savedText;
  // Which trees differ from the last save (the list's unsaved dots). Compared in
  // canonical form so a load-then-save round trip never reads as a change.
  const dirtyIds = useMemo(() => {
    const ids = new Set<string>();
    if (!dirty || savedText === null) return ids;
    const canon = (t: TalentTree) => serializeDoc({ version: 1, seq: 0, trees: [t] });
    const saved = new Map(normalizeDoc(JSON.parse(savedText)).trees.map((t) => [t.id, canon(t)]));
    for (const t of doc.trees) if (saved.get(t.id) !== canon(t)) ids.add(t.id);
    return ids;
  }, [doc, dirty, savedText]);

  // Drop selections that no longer exist (after undo, delete, cluster edits).
  useEffect(() => {
    setSelection((s) => {
      const nodes = s.nodes.filter((id) => graph.nodes.has(id));
      const edge = s.edge && graph.edges.some((e) => e.key === s.edge) ? s.edge : null;
      const note = s.note && tree?.notes.some((m) => m.id === s.note) ? s.note : null;
      const placement =
        s.placement && graph.placements.some((p) => p.id === s.placement) ? s.placement : null;
      if (
        nodes.length === s.nodes.length &&
        edge === s.edge &&
        note === s.note &&
        placement === s.placement
      ) {
        return s;
      }
      return { nodes, edge, note, placement };
    });
  }, [graph, tree]);

  // ---- Edit plumbing --------------------------------------------------------
  const docRef = useRef(doc);
  docRef.current = doc;
  /** Record a new document. `soft` edits (typing) coalesce into one undo step. */
  const applyDoc = useCallback(
    (next: TalentDoc, soft = false) => {
      history.set(next);
      if (!soft) history.commit();
    },
    [history],
  );
  const applyTree = useCallback(
    (fn: (t: TalentTree) => TalentTree, soft = false) => {
      if (!treeId) return;
      applyDoc(updateTree(docRef.current, treeId, fn), soft);
    },
    [applyDoc, treeId],
  );
  const currentTree = () => getTree(docRef.current, treeId);

  const setPreview = useCallback(
    (p: PreviewState) => {
      if (!treeId) return;
      setPreviews((all) => {
        const next = { ...all, [treeId]: p };
        lsSet(LS_PREVIEW, next);
        return next;
      });
    },
    [treeId],
  );

  const focusField = useCallback((field: "title" | "note") => {
    requestAnimationFrame(() => {
      const el = document.getElementById(
        field === "title" ? "tt-title" : "tt-note",
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }, []);

  // ---- Actions --------------------------------------------------------------
  const localSel = selection.nodes;

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await invoke("save_talents", { contents: docText });
      setSavedText(docText);
      toast("Saved");
    } catch (e) {
      toast(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, docText, toast]);

  const addNodeAt = (x: number, y: number, linkFrom?: string | null) => {
    const t = currentTree();
    if (!t) return;
    const r = addNode(t, x, y, linkFrom);
    applyTree(() => r.tree);
    setSelection(selectNodes([r.id]));
  };

  const addNoteAt = (x: number, y: number) => {
    const t = currentTree();
    if (!t) return;
    const r = addNote(t, x, y);
    applyTree(() => r.tree);
    setSelection(selectNote(r.id));
    focusField("note");
  };

  const nKey = () => {
    const t = currentTree();
    if (!t) return;
    if (selection.edge) {
      const e = graph.edges.find((x) => x.key === selection.edge);
      const A = e && graph.nodes.get(e.a);
      const B = e && graph.nodes.get(e.b);
      if (!A || !B) return;
      const r = insertIntoEdge(t, selection.edge, (A.x + B.x) / 2, (A.y + B.y) / 2);
      if (!r) return;
      applyTree(() => r.tree);
      setSelection(selectNodes([r.id]));
      toast("Inserted a node into the link");
      return;
    }
    const one = selection.nodes.length === 1 ? selection.nodes[0] : null;
    const over = canvasRef.current?.hoverId() ?? null;
    if (one && over && over !== one) {
      const r = link(t, one, over);
      if (!r.ok) return toast(r.reason);
      applyTree(() => r.tree);
      return toast("Linked");
    }
    const w = canvasRef.current?.mouseWorld() ?? { x: 0, y: 0 };
    addNodeAt(w.x, w.y, one);
    if (one) toast("Added a linked node");
  };

  const linkSelection = () => {
    const t = currentTree();
    const ids = selection.nodes;
    if (!t) return;
    if (ids.length < 2) return toast("Select two nodes, then press L to link them");
    if (ids.length === 2) {
      const r = toggleLink(t, ids[0], ids[1]);
      if (!r.ok) return toast(r.reason);
      applyTree(() => r.tree);
      return toast(r.action === "linked" ? "Linked" : "Unlinked");
    }
    const r = chainLink(t, ids);
    applyTree(() => r.tree);
    toast(`Linked ${ids.length} nodes in selection order`);
  };

  const deleteSelection = () => {
    if (selection.note) {
      applyTree((t) => deleteItems(t, { notes: [selection.note as string] }));
      setSelection(EMPTY_SELECTION);
      return toast("Note deleted");
    }
    if (selection.edge) {
      applyTree((t) => deleteItems(t, { edges: [selection.edge as string] }));
      setSelection(EMPTY_SELECTION);
      return toast("Link removed");
    }
    if (selection.placement) {
      applyTree((t) => deleteItems(t, { placements: [selection.placement as string] }));
      setSelection(EMPTY_SELECTION);
      return toast("Cluster removed from this tree");
    }
    if (!selection.nodes.length) return;
    applyTree((t) => deleteItems(t, { nodes: localSel }));
    setSelection(EMPTY_SELECTION);
    toast(localSel.length === 1 ? "Node deleted" : `${localSel.length} nodes deleted`);
  };

  const editLocal = (patch: NodePatch) => {
    if (!localSel.length) return;
    applyTree((t) => patchNodes(t, localSel, patch));
  };
  const setType = (type: NodeType) => editLocal({ type });
  const toggleStart = () => {
    const t = currentTree();
    if (!t || !localSel.length) return;
    const to = !localSel.every((id) => t.nodes.find((n) => n.id === id)?.start);
    editLocal({ start: to });
    toast(to ? "Marked as start point" : "Start point removed");
  };
  const duplicate = () => {
    const t = currentTree();
    if (!t || !localSel.length) return;
    const r = duplicateNodes(t, localSel);
    applyTree(() => r.tree);
    setSelection(selectNodes(r.ids));
    toast(`Duplicated ${r.ids.length}`);
  };

  const openTree = (id: string, focusNode?: string) => {
    setMode("build");
    setTreeId(id);
    if (focusNode) setSelection(selectNodes([focusNode]));
  };

  const placeCluster = (childId: string) => {
    if (!treeId) return;
    const child = getTree(docRef.current, childId);
    if (!child) return;
    const center = canvasRef.current?.centerWorld() ?? { x: 0, y: 0 };
    const b = boundsOf(flattenTree(docRef.current, childId).nodes.values());
    const ox = center.x - (b ? (b.x0 + b.x1) / 2 : 0);
    const oy = center.y - (b ? (b.y0 + b.y1) / 2 : 0);
    const r = placeTree(docRef.current, treeId, childId, ox, oy);
    if (!r) return toast("That would place a tree inside itself");
    applyDoc(r.doc);
    setMode("build");
    setSelection(selectPlacement(r.id));
    toast(`Placed ${child.name}. Drag its frame to position it.`);
  };

  const newTree = (kind: TreeKind) => {
    const n = docRef.current.trees.filter((t) => t.kind === kind).length + 1;
    const r = createTree(
      docRef.current,
      kind === "cluster" ? `New cluster ${n}` : `New tree ${n}`,
      kind,
    );
    applyDoc(r.doc);
    openTree(r.id);
    requestAnimationFrame(() => {
      const el = document.getElementById("tt-tree-name") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  };

  const removeTree = (id: string) => {
    const target = getTree(docRef.current, id);
    if (!target) return;
    const r = deleteTree(docRef.current, id);
    if (r.blockedBy) {
      return toast(
        `${target.name} is placed in ${r.blockedBy.map((t) => t.name).join(", ")}. Remove it there first.`,
      );
    }
    if (!window.confirm(`Delete “${target.name}”? Undo (Ctrl+Z) brings it back.`)) return;
    applyDoc(r.doc);
    if (id === treeId) setTreeId(r.doc.trees[0]?.id ?? null);
    toast(`Deleted ${target.name}`);
  };

  const actions: InspectorActions = {
    select: setSelection,
    setHighlight,
    patchNodes: (ids, patch, soft) => applyTree((t) => patchNodes(t, ids, patch), soft),
    patchNote: (id, patch: Partial<Omit<TalentNote, "id">>, soft) =>
      applyTree((t) => patchNote(t, id, patch), soft),
    linkSelection,
    duplicate,
    deleteSelection,
    removeBroken: ([a, b]: Edge) =>
      applyTree((t) => ({
        ...t,
        edges: t.edges.filter(([x, y]) => edgeKey(x, y) !== edgeKey(a, b)),
      })),
    openTree,
    detachPlacement: (pid) => {
      if (!treeId) return;
      applyDoc(detachPlacement(docRef.current, treeId, pid));
      setSelection(EMPTY_SELECTION);
      toast("Detached into plain nodes");
    },
    removePlacement: (pid) => {
      applyTree((t) => deleteItems(t, { placements: [pid] }));
      setSelection(EMPTY_SELECTION);
      toast("Cluster removed from this tree");
    },
    setPreview,
    previewClick: (id) => onPreviewClick(id),
    commitHistory: history.commit,
  };

  const onPreviewClick = (id: string) => {
    const r = previewClick(graph, preview, id);
    if (r.kind === "noop") {
      if (r.message) toast(r.message);
      return;
    }
    setPreview(r.state);
    if (r.kind === "start") {
      const n = graph.nodes.get(id);
      toast(`Starting from ${n?.startName || n?.title || "this point"}`);
    } else if (r.kind === "refund")
      toast(r.refunded === 1 ? "Refunded 1 point" : `Refunded ${r.refunded} points`);
  };

  // ---- Keyboard -------------------------------------------------------------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      void save();
      return;
    }
    if (mod && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (isField(e.target)) {
      if (key === "escape") (e.target as HTMLElement).blur();
      return;
    }
    if (!tree) return;
    if (key === "p" && !mod) return setMode((m) => (m === "build" ? "preview" : "build"));
    if (key === "f" && !mod) return canvasRef.current?.fit();
    if (mode !== "build") return;
    if (mod && key === "a") {
      e.preventDefault();
      setSelection(selectNodes(tree.nodes.map((n) => n.id)));
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      duplicate();
      return;
    }
    if (mod) return;
    if (key === "n") nKey();
    else if (key === "l") linkSelection();
    else if (key === "delete" || key === "backspace") {
      e.preventDefault();
      deleteSelection();
    } else if (key === "1") setType("minor");
    else if (key === "2") setType("notable");
    else if (key === "3") setType("keystone");
    else if (key === "s") toggleStart();
    else if (key === "g") toggleGrid();
    else if (key === "t") {
      e.preventDefault();
      const w = canvasRef.current?.mouseWorld() ?? { x: 0, y: 0 };
      addNoteAt(w.x, w.y);
    } else if (key === "escape") setSelection(EMPTY_SELECTION);
  };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const toggleGrid = () => {
    setGrid((g) => {
      toast(g ? "Snap to grid off" : "Snap to grid on");
      lsSet(LS_GRID, !g);
      return !g;
    });
  };

  // Warn on app close / reload with unsaved edits (nothing auto-saves).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ---- Render ---------------------------------------------------------------
  if (loadError) {
    return (
      <div className="p-6 text-destructive text-sm">
        Could not load editor.talents.json: {loadError}. Fix the file by hand, then reopen this
        tool.
      </div>
    );
  }
  if (savedText === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const placeable = tree
    ? doc.trees.filter((t) => t.id !== tree.id && canPlace(doc, tree.id, t.id))
    : [];
  const placeableClusters = placeable.filter((t) => t.kind === "cluster");
  const placeableTrees = placeable.filter((t) => t.kind === "tree");

  return (
    <div className="flex h-full min-h-0">
      {listCollapsed ? (
        <CollapsedListRail onShow={() => setPreference("talents.listCollapsed", false)} />
      ) : (
        <TalentTreeList
          trees={doc.trees}
          activeId={treeId}
          dirtyIds={dirtyIds}
          onOpen={(id) => openTree(id)}
          onCreate={newTree}
          onDelete={removeTree}
          onCollapse={() => setPreference("talents.listCollapsed", true)}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Build / Preview tab bar: the same segmented pill as the GUI Editor's
        View / Controller / XML bar. */}
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <div
            className="flex items-center gap-0.5 rounded-md border p-0.5"
            role="tablist"
            aria-label="Mode"
          >
            <TabButton
              active={mode === "build"}
              disabled={!tree}
              onSelect={() => setMode("build")}
              Icon={Hammer}
              label="Build"
            />
            <TabButton
              active={mode === "preview"}
              disabled={!tree}
              onSelect={() => setMode("preview")}
              Icon={Play}
              label="Preview"
            />
          </div>
          {tree && (
            <Input
              id="tt-tree-name"
              className="h-7 w-56 text-sm"
              aria-label="Name"
              value={tree.name}
              spellCheck={false}
              onChange={(e) => applyTree((t) => ({ ...t, name: e.target.value }), true)}
              onBlur={history.commit}
            />
          )}
          {tree && mode === "build" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  disabled={!placeable.length}
                >
                  <Shapes /> Place cluster
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {placeableClusters.length > 0 && <DropdownMenuLabel>Clusters</DropdownMenuLabel>}
                {placeableClusters.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => placeCluster(t.id)}>
                    {t.name}
                  </DropdownMenuItem>
                ))}
                {placeableClusters.length > 0 && placeableTrees.length > 0 && (
                  <DropdownMenuSeparator />
                )}
                {placeableTrees.length > 0 && <DropdownMenuLabel>Trees</DropdownMenuLabel>}
                {placeableTrees.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => placeCluster(t.id)}>
                    {t.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex-1" />
          <span className="text-muted-foreground text-xs">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Undo2 />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Redo2 />
          </Button>
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="h-7 gap-1.5 px-2.5 text-xs"
            title={dirty ? "Save all trees and clusters (Ctrl+S)" : "No unsaved changes"}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
        </div>

        {tree ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
            <TalentCanvas
              ref={canvasRef}
              tree={tree}
              graph={graph}
              mode={mode}
              grid={grid}
              onToggleGrid={toggleGrid}
              selection={selection}
              onSelect={setSelection}
              preview={preview}
              onPreviewClick={onPreviewClick}
              highlight={highlight}
              onTransient={setTransient}
              onCommit={(t) => applyDoc(updateTree(docRef.current, t.id, () => t))}
              onAddNode={(x, y) => addNodeAt(x, y)}
              onAddNote={addNoteAt}
              onFocusField={focusField}
              onOpenTree={(id) => openTree(id)}
              toast={toast}
              toastMessage={toastMessage}
              active={active}
            />
            <aside className="min-w-0 overflow-y-auto border-l">
              <TalentInspector
                tree={tree}
                graph={graph}
                trees={doc.trees}
                mode={mode}
                selection={selection}
                preview={preview}
                actions={actions}
              />
            </aside>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="grid max-w-sm gap-3 text-center">
              <h2 className="font-semibold text-lg">No talent trees yet</h2>
              <p className="text-muted-foreground text-sm">
                Build small <b>clusters</b>, then place them into a <b>tree</b> and link them up.
                Editing a cluster updates every tree that uses it.
              </p>
              <div className="flex justify-center gap-2">
                <Button onClick={() => newTree("cluster")}>New cluster</Button>
                <Button variant="outline" onClick={() => newTree("tree")}>
                  New tree
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  disabled,
  onSelect,
  Icon,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  Icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-2 py-1 font-medium text-xs transition-colors disabled:opacity-50",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

/** Slim labelled strip shown in place of the collapsed tree list (mirrors the GUI Editor's). */
function CollapsedListRail({ onShow }: { onShow: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Show tree list"
          onClick={onShow}
          className="flex h-full w-9 shrink-0 flex-col items-center border-r bg-sidebar py-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4 shrink-0" />
          <span className="flex min-h-0 flex-1 items-center">
            <span className="text-xs uppercase tracking-wide [writing-mode:vertical-rl]">
              Trees
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Show tree list</TooltipContent>
    </Tooltip>
  );
}
