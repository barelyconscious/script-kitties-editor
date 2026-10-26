/**
 * TalentCanvas — the SVG star-chart surface of the Talent Trees tool. Renders a
 * tree's FLATTENED graph (own nodes + placed clusters) and owns the pointer
 * gestures ported from the Talent Forge prototype: select / shift-select / box,
 * drag to move (a placed node drags its whole placement), drop onto a node to
 * link, pan, wheel zoom, double-click to add, and Preview-mode allocation clicks.
 *
 * Edits flow out as whole trees: `onTransient` during a drag (not recorded in
 * history), `onCommit` when a gesture finishes (one undo step).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { panBy, type ViewTransform, zoomTowardCursor } from "@/lib/guiGeometry";
import {
  allocatedSet,
  type Bounds,
  boundsOf,
  edgeKey,
  type FlatGraph,
  type FlatNode,
  fitBounds,
  GRID,
  hitEdge,
  hitNode,
  link,
  NODE_TYPES,
  NOTE_FONT,
  type Point,
  type PreviewState,
  shortestPath,
  snapToGrid,
  type TalentNote,
  type TalentTree,
  TINTS,
  translateItems,
} from "@/lib/talentTree";
import { cn } from "@/lib/utils";
import "./talentCanvas.css";
import {
  EMPTY_SELECTION,
  selectEdge,
  selectNodes,
  selectNote,
  selectPlacement,
  type TalentMode,
  type TalentSelection,
} from "./talentTypes";

export type TalentCanvasHandle = {
  fit: () => void;
  zoomBy: (factor: number) => void;
  /** World point under the cursor (last pointer position over the canvas). */
  mouseWorld: () => Point;
  /** World point at the viewport center. */
  centerWorld: () => Point;
  /** Id of the node under the cursor, if any. */
  hoverId: () => string | null;
};

type Props = {
  tree: TalentTree;
  graph: FlatGraph;
  mode: TalentMode;
  grid: boolean;
  onToggleGrid: () => void;
  selection: TalentSelection;
  onSelect: (sel: TalentSelection) => void;
  preview: PreviewState;
  onPreviewClick: (nodeId: string) => void;
  /** A node to ring (hovering a chip in the inspector). */
  highlight: string | null;
  onTransient: (tree: TalentTree | null) => void;
  onCommit: (tree: TalentTree) => void;
  onAddNode: (x: number, y: number) => void;
  onAddNote: (x: number, y: number) => void;
  /** Focus an inspector field after a double-click (title for nodes, text for notes). */
  onFocusField: (field: "title" | "note") => void;
  /** Open another tree (double-clicking a placement's handle opens its cluster). */
  onOpenTree: (treeId: string) => void;
  toast: (msg: string) => void;
  toastMessage: string | null;
  active: boolean;
};

type Drag =
  | {
      type: "pan";
      sx: number;
      sy: number;
      view: ViewTransform;
      moved: boolean;
      node: string | null;
    }
  | {
      type: "move";
      sx: number;
      sy: number;
      w0: Point;
      base: TalentTree;
      nodes: string[];
      placements: string[];
      anchor: string;
      anchorPos: Point;
      /** Exactly one LOCAL node is being dragged — the only case drop-to-link applies. */
      single: boolean;
      /** Plain click on a node that was already in a multi-selection: if it turns
       *  out not to be a drag, narrow the selection to just that node. */
      collapse: boolean;
      moved: boolean;
      /** Latest moved tree (what a drop commits) and the drop-to-link target. */
      last?: TalentTree;
      drop?: string | null;
    }
  | {
      type: "note";
      sx: number;
      sy: number;
      w0: Point;
      base: TalentTree;
      id: string;
      origin: Point;
      moved: boolean;
      last?: TalentTree;
    }
  | { type: "box"; x0: number; y0: number; x1: number; y1: number };

const DRAG_PX = 4;
const TYPE_ORDER = { minor: 0, notable: 1, keystone: 2 } as const;
const FRAME_PAD = 44;
const isLocal = (n: FlatNode) => !n.placementId;

// Per-tree cameras, so switching trees returns you to where you were looking
// instead of re-fitting. A per-viewer convenience (not design data), kept in
// localStorage like the Preview allocation; guarded since storage can be missing.
const LS_CAMERAS = "talents.cameras";
const cameras: Record<string, ViewTransform> = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_CAMERAS) ?? "{}") as Record<string, ViewTransform>;
  } catch {
    return {};
  }
})();
let cameraWrite: ReturnType<typeof setTimeout> | null = null;
function rememberCamera(treeId: string, view: ViewTransform) {
  cameras[treeId] = view;
  if (cameraWrite) clearTimeout(cameraWrite);
  cameraWrite = setTimeout(() => {
    try {
      localStorage.setItem(LS_CAMERAS, JSON.stringify(cameras));
    } catch {
      // ignore
    }
  }, 300);
}

export const TalentCanvas = forwardRef<TalentCanvasHandle, Props>(
  function TalentCanvas(props, ref) {
    const {
      tree,
      graph,
      mode,
      grid,
      onToggleGrid,
      selection,
      onSelect,
      preview,
      onPreviewClick,
      highlight,
      onTransient,
      onCommit,
      onAddNode,
      onAddNote,
      onFocusField,
      onOpenTree,
      toast,
      toastMessage,
      active,
    } = props;

    const stageRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [view, setView] = useState<ViewTransform>({ scale: 1, panX: 0, panY: 0 });
    const viewRef = useRef(view);
    viewRef.current = view;
    const [size, setSize] = useState({ w: 0, h: 0 });

    const dragRef = useRef<Drag | null>(null);
    const [box, setBox] = useState<Bounds | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [hover, setHover] = useState<FlatNode | null>(null);
    const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null);
    const [panning, setPanning] = useState(false);
    const mouseW = useRef<Point>({ x: 0, y: 0 });
    const spaceDown = useRef(false);
    const noteBoxes = useRef(new Map<string, Bounds>());

    // Latest props for stable event handlers.
    const live = useRef(props);
    live.current = props;

    const toWorld = useCallback((clientX: number, clientY: number): Point => {
      const r = svgRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: (clientX - (r?.left ?? 0) - v.panX) / v.scale,
        y: (clientY - (r?.top ?? 0) - v.panY) / v.scale,
      };
    }, []);

    // ---- View -------------------------------------------------------------
    const fitToContent = useCallback(() => {
      const { graph: g, tree: t, mode: m } = live.current;
      const el = stageRef.current;
      if (!el) return;
      const pts: Point[] = [...g.nodes.values()];
      if (m === "build") pts.push(...t.notes);
      setView(fitBounds(boundsOf(pts), el.clientWidth, el.clientHeight));
    }, []);

    useLayoutEffect(() => {
      const el = stageRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // Fit when a different tree opens (and once the stage first has a size).
    // On opening a tree, restore its remembered camera (or fit it the first time).
    // A LAYOUT effect so the new tree's first painted frame already uses its own
    // camera, never a flash of the previous tree's.
    const shownFor = useRef<string | null>(null);
    const justSwitched = useRef(false);
    useLayoutEffect(() => {
      // The page is mounted while hidden (zero width); wait until it has a size.
      const width = size.w || stageRef.current?.clientWidth;
      if (shownFor.current === tree.id || !width) return;
      // Keep the outgoing tree's camera (viewRef still holds it on this render).
      if (shownFor.current) rememberCamera(shownFor.current, viewRef.current);
      shownFor.current = tree.id;
      justSwitched.current = true;
      const saved = cameras[tree.id];
      if (saved) setView(saved);
      else fitToContent();
    }, [tree.id, size.w, fitToContent]);
    // Remember the on-screen tree's camera as it pans/zooms. The switch render's
    // run is skipped: its `view` is still the previous tree's.
    useEffect(() => {
      if (justSwitched.current) {
        justSwitched.current = false;
        return;
      }
      if (shownFor.current === tree.id) rememberCamera(tree.id, view);
    }, [view, tree.id]);

    useImperativeHandle(
      ref,
      () => ({
        fit: fitToContent,
        zoomBy: (f) => {
          const el = stageRef.current;
          if (!el) return;
          setView((v) => zoomTowardCursor(v, el.clientWidth / 2, el.clientHeight / 2, v.scale * f));
        },
        mouseWorld: () => mouseW.current,
        centerWorld: () => {
          const el = stageRef.current;
          const v = viewRef.current;
          if (!el) return { x: 0, y: 0 };
          return {
            x: (el.clientWidth / 2 - v.panX) / v.scale,
            y: (el.clientHeight / 2 - v.panY) / v.scale,
          };
        },
        hoverId: () => hoverRef.current?.id ?? null,
      }),
      [fitToContent],
    );
    const hoverRef = useRef(hover);
    hoverRef.current = hover;

    // Wheel zoom toward the cursor (non-passive so the page never scrolls).
    useEffect(() => {
      const svg = svgRef.current;
      if (!svg) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        setView((v) => zoomTowardCursor(v, e.clientX - r.left, e.clientY - r.top, v.scale * f));
      };
      svg.addEventListener("wheel", onWheel, { passive: false });
      return () => svg.removeEventListener("wheel", onWheel);
    }, []);

    // Hold Space to pan with the left button.
    useEffect(() => {
      if (!active) return;
      const isField = (t: EventTarget | null) => {
        const el = t as HTMLElement | null;
        return (
          !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
        );
      };
      const down = (e: KeyboardEvent) => {
        if (e.key === " " && !isField(e.target)) {
          spaceDown.current = true;
          e.preventDefault();
        }
      };
      const up = (e: KeyboardEvent) => {
        if (e.key === " ") spaceDown.current = false;
      };
      window.addEventListener("keydown", down);
      window.addEventListener("keyup", up);
      return () => {
        window.removeEventListener("keydown", down);
        window.removeEventListener("keyup", up);
      };
    }, [active]);

    // ---- Hit-testing --------------------------------------------------------
    const hitNote = useCallback((w: Point): string | null => {
      if (live.current.mode !== "build") return null;
      const t = 3 / viewRef.current.scale;
      let hit: string | null = null;
      for (const m of live.current.tree.notes) {
        const b = noteBoxes.current.get(m.id);
        if (b && w.x >= b.x0 - t && w.x <= b.x1 + t && w.y >= b.y0 - t && w.y <= b.y1 + t)
          hit = m.id;
      }
      return hit;
    }, []);

    // ---- Pointer gestures ---------------------------------------------------
    const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
      svgRef.current?.setPointerCapture(e.pointerId);
      setTipAt(null);
      const w = toWorld(e.clientX, e.clientY);
      // Build mode only clicks the tree's OWN nodes; placed cluster nodes are
      // hover-only and their placement moves by its handle.
      const n = hitNode(graph, w, view.scale, mode === "build" ? isLocal : undefined);
      const panDrag = (node: string | null): Drag => ({
        type: "pan",
        sx: e.clientX,
        sy: e.clientY,
        view,
        moved: false,
        node,
      });
      if (e.button === 1 || spaceDown.current || (mode === "preview" && !n)) {
        dragRef.current = panDrag(null);
        setPanning(true);
        return;
      }
      if (e.button !== 0) return;
      if (mode === "preview") {
        dragRef.current = panDrag(n?.id ?? null);
        return;
      }
      const handle = (e.target as Element)
        .closest?.("[data-placement]")
        ?.getAttribute("data-placement");
      const placement = handle ? graph.placements.find((p) => p.id === handle) : undefined;
      if (placement) {
        onSelect(selectPlacement(placement.id));
        dragRef.current = {
          type: "move",
          sx: e.clientX,
          sy: e.clientY,
          w0: w,
          base: tree,
          nodes: [],
          placements: [placement.id],
          anchor: placement.id,
          anchorPos: { x: placement.x, y: placement.y },
          single: false,
          collapse: false,
          moved: false,
        };
        return;
      }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const nt = !additive && !n ? hitNote(w) : null;
      if (nt) {
        const m = tree.notes.find((x) => x.id === nt);
        if (!m) return;
        onSelect(selectNote(nt));
        dragRef.current = {
          type: "note",
          sx: e.clientX,
          sy: e.clientY,
          w0: w,
          base: tree,
          id: nt,
          origin: { x: m.x, y: m.y },
          moved: false,
        };
        return;
      }
      if (n) {
        let sel = selection.nodes;
        const collapse = !additive && sel.length > 1 && sel.includes(n.id);
        if (additive) {
          if (sel.includes(n.id)) {
            onSelect(selectNodes(sel.filter((id) => id !== n.id)));
            return;
          }
          sel = [...sel, n.id];
        } else if (!sel.includes(n.id)) {
          sel = [n.id];
        }
        onSelect(selectNodes(sel));
        dragRef.current = {
          type: "move",
          sx: e.clientX,
          sy: e.clientY,
          w0: w,
          base: tree,
          nodes: sel,
          placements: [],
          anchor: n.id,
          anchorPos: { x: n.x, y: n.y },
          single: sel.length === 1,
          collapse,
          moved: false,
        };
        return;
      }
      const ed = hitEdge(graph, w, view.scale);
      if (ed?.owned && !additive) {
        onSelect(selectEdge(ed.key));
        return;
      }
      if (additive) {
        dragRef.current = { type: "box", x0: w.x, y0: w.y, x1: w.x, y1: w.y };
        setBox({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
        return;
      }
      dragRef.current = panDrag(null);
    };

    const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
      const w = toWorld(e.clientX, e.clientY);
      mouseW.current = w;
      const d = dragRef.current;
      if (d) {
        if (d.type === "pan") {
          const dx = e.clientX - d.sx;
          const dy = e.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) > DRAG_PX) {
            d.moved = true;
            setPanning(true);
          }
          if (d.moved) setView(panBy(d.view, dx, dy));
          return;
        }
        if (d.type === "move" || d.type === "note") {
          if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_PX) d.moved = true;
          if (!d.moved) return;
          if (d.type === "note") {
            const dx = snapToGrid(d.origin.x + w.x - d.w0.x, grid) - d.origin.x;
            const dy = snapToGrid(d.origin.y + w.y - d.w0.y, grid) - d.origin.y;
            d.last = translateItems(d.base, { notes: [d.id] }, dx, dy);
            onTransient(d.last);
            return;
          }
          const ax = snapToGrid(d.anchorPos.x + w.x - d.w0.x, grid);
          const ay = snapToGrid(d.anchorPos.y + w.y - d.w0.y, grid);
          d.last = translateItems(
            d.base,
            { nodes: d.nodes, placements: d.placements },
            ax - d.anchorPos.x,
            ay - d.anchorPos.y,
          );
          onTransient(d.last);
          if (d.single) {
            d.drop =
              hitNode(graph, { x: ax, y: ay }, view.scale, (o) => o.id !== d.anchor)?.id ?? null;
            setDropTarget(d.drop);
          }
          return;
        }
        if (d.type === "box") {
          d.x1 = w.x;
          d.y1 = w.y;
          setBox({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 });
          return;
        }
      }
      const n = hitNode(graph, w, view.scale);
      const clickable = mode === "preview" ? !!n : (!!n && isLocal(n)) || !!hitNote(w);
      svgRef.current?.classList.toggle("overnode", clickable);
      if ((n?.id ?? null) !== (hover?.id ?? null)) setHover(n);
      const r = stageRef.current?.getBoundingClientRect();
      setTipAt(n && r ? { x: e.clientX - r.left, y: e.clientY - r.top } : null);
    };

    const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
      svgRef.current?.releasePointerCapture(e.pointerId);
      const d = dragRef.current;
      dragRef.current = null;
      setPanning(false);
      if (!d) return;
      if (d.type === "pan") {
        if (d.moved) return;
        if (mode === "preview" && d.node) onPreviewClick(d.node);
        else if (
          mode === "build" &&
          (selection.nodes.length || selection.edge || selection.note || selection.placement)
        ) {
          onSelect(EMPTY_SELECTION);
        }
        return;
      }
      if (d.type === "move") {
        if (!d.moved) {
          if (d.collapse) onSelect(selectNodes([d.anchor]));
          return;
        }
        if (d.drop) {
          // Dropped onto a node: link instead of moving.
          const r = link(d.base, d.anchor, d.drop);
          onTransient(null);
          setDropTarget(null);
          if (r.ok) {
            onCommit(r.tree);
            toast("Linked");
          } else toast(r.reason);
          return;
        }
        commitTransient(d.last);
        return;
      }
      if (d.type === "note") {
        if (d.moved) commitTransient(d.last);
        return;
      }
      if (d.type === "box") {
        const x0 = Math.min(d.x0, d.x1);
        const x1 = Math.max(d.x0, d.x1);
        const y0 = Math.min(d.y0, d.y1);
        const y1 = Math.max(d.y0, d.y1);
        const picked = [...graph.nodes.values()]
          .filter((n) => isLocal(n) && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1)
          .map((n) => n.id);
        onSelect(selectNodes([...new Set([...selection.nodes, ...picked])]));
        setBox(null);
      }
    };

    // A finished drag: drop the transient preview and record the result once.
    const commitTransient = (moved: TalentTree | undefined) => {
      onTransient(null);
      if (moved) onCommit(moved);
    };

    const onPointerCancel = () => {
      if (dragRef.current?.type === "move" || dragRef.current?.type === "note") onTransient(null);
      dragRef.current = null;
      setBox(null);
      setDropTarget(null);
      setPanning(false);
    };

    const onPointerLeave = () => {
      if (dragRef.current) return;
      setTipAt(null);
      setHover(null);
    };

    const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
      if (mode !== "build") return;
      const handle = (e.target as Element)
        .closest?.("[data-placement]")
        ?.getAttribute("data-placement");
      const placement = handle ? graph.placements.find((p) => p.id === handle) : undefined;
      if (placement) {
        if (placement.name) onOpenTree(placement.treeId);
        return;
      }
      const w = toWorld(e.clientX, e.clientY);
      const n = hitNode(graph, w, view.scale);
      if (n) {
        if (!isLocal(n)) return;
        onSelect(selectNodes([n.id]));
        onFocusField("title");
        return;
      }
      const nt = hitNote(w);
      if (nt) {
        onSelect(selectNote(nt));
        onFocusField("note");
        return;
      }
      onAddNode(snapToGrid(w.x, grid), snapToGrid(w.y, grid));
    };

    // ---- Derived render state ----------------------------------------------
    const alloc = useMemo(
      () => (mode === "preview" ? allocatedSet(preview) : new Set<string>()),
      [mode, preview],
    );
    const hoverPath = useMemo(() => {
      if (mode !== "preview" || !hover || !preview.start || alloc.has(hover.id)) return null;
      const p = shortestPath(graph, alloc, hover.id);
      if (!p) return null;
      const edges = new Set<string>();
      for (let i = 1; i < p.length; i++) edges.add(edgeKey(p[i - 1], p[i]));
      return { nodes: new Set(p.slice(1)), edges, cost: p.length - 1 };
    }, [mode, hover, preview.start, alloc, graph]);

    const selected = useMemo(() => new Set(selection.nodes), [selection.nodes]);
    const brokenEnds = useMemo(() => {
      const s = new Set<string>();
      for (const [a, b] of graph.broken) {
        if (graph.nodes.has(a)) s.add(a);
        if (graph.nodes.has(b)) s.add(b);
      }
      return s;
    }, [graph]);
    const previewing = mode === "preview" && !!preview.start;

    const nodes = useMemo(
      () => [...graph.nodes.values()].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]),
      [graph],
    );

    const tip =
      hover && tipAt && !dragRef.current
        ? tipContent(hover, mode, preview, alloc, hoverPath?.cost ?? 0, graph)
        : null;

    const { scale, panX, panY } = view;
    return (
      <div ref={stageRef} className="talent-stage h-full w-full">
        <svg
          ref={svgRef}
          className={cn("tt-cv", panning && "panning")}
          aria-label="Talent tree canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
        >
          <defs>
            <filter id="tt-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern
              id="tt-grid"
              width={GRID}
              height={GRID}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${panX} ${panY}) scale(${scale})`}
            >
              <path d={`M${GRID} 0H0V${GRID}`} fill="none" className="gridline" />
            </pattern>
            {Object.entries(TINTS).map(([name, col]) => (
              <radialGradient key={name} id={`tt-g-${name}`} cx="50%" cy="40%" r="65%">
                <stop offset="0" stopColor={col} stopOpacity={name === "none" ? 1 : 0.95} />
                <stop offset=".75" stopColor="#121519" />
                <stop offset="1" stopColor="#0a0c10" />
              </radialGradient>
            ))}
          </defs>
          {grid && mode === "build" && <rect width="100%" height="100%" fill="url(#tt-grid)" />}
          <g transform={`translate(${panX} ${panY}) scale(${scale})`}>
            {mode === "build" &&
              graph.placements.map((p) => {
                const b = p.bounds;
                const x = b ? b.x0 - FRAME_PAD : p.x;
                const y = b ? b.y0 - FRAME_PAD : p.y;
                const w = b ? b.x1 - b.x0 + FRAME_PAD * 2 : 120;
                const h = b ? b.y1 - b.y0 + FRAME_PAD * 2 : 60;
                const sel = selection.placement === p.id;
                return (
                  <g key={p.id}>
                    <rect
                      className={cn("frame", sel && "sel", !p.name && "missing")}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      rx={18}
                      vectorEffect="non-scaling-stroke"
                    />
                    {/* The move handle: the ONLY grab point for a placed cluster. Kept
                    a constant on-screen size by undoing the zoom. */}
                    <g
                      className={cn("phandle", sel && "sel")}
                      data-placement={p.id}
                      transform={`translate(${x} ${y}) scale(${1 / scale})`}
                    >
                      <title>{`${p.name ?? "Missing cluster"} — drag to move · double-click to edit`}</title>
                      <rect className="phbg" x={-13} y={-13} width={26} height={26} rx={6} />
                      <path
                        className="phicon"
                        d="M0 -8v16M-8 0h16M0 -8l-3 3M0 -8l3 3M0 8l-3 -3M0 8l3 -3M-8 0l3 -3M-8 0l3 3M8 0l-3 -3M8 0l-3 3"
                      />
                      <text className="flabel" x={18} y={-6}>
                        {(p.name ?? "Missing cluster").toUpperCase()}
                      </text>
                    </g>
                  </g>
                );
              })}
            <g>
              {graph.edges.map((e) => {
                const A = graph.nodes.get(e.a);
                const B = graph.nodes.get(e.b);
                if (!A || !B) return null;
                let cls = "e";
                let lit = false;
                if (mode === "build" && selection.edge === e.key) cls += " sel";
                else if (alloc.has(e.a) && alloc.has(e.b)) {
                  cls += " on";
                  lit = true;
                } else if (hoverPath?.edges.has(e.key)) cls += " path";
                else if (!e.owned) cls += " placed";
                const c = { x1: A.x, y1: A.y, x2: B.x, y2: B.y };
                return (
                  <g key={e.key}>
                    <line className="eu" {...c} />
                    {lit && <line className="eg" {...c} />}
                    <line className={cls} {...c} />
                  </g>
                );
              })}
            </g>
            {mode === "build" &&
              tree.notes.map((m) => (
                <NoteView
                  key={m.id}
                  note={m}
                  selected={selection.note === m.id}
                  onBox={(b) => {
                    if (b) noteBoxes.current.set(m.id, b);
                    else noteBoxes.current.delete(m.id);
                  }}
                />
              ))}
            <g>
              {nodes.map((n) => {
                const r = NODE_TYPES[n.type].r;
                const on = alloc.has(n.id);
                const path = !!hoverPath?.nodes.has(n.id);
                const cls = cn(
                  "n",
                  n.type,
                  on && "on",
                  path && "path",
                  previewing && !on && !path && highlight !== n.id && "dim",
                );
                return (
                  <g key={n.id} className={cls} transform={`translate(${n.x} ${n.y})`}>
                    {n.start && (
                      <>
                        <circle className="startring" r={r + 13} />
                        <circle className="startring2" r={r + 8} />
                      </>
                    )}
                    {n.type === "keystone" && <circle className="orn" r={r + 6} />}
                    <circle className="body" r={r} fill={`url(#tt-g-${n.tint})`} />
                    {n.type !== "minor" && (
                      <circle className="inner" r={r - (n.type === "keystone" ? 8 : 5)} />
                    )}
                    {mode === "build" && selected.has(n.id) && (
                      <circle className="selring" r={r + 5} />
                    )}
                    {mode === "build" && brokenEnds.has(n.id) && (
                      <circle className="brokenring" r={r + 9} />
                    )}
                    {dropTarget === n.id && <circle className="dropring" r={r + 11} />}
                    {(highlight === n.id ||
                      (mode === "build" && hover?.id === n.id && !isLocal(n))) && (
                      <circle className="hlring" r={r + 7} />
                    )}
                    {n.start && n.startName && (
                      <text className="slabel" y={-(r + 21)}>
                        {n.startName.toUpperCase()}
                      </text>
                    )}
                    {n.type !== "minor" && n.title && (scale > 0.45 || n.type === "keystone") && (
                      <text className={cn("label", n.type)} y={r + 17}>
                        {n.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            {box && (
              <rect
                className="boxsel"
                x={Math.min(box.x0, box.x1)}
                y={Math.min(box.y0, box.y1)}
                width={Math.abs(box.x1 - box.x0)}
                height={Math.abs(box.y1 - box.y0)}
                strokeWidth={1 / scale}
              />
            )}
          </g>
        </svg>

        {graph.nodes.size === 0 && (
          <div className="tt-empty">
            <div>
              <h2>An empty {tree.kind}</h2>
              Double-click anywhere to place your first node, or press <kbd>N</kbd>.
              {tree.kind === "tree" && " Use “Place cluster” in the toolbar to drop in a cluster."}
            </div>
          </div>
        )}

        {tip && tipAt && (
          <TipBox at={tipAt} stage={size}>
            {tip}
          </TipBox>
        )}

        <div className="tt-zoom">
          <button
            type="button"
            className="tt-btn"
            aria-label="Zoom in"
            onClick={() =>
              setView((v) => zoomTowardCursor(v, size.w / 2, size.h / 2, v.scale * 1.25))
            }
          >
            +
          </button>
          <button
            type="button"
            className="tt-btn"
            aria-label="Zoom out"
            onClick={() =>
              setView((v) => zoomTowardCursor(v, size.w / 2, size.h / 2, v.scale * 0.8))
            }
          >
            −
          </button>
          <button type="button" className="tt-btn" onClick={fitToContent}>
            Fit
          </button>
          {mode === "build" && (
            <>
              <button
                type="button"
                className={cn("tt-btn", grid && "on")}
                title="Snap to grid (G)"
                onClick={onToggleGrid}
              >
                Grid
              </button>
              <button
                type="button"
                className="tt-btn"
                title="Add a text note (T)"
                onClick={() => {
                  const v = viewRef.current;
                  onAddNote((size.w / 2 - v.panX) / v.scale, (size.h / 2 - v.panY) / v.scale);
                }}
              >
                Note
              </button>
            </>
          )}
        </div>

        <div className="tt-toast" style={{ opacity: toastMessage ? 1 : 0 }}>
          {toastMessage}
        </div>
      </div>
    );
  },
);

// ---------------------------------------------------------------------------

function NoteView({
  note,
  selected,
  onBox,
}: {
  note: TalentNote;
  selected: boolean;
  onBox: (b: Bounds | null) => void;
}) {
  const textRef = useRef<SVGTextElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const fs = NOTE_FONT[note.size];
  const has = note.text.trim().length > 0;
  const lines = (has ? note.text : "Empty note").split("\n");
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;

  // biome-ignore lint/correctness/useExhaustiveDependencies: text/size change the rendered glyphs, so they must trigger a remeasure even though only the DOM bbox is read
  useLayoutEffect(() => {
    const pad = fs * 0.45;
    let b: { x: number; y: number; width: number; height: number } | null = null;
    try {
      b = textRef.current?.getBBox() ?? null;
    } catch {
      b = null;
    }
    if (!b?.width) b = { x: 0, y: 0, width: fs * 6, height: fs * 1.3 };
    const r = { x: b.x - pad, y: b.y - pad * 0.7, w: b.width + pad * 2, h: b.height + pad * 1.4 };
    setRect(r);
    onBoxRef.current({
      x0: note.x + r.x,
      y0: note.y + r.y,
      x1: note.x + r.x + r.w,
      y1: note.y + r.y + r.h,
    });
  }, [note.text, note.size, note.x, note.y, fs]);
  useEffect(() => () => onBoxRef.current(null), []);

  return (
    <g className={cn("note", selected && "sel")} transform={`translate(${note.x} ${note.y})`}>
      {rect && (
        <rect
          className="nbg"
          rx={fs * 0.3}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <text ref={textRef} className={cn("ntext", !has && "empty")} fontSize={fs}>
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond position
          <tspan key={i} x={0} dy={i ? "1.25em" : "1em"}>
            {l || " "}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function tipContent(
  n: FlatNode,
  mode: TalentMode,
  preview: PreviewState,
  alloc: Set<string>,
  cost: number,
  graph: FlatGraph,
) {
  const label = NODE_TYPES[n.type].label;
  let hint = "";
  if (mode === "preview") {
    const anyStarts = [...graph.nodes.values()].some((x) => x.start);
    if (!preview.start) hint = n.start || !anyStarts ? "Click to start here" : "";
    else if (n.start && n.id !== preview.start) hint = "Click to start here instead";
    else if (alloc.has(n.id)) hint = n.id === preview.start ? "Start" : "Click to refund";
    else hint = cost ? `Click to allocate · ${cost} point${cost > 1 ? "s" : ""}` : "Not reachable";
  }
  return (
    <>
      <h4 className={n.type}>{n.title || `Untitled ${label.toLowerCase()}`}</h4>
      <div className="kind">
        {label}
        {n.start ? " · Start point" : ""}
        {n.startName ? ` · ${n.startName}` : ""}
      </div>
      {n.text ? <p>{n.text}</p> : <p style={{ color: "var(--tt-muted)" }}>No description</p>}
      {hint && <div className="hint">{hint}</div>}
    </>
  );
}

function TipBox({
  at,
  stage,
  children,
}: {
  at: Point;
  stage: { w: number; h: number };
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Point>({ x: at.x + 18, y: at.y + 18 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x = at.x + 18;
    let y = at.y + 18;
    if (x + el.offsetWidth > stage.w - 8) x = at.x - el.offsetWidth - 18;
    if (y + el.offsetHeight > stage.h - 8) y = at.y - el.offsetHeight - 18;
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [at.x, at.y, stage.w, stage.h]);
  return (
    <div ref={ref} className="tt-tip" style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>
  );
}
