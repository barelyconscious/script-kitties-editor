/**
 * StructureTree — the TOP slice of the structure column (F9a): the open
 * component's {@link GuiNode} hierarchy rendered as a tree keyed by `nodeId`, with
 * selection synced to the preview and a right-click "add child" menu.
 *
 * Selection: clicking a tree row dispatches `select` into the SHARED editor store,
 * and the row highlights when its `nodeId` matches `state.selectedNodeId`. The
 * preview reads/writes the SAME `selectedNodeId` (see {@link GuiPreviewHost}), so a
 * click in either surface highlights both — there is exactly one selection.
 *
 * Add child: right-clicking a row opens a context menu offering only the tags the
 * element rules permit under that node ({@link allowedChildTags} — Component is
 * childless, Event only under View). Picking a non-Component tag dispatches
 * `addChildNode` immediately; picking Component opens the {@link ComponentPicker}
 * and adds once the user chooses a basename for `src`. Both mutate the store's tree
 * (so the preview updates) and select the new node.
 *
 * Delete: every NON-ROOT row carries a delete affordance (right-click "Delete" /
 * an inline trash button) wired to the store's `removeNode` action, which removes
 * the element AND its whole subtree. The root `<View>` is never deletable. Deletion
 * goes through the document history, so Cmd+Z restores it; a selection the removal
 * orphans is cleared by the reducer. `<Event>` rows are just one case of this
 * general delete (their affordance reads "Remove event").
 *
 * @see design/xgui_ta.md — "Structure column" (tree slice) and "Selection model".
 */

import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Keyboard,
  LayoutGrid,
  Lock,
  type LucideIcon,
  MonitorPlay,
  OctagonAlert,
  Plug,
  Plus,
  Pointer,
  SquareStack,
  Trash2,
  TriangleAlert,
  Type,
  Zap,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  componentsVersion,
  loadComponentTree,
  subscribeComponents,
} from "../../lib/guiComponentCache";
import { hasFocusHandlers, isHitTestable, isModal } from "../../lib/guiInteraction";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import { ComponentPicker } from "./ComponentPicker";
import { exportedFunctionNames } from "./controllerScript";
import { useEditorStore } from "./editorState";
import { collectTooltipBasenames, type Lint, lintTree, worstSeverity } from "./guiLints";
import { interactionHandlerFields, nodeHasId, srcBasename } from "./guiProperties";
import { type DropPlan, type DropZone, dropPlanForPointer } from "./guiTreeDnd";
import {
  allowedChildTags,
  canMoveTo,
  findNode,
  makeChildNode,
  nodePath,
  treeNodePrimaryLabel,
} from "./guiTreeEdit";

/** Empty lint map reused for the no-open-component case (stable identity). */
const NO_LINTS: ReadonlyMap<string, Lint[]> = new Map();

/**
 * Resolve the tooltip components referenced anywhere in `root` to their parsed
 * roots, for the tooltip lints (rules 5–6). Fetches each referenced basename via
 * the shared {@link loadComponentTree} module cache (so it never double-fetches a
 * child the preview already pulled) and re-fetches on cache invalidation. Returns a
 * lookup `(tooltipRef) => root | null` keyed by the `.xml`-stripped basename; a
 * still-loading or missing component reads as `null`, which skips its tooltip lints.
 */
function useTooltipComponentRoots(root: GuiNode | null): (tooltipRef: string) => GuiNode | null {
  const version = useSyncExternalStore(subscribeComponents, componentsVersion);
  // A stable string key so the effect only re-runs when the SET of referenced
  // tooltip basenames actually changes (not on every unrelated tree edit).
  const basenamesKey = useMemo(
    () => (root ? collectTooltipBasenames(root).join("\n") : ""),
    [root],
  );
  const [roots, setRoots] = useState<ReadonlyMap<string, GuiNode>>(() => new Map());

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the re-fetch trigger — when invalidateComponents() bumps it the effect must re-run against the cleared cache, even though the body doesn't read it (matches useComponent in guiComponentCache)
  useEffect(() => {
    const basenames = basenamesKey === "" ? [] : basenamesKey.split("\n");
    if (basenames.length === 0) {
      setRoots(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, GuiNode>();
      await Promise.all(
        basenames.map(async (basename) => {
          const tree = await loadComponentTree(basename);
          if (tree) next.set(basename, tree);
        }),
      );
      if (!cancelled) setRoots(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [basenamesKey, version]);

  return useCallback((ref: string) => roots.get(srcBasename(ref)) ?? null, [roots]);
}

/**
 * Per-tag accent color, shared by a row's type icon and its identity label so the
 * element kind reads at a glance. The colored tags (View/Component/Event/Grid) keep
 * their accent; Panel/Text fall back to plain foreground so their id stays readable
 * as the primary label.
 */
function tagColorClass(tag: GuiTag): string {
  switch (tag) {
    case "View":
      return "text-primary";
    case "Component":
      // Aquamarine (slightly desaturated) — distinct from the others without
      // colliding with a semantic color (amber = missing-id warning; plain green =
      // "added" in a diff/VCS).
      return "text-[#86e3c6]";
    case "Event":
      return "text-sky-400";
    case "GridLayout":
      return "text-violet-400";
    default:
      return "text-foreground";
  }
}

/** The type icon shown to the left of each row's label, one per element tag. */
const TAG_ICON: Record<GuiTag, LucideIcon> = {
  // View is a screen (matching the component list's "View" glyph); a Panel is a
  // window/region; a Component plugs in an external piece (plug = plug-in).
  View: MonitorPlay,
  Panel: AppWindow,
  Text: Type,
  Component: Plug,
  Event: Zap,
  GridLayout: LayoutGrid,
};

export function StructureTree() {
  const { state, dispatch } = useEditorStore();
  const open = state.open;
  const root = open?.root ?? null;
  // The parent a Component is being added under, while the picker is open. `null`
  // means the picker is closed.
  const [pickerParentId, setPickerParentId] = useState<string | null>(null);

  // Interaction lints (task 506), computed off the raw tree and surfaced as per-row
  // badges (the same treatment as the missing-id warning). The controller's exported
  // functions drive the handler-exists lint (null until the controller text loads —
  // eagerly on open, #506); referenced tooltip components drive the tooltip lints.
  const resolveTooltip = useTooltipComponentRoots(root);
  const exportedFunctions = useMemo(
    () => (open?.controllerText != null ? exportedFunctionNames(open.controllerText) : null),
    [open?.controllerText],
  );
  const lints = useMemo(
    () =>
      root ? lintTree(root, { exportedFunctions, resolveComponent: resolveTooltip }) : NO_LINTS,
    [root, exportedFunctions, resolveTooltip],
  );

  // ── Drag-and-drop re-parenting (task 513) ──────────────────────────────────
  // Pointer-based (not HTML5 DnD — unreliable in WKWebView), mirroring the
  // preview's drag-to-move: a press on a row body ARMS a gesture; only once the
  // pointer crosses a small threshold does it become a drag (so a plain click
  // still selects). All pointer handlers live on the scroll container (below);
  // rows only carry a `data-tree-node-id` back-ref and render the affordance.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The live gesture: which node is (potentially) being dragged, where the press
  // began, whether it has crossed the drag threshold, and its pointerId (for
  // capture/release). A ref, not state — arming and threshold-tracking must not
  // re-render the tree on every pointermove.
  const gestureRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  // The last LEGAL drop plan computed during the drag (or null over an illegal /
  // empty spot), read on pointerup to commit — kept in a ref so pointerup sees the
  // freshest value without depending on the async `dropTarget` state.
  const planRef = useRef<DropPlan | null>(null);
  // Swallow the click synthesized after a drag gesture so it doesn't re-run
  // selection on whatever row the pointer came up over (mirrors the preview's
  // suppressNextClick).
  const suppressClickRef = useRef(false);
  // Auto-scroll direction while dragging near the container's edges: -1 up, 0
  // none, 1 down. Driven by a rAF loop so it keeps scrolling while the pointer is
  // held still in the edge band (pointermove alone would stall).
  const autoScrollRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // The node being dragged (dims its row) and the current drop target row + zone
  // (drives the insertion line / into-ring). State — these ARE visual.
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ nodeId: string; zone: DropZone } | null>(null);

  // Tear down a gesture completely: release capture, stop auto-scroll, clear the
  // refs and the visual state. Shared by pointerup, Escape, and unmount.
  const endGesture = useCallback(() => {
    const g = gestureRef.current;
    if (g && scrollRef.current?.hasPointerCapture(g.pointerId)) {
      scrollRef.current.releasePointerCapture(g.pointerId);
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    autoScrollRef.current = 0;
    gestureRef.current = null;
    planRef.current = null;
    setDraggingNodeId(null);
    setDropTarget(null);
  }, []);

  // Escape cancels an in-flight drag cleanly (no move dispatched); the trailing
  // click is suppressed so the cancel doesn't also re-select. Only mounted while a
  // drag is active.
  useEffect(() => {
    if (draggingNodeId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        suppressClickRef.current = true;
        endGesture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draggingNodeId, endGesture]);

  // Safety net: if the tree unmounts mid-drag, release capture / cancel the rAF.
  useEffect(() => endGesture, [endGesture]);

  if (!open) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground text-xs">
        Open a component to see its element tree.
      </div>
    );
  }

  const selectedNodeId = state.selectedNodeId;
  const rootNode = open.root;

  // ── Drag choreography (thin; all zone/index math is in guiTreeDnd, all legality
  //    in canMoveTo) ──────────────────────────────────────────────────────────
  const DRAG_THRESHOLD = 4; // px the pointer must travel before a press becomes a drag
  const AUTO_SCROLL_EDGE = 28; // px band at the container's top/bottom that auto-scrolls
  const AUTO_SCROLL_SPEED = 8; // px/frame while in the edge band

  const runAutoScroll = () => {
    if (rafRef.current != null) return;
    const step = () => {
      const dir = autoScrollRef.current;
      const el = scrollRef.current;
      if (dir !== 0 && el) el.scrollTop += dir * AUTO_SCROLL_SPEED;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // Set the auto-scroll direction from the pointer's proximity to the container's
  // top/bottom edge (the rAF loop reads this each frame).
  const updateAutoScroll = (clientY: number) => {
    const el = scrollRef.current;
    if (!el) {
      autoScrollRef.current = 0;
      return;
    }
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + AUTO_SCROLL_EDGE) autoScrollRef.current = -1;
    else if (clientY > rect.bottom - AUTO_SCROLL_EDGE) autoScrollRef.current = 1;
    else autoScrollRef.current = 0;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Left button only — right-click falls through to the context menu, and a new
    // press clears any stale click-suppression from a drag that ended off-tree.
    if (e.button !== 0) return;
    suppressClickRef.current = false;
    const target = e.target as HTMLElement;
    // Never initiate a drag from a control (collapse chevron, lock/visibility
    // toggles, add-child button) — those own their own clicks.
    if (target.closest("[data-no-drag]")) return;
    const rowEl = target.closest<HTMLElement>("[data-tree-node-id]");
    const nodeId = rowEl?.dataset.treeNodeId;
    // The root <View> is never draggable (nothing may be its sibling).
    if (!nodeId || nodeId === rootNode.nodeId) return;
    gestureRef.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      pointerId: e.pointerId,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    // Promote press → drag only once the pointer clears the threshold, so a plain
    // click (no movement) still selects.
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return;
      g.moved = true;
      setDraggingNodeId(g.nodeId);
      scrollRef.current?.setPointerCapture(g.pointerId);
      runAutoScroll();
    }
    updateAutoScroll(e.clientY);
    // Hit-test the row under the pointer (capture retargets events but not
    // elementFromPoint). Affordance overlays are pointer-events-none so they don't
    // shadow the row.
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const rowEl = el?.closest<HTMLElement>("[data-tree-node-id]") ?? null;
    const targetId = rowEl?.dataset.treeNodeId;
    if (!rowEl || !targetId) {
      planRef.current = null;
      setDropTarget(null);
      return;
    }
    const targetNode = findNode(rootNode, targetId);
    if (!targetNode) {
      planRef.current = null;
      setDropTarget(null);
      return;
    }
    const path = nodePath(rootNode, targetId);
    const parent = path && path.length >= 2 ? path[path.length - 2] : null;
    const rect = rowEl.getBoundingClientRect();
    const plan = dropPlanForPointer(
      { top: rect.top, height: rect.height },
      e.clientY,
      targetNode,
      parent,
    );
    // Legality lives entirely in canMoveTo — an illegal zone shows NO affordance
    // and a pointerup there is a no-op.
    if (!canMoveTo(rootNode, g.nodeId, plan.targetParentId)) {
      planRef.current = null;
      setDropTarget(null);
      return;
    }
    planRef.current = plan;
    setDropTarget((prev) =>
      prev && prev.nodeId === targetId && prev.zone === plan.zone
        ? prev
        : { nodeId: targetId, zone: plan.zone },
    );
  };

  const handlePointerUp = () => {
    const g = gestureRef.current;
    if (!g) return;
    const moved = g.moved;
    const plan = planRef.current;
    endGesture();
    if (!moved) return; // a plain click — let the row's select onClick run
    // A drag happened: suppress the trailing click, and commit if we ended over a
    // legal zone.
    suppressClickRef.current = true;
    if (plan) {
      dispatch({
        type: "moveNode",
        nodeId: g.nodeId,
        targetParentId: plan.targetParentId,
        index: plan.index,
      });
      // Keep the moved node selected (its nodeId survives the move).
      dispatch({ type: "select", nodeId: g.nodeId });
    }
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.stopPropagation();
    }
  };

  const handleAdd = (parentNodeId: string, tag: GuiTag) => {
    if (tag === "Component") {
      // Defer the actual add until the user picks a src basename.
      setPickerParentId(parentNodeId);
      return;
    }
    // Pass the parent's tag so a child added UNDER a GridLayout is created without
    // its own default position/size (the grid owns its child's geometry).
    const parentTag = findNode(open.root, parentNodeId)?.tag;
    dispatch({
      type: "addChildNode",
      parentNodeId,
      child: makeChildNode(tag, undefined, parentTag),
    });
  };

  const handlePickComponent = (basename: string) => {
    if (pickerParentId == null) return;
    const parentTag = findNode(open.root, pickerParentId)?.tag;
    dispatch({
      type: "addChildNode",
      parentNodeId: pickerParentId,
      child: makeChildNode("Component", basename, parentTag),
    });
    setPickerParentId(null);
  };

  // Remove a node (and its whole subtree) from the tree via the history-tracked
  // `removeNode` action. Exposed on every non-root row; the root `<View>` is guarded
  // both here (the pure `removeNode` no-ops on the root) and at the affordance level
  // (no trash/menu item is rendered for the root).
  const handleRemove = (nodeId: string) => {
    dispatch({ type: "removeNode", nodeId });
  };

  // Add-handler action (task 507): wire an interaction handler onto a node by
  // writing ONLY the XML attribute — an EMPTY value the author fills in with a
  // controller function name in the Properties panel. Selecting the node opens its
  // Interaction group (the present-but-empty attr expands it), so the author lands
  // on the field. No `withAttr` here (that would delete an empty value) — we set the
  // key directly so the handler attr exists on the node.
  const handleAddHandler = (nodeId: string, attr: string) => {
    const node = findNode(open.root, nodeId);
    if (!node) return;
    dispatch({ type: "setNodeAttrs", nodeId, attrs: { ...node.attrs, [attr]: "" } });
    dispatch({ type: "select", nodeId });
    // TODO(xgui interaction — PUNTED, task 507 / Matt): Lua controller stub injection
    // is deliberately NOT done here. When it is built, adding a handler should ALSO
    // inject a matching, empty stub into the component's controller table, keyed by
    // the handler FAMILY:
    //   • input handlers  (onMouseClicked / onMouseEntered / onMouseExited /
    //                       onMouseMoved / onFocus / onBlur)  -> function(self, mouse)
    //   • key handler     (onKeyPressed)                      -> function(self, input)
    //                       — the 2nd arg is NOT yet frozen engine-side
    //   • <Event> handlers (<Event handler="...">)            -> function(payload)
    //                       — no `self`
    // NEVER emit the aspirational (mouse, targetId, targetItemData, currentId) 4-arg
    // form — that signature ships nowhere.
  };

  return (
    // The scroll container owns ALL drag pointer handlers (rows just carry a
    // data-tree-node-id back-ref): pointerdown arms, pointermove promotes past the
    // threshold + hit-tests, pointerup commits. `touch-none` so a touch drag isn't
    // stolen by the browser's scroll gesture; `select-none` while dragging so the
    // gesture doesn't paint a text selection across rows.
    <div
      ref={scrollRef}
      className={cn(
        "min-h-0 flex-1 touch-none overflow-y-auto py-1",
        draggingNodeId !== null && "select-none",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={handleClickCapture}
    >
      <ul>
        <TreeRow
          node={open.root}
          depth={0}
          selectedNodeId={selectedNodeId}
          lockedNodeIds={state.lockedNodeIds}
          hiddenNodeIds={state.hiddenNodeIds}
          lints={lints}
          draggingNodeId={draggingNodeId}
          dropTarget={dropTarget}
          onSelect={(nodeId) => dispatch({ type: "select", nodeId })}
          onAdd={handleAdd}
          onAddHandler={handleAddHandler}
          onRemove={handleRemove}
          onToggleLock={(nodeId) => dispatch({ type: "toggleLock", nodeId })}
          onToggleVisibility={(nodeId) => dispatch({ type: "toggleVisibility", nodeId })}
        />
      </ul>

      <ComponentPicker
        open={pickerParentId != null}
        onOpenChange={(o) => {
          if (!o) setPickerParentId(null);
        }}
        onPick={handlePickComponent}
        excludeName={open.name}
      />
    </div>
  );
}

/**
 * The read-only interaction badges for one tree row. Each icon reflects a
 * capability the `worlds-cpp` XGUI runtime derives from the element's raw attrs
 * (see {@link import("../../lib/guiInteraction")}):
 *
 *   - pointer   → hit-testable (the engine tests it under the cursor): it has a
 *                 mouse handler, a tooltip, or is modal.
 *   - keyboard  → has focus handlers (`onKeyPressed`/`onFocus`/`onBlur`) — the
 *                 handler-only focus signal (modal is shown by its own badge
 *                 rather than lighting up "keyboard").
 *   - modal     → declared `modal` (captures input, blocks/overlays beneath it).
 *
 * Rendered only for capabilities the element actually has, so an inert element
 * shows nothing. Icons are muted and non-interactive (plain spans with a
 * `title`) — they inform, they don't act.
 */
function InteractionBadges({ node }: { node: GuiNode }) {
  const hitTestable = isHitTestable(node);
  const focusHandlers = hasFocusHandlers(node);
  const modal = isModal(node);

  if (!hitTestable && !focusHandlers && !modal) return null;

  return (
    <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground/60">
      {hitTestable && (
        <span
          role="img"
          aria-label="Hit-testable"
          title="Hit-testable — the engine tests this element under the cursor (it has a mouse handler, a tooltip, or is modal)."
        >
          <Pointer className="size-3" />
        </span>
      )}
      {focusHandlers && (
        <span
          role="img"
          aria-label="Has focus handlers"
          title="Has focus handlers (onKeyPressed / onFocus / onBlur) — this element can receive keyboard focus."
        >
          <Keyboard className="size-3" />
        </span>
      )}
      {modal && (
        <span
          role="img"
          aria-label="Modal"
          title="Modal — captures input and blocks elements beneath it (also receives focus)."
        >
          <SquareStack className="size-3" />
        </span>
      )}
    </span>
  );
}

/**
 * The interaction-lint badge for one tree row (task 506): a single icon reflecting
 * the WORST severity among the node's lints — a red {@link OctagonAlert} when any
 * lint is an error, an amber {@link TriangleAlert} when there are only warnings — with
 * a `title` listing every message. Renders nothing for a clean node. Advisory only:
 * these never block a save.
 */
function LintBadge({ lints }: { lints: readonly Lint[] }) {
  const severity = worstSeverity(lints);
  if (severity === null) return null;
  const isError = severity === "error";
  const Icon = isError ? OctagonAlert : TriangleAlert;
  const title = lints
    .map((l) => `${l.severity === "error" ? "Error" : "Warning"}: ${l.message}`)
    .join("\n");
  return (
    <span
      role="img"
      aria-label={isError ? "Interaction errors" : "Interaction warnings"}
      title={title}
      className={cn("shrink-0", isError ? "text-red-500" : "text-amber-500")}
    >
      <Icon className="size-3" />
    </span>
  );
}

/** Indentation step per tree level, in rem. */
const INDENT_REM = 0.75;

type TreeRowProps = {
  node: GuiNode;
  depth: number;
  selectedNodeId: string | null;
  lockedNodeIds: Set<string>;
  hiddenNodeIds: Set<string>;
  lints: ReadonlyMap<string, Lint[]>;
  /** The node currently being dragged (dims its row), or null when idle (task 513). */
  draggingNodeId: string | null;
  /** The active drop target row + zone, driving this row's affordance (task 513). */
  dropTarget: { nodeId: string; zone: DropZone } | null;
  onSelect: (nodeId: string) => void;
  onAdd: (parentNodeId: string, tag: GuiTag) => void;
  onAddHandler: (nodeId: string, attr: string) => void;
  onRemove: (nodeId: string) => void;
  onToggleLock: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
};

function TreeRow({
  node,
  depth,
  selectedNodeId,
  lockedNodeIds,
  hiddenNodeIds,
  lints,
  draggingNodeId,
  dropTarget,
  onSelect,
  onAdd,
  onAddHandler,
  onRemove,
  onToggleLock,
  onToggleVisibility,
}: TreeRowProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Whether this row's right-click menu is open. Right-clicking drops the hover
  // highlight, so we hold a highlight on the row for as long as its menu is open —
  // keeping the user anchored to WHICH element they're acting on.
  const [menuOpen, setMenuOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const tag = node.tag;
  // The row's PRIMARY label is the element's identity (id, or event name), replacing
  // the tag name — the tag is conveyed by the per-tag icon + color instead.
  const { text: label, placeholder: labelPlaceholder } = treeNodePrimaryLabel(node);
  const isEvent = tag === "Event";
  const TagIcon = TAG_ICON[tag];
  const selected = node.nodeId === selectedNodeId;
  // Flag an id-bearing element (Panel/Text/Component) that has no `id`: it can't be
  // referenced from the controller or data bindings, and won't appear in any
  // descendant's computed id path. Newly-added elements are auto-id'd, so this only
  // lights up for imported components or an id the user deliberately cleared — which
  // keeps the warning rare enough to stay trustworthy. Events/View never carry an id.
  const missingId = nodeHasId(tag) && !node.attrs.id?.trim();
  // Interaction lints on this node (task 506) — rendered as a badge beside the
  // engine-capability badges. Never blocks anything; purely advisory.
  const nodeLints = lints.get(node.nodeId) ?? [];
  const addable = allowedChildTags(node);
  // The interaction handlers this node can still gain — the tag's schema handlers
  // (from guiProperties, not a re-listed set) minus the ones already on the node, so
  // "Add handler" only offers unwired ones. Empty for tags with no interaction
  // handlers (`<Event>`/`<GridLayout>`), which hides the submenu.
  const addableHandlers = interactionHandlerFields(tag).filter((f) => !(f.name in node.attrs));
  // Every non-root element is deletable (the root `<View>` is rendered at depth 0
  // and is never removable). Events are just one case of this general delete.
  const removable = depth > 0;
  // Lock / hide are offered on every NON-root element. The root `<View>` is excluded:
  // locking it ("lock everything") or hiding it ("blank the preview") carry no useful
  // meaning, and dropping its icons lets the whole tree reclaim the left gutter.
  const canToggle = depth > 0;
  const locked = lockedNodeIds.has(node.nodeId);
  const hidden = hiddenNodeIds.has(node.nodeId);
  // The row carries a context menu when there's anything to do on it: add a child
  // (containers), lock/hide it, or delete it (any non-root element). These are offered
  // on every row, so the menu is always present.
  const hasMenu = true;

  // Drag-and-drop (task 513): this row dims while it is the one being dragged, and
  // shows the drop affordance (insertion line for before/after, into-ring) when it
  // is the current drop target. `dropZone` is null unless THIS row is targeted.
  const isDragging = node.nodeId === draggingNodeId;
  const dropZone = dropTarget?.nodeId === node.nodeId ? dropTarget.zone : null;
  // The insertion line indents to where the new sibling would sit (the row's own
  // content offset), so before/after read at the right depth.
  const indentRem = 0.25 + depth * INDENT_REM;

  return (
    <li>
      <ContextMenu.Root onOpenChange={setMenuOpen}>
        <ContextMenu.Trigger asChild>
          <div
            // The drag back-ref: the container's pointer handlers hit-test rows by
            // this id (task 513). The whole row is the drag handle (minus its
            // controls, tagged data-no-drag) and, via the select button, selects.
            data-tree-node-id={node.nodeId}
            // A row is selected by click and right-clicked to add. The whole row is
            // a button so keyboard focus + Enter selects it.
            className={cn(
              "group relative flex w-full items-center py-0.5 pr-2 pl-1 text-left text-[13px] transition-colors hover:bg-muted/60",
              // A missing-id element tints the whole row a muted warning color (its
              // type icon is also swapped for a warning glyph below). Selection still
              // wins so the selected row reads clearly; an open right-click menu holds
              // the hover tint so the acted-on row stays visibly anchored.
              selected ? "bg-muted" : menuOpen ? "bg-muted/60" : missingId && "bg-amber-500/10",
              // The dragged row dims for the duration of the gesture.
              isDragging && "opacity-40",
              // The into-target row gets a ring in the selection color family.
              dropZone === "into" && "ring-2 ring-primary ring-inset",
            )}
          >
            {/* Before/after insertion line — a 2px bar between rows, indented to the
                row's content so it reads at the right depth. pointer-events-none so
                it never shadows the row during hit-testing. */}
            {(dropZone === "before" || dropZone === "after") && (
              <div
                className={cn(
                  "pointer-events-none absolute right-0 z-10 h-0.5 bg-primary",
                  dropZone === "before" ? "top-0" : "bottom-0",
                )}
                style={{ left: `${indentRem}rem` }}
              />
            )}
            {/* Indented row content. Lock/eye no longer occupy a far-left gutter; they
                live in the right-hand affordance group (below) so the tree reclaims the
                horizontal space, and the root `<View>` carries neither. */}
            <div
              className="flex min-w-0 flex-1 items-center gap-1"
              style={{ paddingLeft: `${0.25 + depth * INDENT_REM}rem` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  data-no-drag
                  aria-label={collapsed ? "Expand" : "Collapse"}
                  onClick={() => setCollapsed((c) => !c)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {collapsed ? (
                    <ChevronRight className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                </button>
              ) : (
                <span className="inline-block size-4 shrink-0" />
              )}

              <button
                type="button"
                onClick={() => onSelect(node.nodeId)}
                className="flex min-w-0 flex-1 select-none items-center gap-1.5 text-left"
              >
                {/* Per-tag type icon, left of the identity label, accent-colored —
                    UNLESS the element is missing its id, in which case the warning
                    glyph takes the icon slot (the row is tinted to match). */}
                {missingId ? (
                  <span
                    role="img"
                    title="No id — this element can't be referenced from the controller or data bindings. Give it an id in Properties."
                    aria-label="Missing id"
                    className="shrink-0 text-amber-500"
                  >
                    <TriangleAlert className="size-3" />
                  </span>
                ) : (
                  <TagIcon className={cn("size-3 shrink-0", tagColorClass(tag))} />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate font-medium font-mono",
                    tagColorClass(tag),
                    // An unnamed event's placeholder reads muted/italic so an empty
                    // event is clearly a stub waiting for a name.
                    isEvent && labelPlaceholder && "text-muted-foreground/60 italic",
                  )}
                >
                  {label}
                </span>
              </button>

              {/* Read-only interaction badges — the engine-derived capabilities of
                  this element (hit-testable / has focus handlers / modal). Always
                  visible (like the missing-id warning), muted so they don't compete
                  with the identity label or the actionable lock/hide/add affordances. */}
              <InteractionBadges node={node} />

              {/* Interaction-lint badge (task 506): a red octagon for any error, an
                  amber triangle for warnings only. The tooltip lists every message.
                  Distinct from the missing-id warning (which owns the type-icon slot)
                  so a node can surface both. Advisory only — never blocks a save. */}
              <LintBadge lints={nodeLints} />

              {canToggle && (
                // Lock toggle — a right-side affordance. Unlocked: muted, hover-only.
                // Locked: a solid icon that persists even when not hovered, so lock state
                // reads at a glance without a dedicated left column.
                <button
                  type="button"
                  data-no-drag
                  aria-label={locked ? `Unlock ${tag}` : `Lock ${tag}`}
                  aria-pressed={locked}
                  title={
                    locked
                      ? "Locked — can't be selected in the preview or edited. Click to unlock."
                      : "Lock — prevent selection in the preview and edits in Properties."
                  }
                  onClick={() => onToggleLock(node.nodeId)}
                  className={cn(
                    "shrink-0 rounded p-0.5 transition-opacity",
                    locked
                      ? "text-foreground opacity-100"
                      : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
                  )}
                >
                  <Lock className="size-3" />
                </button>
              )}
              {canToggle && (
                // Visibility toggle — sits beside the lock. Visible: muted, hover-only.
                // Hidden: a persistent slashed eye (EyeOff). Hiding drops the element AND
                // its subtree from the preview.
                <button
                  type="button"
                  data-no-drag
                  aria-label={hidden ? `Show ${tag} in preview` : `Hide ${tag} from preview`}
                  aria-pressed={hidden}
                  title={
                    hidden
                      ? "Hidden from the preview (with its children). Click to show."
                      : "Hide this element (and its children) from the preview."
                  }
                  onClick={() => onToggleVisibility(node.nodeId)}
                  className={cn(
                    "shrink-0 rounded p-0.5 transition-opacity",
                    hidden
                      ? "text-foreground opacity-100"
                      : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
                  )}
                >
                  {hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </button>
              )}
              {addable.length > 0 && (
                // A visible add affordance on hover/selection mirrors the right-click
                // menu, so add-child is discoverable without knowing about it.
                <AddMenu node={node} addable={addable} onAdd={onAdd} />
              )}
            </div>
          </div>
        </ContextMenu.Trigger>
        {hasMenu && (
          <ContextMenu.Portal>
            <ContextMenu.Content className="z-50 min-w-40 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10">
              {/* Header naming the element the menu acts on. Right-clicking doesn't
                  hold the row's hover highlight, so this keeps the user anchored to
                  WHICH element they opened the menu on. */}
              <ContextMenu.Label className="flex items-center gap-1.5 px-2 py-1">
                {missingId ? (
                  <TriangleAlert className="size-3 shrink-0 text-amber-500" />
                ) : (
                  <TagIcon className={cn("size-3 shrink-0", tagColorClass(tag))} />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate font-medium font-mono",
                    tagColorClass(tag),
                    isEvent && labelPlaceholder && "text-muted-foreground/60 italic",
                  )}
                >
                  {label}
                </span>
              </ContextMenu.Label>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              {addable.length > 0 && (
                <>
                  <ContextMenu.Label className="px-2 py-1 text-muted-foreground">
                    Add child
                  </ContextMenu.Label>
                  {addable.map((childTag) => {
                    // Each add option carries the SAME type icon + accent color the
                    // tree row uses for that tag, so the menu reads in the same visual
                    // language as the tree it adds into.
                    const ChildIcon = TAG_ICON[childTag];
                    return (
                      <ContextMenu.Item
                        key={childTag}
                        onSelect={() => onAdd(node.nodeId, childTag)}
                        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 outline-none data-[highlighted]:bg-muted"
                      >
                        <ChildIcon className={cn("size-3 shrink-0", tagColorClass(childTag))} />
                        <span className={cn("font-medium font-mono", tagColorClass(childTag))}>
                          {childTag}
                        </span>
                      </ContextMenu.Item>
                    );
                  })}
                </>
              )}
              {addableHandlers.length > 0 && (
                <>
                  {addable.length > 0 && <ContextMenu.Separator className="my-1 h-px bg-border" />}
                  {/* Add-handler submenu: wire an interaction handler onto this
                      element (writes the empty XML attr; the Properties panel's
                      Interaction group opens so the author names the controller
                      function). Only unwired handlers valid for this tag are listed. */}
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger className="flex cursor-default items-center gap-1.5 rounded px-2 py-1 outline-none data-[highlighted]:bg-muted data-[state=open]:bg-muted">
                      <Pointer className="size-3 shrink-0 text-muted-foreground" />
                      <span>Add handler</span>
                      <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground" />
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent
                        sideOffset={2}
                        className="z-50 min-w-44 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10"
                      >
                        {addableHandlers.map((field) => (
                          <ContextMenu.Item
                            key={field.name}
                            onSelect={() => onAddHandler(node.nodeId, field.name)}
                            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 outline-none data-[highlighted]:bg-muted"
                          >
                            <span className="font-medium font-mono">{field.name}</span>
                          </ContextMenu.Item>
                        ))}
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                </>
              )}
              {/* Separate the Add groups from the element-level actions below
                  (lock/hide/delete) so they don't read as one undifferentiated list. */}
              {(canToggle || removable) && (addable.length > 0 || addableHandlers.length > 0) && (
                <ContextMenu.Separator className="my-1 h-px bg-border" />
              )}
              {canToggle && (
                <>
                  <ContextMenu.Item
                    onSelect={() => onToggleLock(node.nodeId)}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 outline-none data-[highlighted]:bg-muted"
                  >
                    <Lock className="size-3" /> {locked ? "Unlock" : "Lock"}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onSelect={() => onToggleVisibility(node.nodeId)}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 outline-none data-[highlighted]:bg-muted"
                  >
                    {hidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}{" "}
                    {hidden ? "Show in preview" : "Hide from preview"}
                  </ContextMenu.Item>
                </>
              )}
              {removable && (
                <ContextMenu.Item
                  onSelect={() => onRemove(node.nodeId)}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-destructive outline-none data-[highlighted]:bg-muted"
                >
                  <Trash2 className="size-3" /> {isEvent ? "Remove event" : "Delete"}
                </ContextMenu.Item>
              )}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        )}
      </ContextMenu.Root>

      {hasChildren && !collapsed && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.nodeId}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              lockedNodeIds={lockedNodeIds}
              hiddenNodeIds={hiddenNodeIds}
              lints={lints}
              draggingNodeId={draggingNodeId}
              dropTarget={dropTarget}
              onSelect={onSelect}
              onAdd={onAdd}
              onAddHandler={onAddHandler}
              onRemove={onRemove}
              onToggleLock={onToggleLock}
              onToggleVisibility={onToggleVisibility}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The inline "+" add-child button — a click-opened dropdown mirroring the
 * right-click context menu, so add-child is discoverable. Built on the same
 * radix ContextMenu? No — a click menu uses DropdownMenu semantics; here we use a
 * tiny popover-like menu via the native details/summary-free approach: reuse the
 * context menu's item list by triggering it as a small inline menu.
 */
function AddMenu({
  node,
  addable,
  onAdd,
}: {
  node: GuiNode;
  addable: GuiTag[];
  onAdd: (parentNodeId: string, tag: GuiTag) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0" data-no-drag>
      <button
        type="button"
        aria-label="Add child"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100",
          open && "opacity-100",
        )}
      >
        <Plus className="size-3" />
      </button>
      {open && (
        <>
          {/* Click-away catcher. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: invisible click-away backdrop for a lightweight inline menu */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is dismiss-only; Escape handled by focus leaving */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 min-w-36 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10">
            <p className="px-2 py-1 text-muted-foreground">Add child</p>
            {addable.map((childTag) => {
              // Mirror the right-click menu: same per-tag icon + accent color as the tree.
              const ChildIcon = TAG_ICON[childTag];
              return (
                <button
                  key={childTag}
                  type="button"
                  onClick={() => {
                    onAdd(node.nodeId, childTag);
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted"
                >
                  <ChildIcon className={cn("size-3 shrink-0", tagColorClass(childTag))} />
                  <span className={cn("font-medium font-mono", tagColorClass(childTag))}>
                    {childTag}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
