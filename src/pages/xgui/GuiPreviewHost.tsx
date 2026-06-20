/**
 * GuiPreviewHost — wires the F3 resolution loop end to end:
 *
 *   Data Model JSON  ──parse──▶  flat root model ─┐
 *   palette (get_palette, module-cached) ─────────┼──▶ GuiPreview resolves tokens
 *                                                  │     + palette names + colors
 *   recolor → invalidatePalette() → re-fetch ─────┘
 *
 * The parsed Data Model is now LIFTED to the main-content level (task 476) so a
 * single source feeds BOTH this preview's `{token}` resolution AND the always-on
 * Data Model panel, which lives alongside the tab pane rather than inside this
 * host. The host therefore receives the resolved `model` as a prop instead of
 * owning the JSON text. It still subscribes to the module-cached palette so a
 * recolor updates the preview, and threads both into {@link GuiPreview}.
 * Selection is read from the SHARED editor store (F9a) — the
 * preview's click and the structure tree's click both drive the one
 * `selectedNodeId`, so highlighting syncs both ways with no local copy.
 *
 * VIEW TRANSFORM (473): the host owns the preview's `{ scale, panX, panY }` view
 * and the `userAdjusted` flag. It runs the auto-fit reconciliation (open → fit;
 * resize → re-fit only if the user hasn't zoomed/panned), handles the zoom
 * (Ctrl/Cmd+wheel toward the cursor) and pan (space-drag / middle-mouse) gestures
 * on the clipping viewport, and renders the corner zoom toolbar. All the view math
 * is the pure helpers in `guiGeometry` (fitView/zoomTowardCursor/panBy/clampScale).
 *
 * This is the smallest composition that satisfies the F3 acceptance criteria
 * "editing the Data Model JSON updates the preview" and "recoloring a palette entry
 * updates the preview." The full XGUI page shell (component list, structure column,
 * tabs) is later work; this host is the preview-side integration point those will
 * mount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDragDelta,
  fitView,
  panBy,
  refitTriggerKey,
  scaleForWheel,
  type ViewTransform,
  ZOOM_STEP,
  zoomTowardCursor,
} from "../../lib/guiGeometry";
import type { GuiNode } from "../../lib/guiNode";
import { usePalette } from "../../lib/guiPalette";
import { useEditorStore } from "./editorState";
import { GuiPreview } from "./GuiPreview";
import { GuiPreviewToolbar } from "./GuiPreviewToolbar";
import { gridLayerStyle, VIEWPORT_VOID_COLOR } from "./guiBlueprintGrid";
import { withAttr } from "./guiProperties";
import { findNode } from "./guiTreeEdit";

export type GuiPreviewHostProps = {
  /** The parsed component to preview. */
  root: GuiNode;
  /**
   * The resolved Data Model the preview's `{token}` bindings resolve against
   * (task 476). Lifted to the main-content level so ONE source feeds both this
   * preview and the always-on Data Model panel. The parent keeps the LAST GOOD
   * parsed model live, so an invalid keystroke in the panel never blanks the
   * preview — it just stops advancing this value.
   */
  model: unknown;
};

/**
 * The preview itself (the Data Model panel is now hoisted to MainContent, task
 * 476). The palette comes from the module-cached hook, so a recolor (which calls
 * `invalidatePalette`) re-fetches and re-renders without a remount.
 */
export function GuiPreviewHost({ root, model }: GuiPreviewHostProps) {
  // Selection is the SHARED store's single `selectedNodeId` (F9a): a preview click
  // dispatches `select`, the structure tree dispatches the same, and both surfaces
  // highlight off this one value — sync is free because there is one source.
  const { state, dispatch } = useEditorStore();
  const selectedNodeId = state.selectedNodeId;
  // The STABLE identity of the open component — its gui-relative path. This is what
  // "a component opened" keys on: it stays fixed across every edit to the SAME file
  // (drag, property edit, add/remove, undo/redo, live-reload), and only changes when
  // a DIFFERENT component is opened. Unlike `root`, whose reference is replaced on
  // every immutable edit, so it must NOT drive the fit-and-center reset (task 474).
  const openComponentKey = refitTriggerKey(state.open);

  const palette = usePalette();

  // View transform (473): the absolute scale + screen-px pan applied to the stage.
  // Defaults to fit-and-center once the viewport is measured; until then a neutral
  // identity view renders at native size (the first ResizeObserver tick fits it).
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewTransform>({ scale: 1, panX: 0, panY: 0 });
  // Whether the user has manually zoomed/panned. While false the view tracks the
  // auto-fit (open + resize re-fit). Once true, a resize PRESERVES the user's view
  // (we don't yank it) — only an explicit Fit clears the flag and re-fits.
  const userAdjusted = useRef(false);
  // Space held → a left-drag pans instead of selecting. Tracked on window so the
  // viewport doesn't need focus for the modifier to register.
  const spaceHeld = useRef(false);
  // `grabbing` while a pan drag is in flight; `grabReady` while space is held (so the
  // cursor previews the pan affordance before the drag starts). Both drive only the
  // viewport cursor — kept minimal so the space key doesn't thrash renders.
  const [grabbing, setGrabbing] = useState(false);
  const [grabReady, setGrabReady] = useState(false);

  // Measure the viewport once and keep `view` reconciled with the container size.
  // On the FIRST measure (and any resize while the user hasn't adjusted) we fit and
  // center; once the user has zoomed/panned, a resize leaves their view untouched.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      if (userAdjusted.current) return; // preserve the user's manual view across resizes
      setView(fitView(el.clientWidth, el.clientHeight));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Opening a DIFFERENT component re-fits and re-centers, clearing any manual view.
  // Keyed on the open component's STABLE identity (`open.path`), NOT the `root`
  // object reference (task 474): every immutable edit — a drag's per-pointermove
  // `setNodeAttrs`, add/remove, undo/redo, an F13 live-reload of the same file —
  // replaces `root`, so keying on `root` mis-reads any edit as "a component opened"
  // and snaps the view back to fit, discarding the user's zoom/pan. The path only
  // changes when a different file is opened, which is exactly "opened a component".
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit is keyed on the opened component's stable identity (openComponentKey), not the viewport ref/setter.
  useEffect(() => {
    const el = viewportRef.current;
    userAdjusted.current = false;
    if (el) setView(fitView(el.clientWidth, el.clientHeight));
  }, [openComponentKey]);

  // Reset to fit-and-center (the "Fit" control + the auto-fit default).
  const handleFit = useCallback(() => {
    const el = viewportRef.current;
    userAdjusted.current = false;
    if (el) setView(fitView(el.clientWidth, el.clientHeight));
  }, []);

  // Zoom to exactly 100% (the "100%" control), keeping the viewport center fixed so
  // the jump is anchored on what the user is looking at rather than the top-left.
  const handleActualSize = useCallback(() => {
    const el = viewportRef.current;
    userAdjusted.current = true;
    const cx = el ? el.clientWidth / 2 : 0;
    const cy = el ? el.clientHeight / 2 : 0;
    setView((v) => zoomTowardCursor(v, cx, cy, 1));
  }, []);

  // +/− toolbar steps zoom toward the viewport center (no cursor in play).
  const stepZoom = useCallback((factor: number) => {
    const el = viewportRef.current;
    userAdjusted.current = true;
    const cx = el ? el.clientWidth / 2 : 0;
    const cy = el ? el.clientHeight / 2 : 0;
    setView((v) => zoomTowardCursor(v, cx, cy, v.scale * factor));
  }, []);

  // Track the space bar globally so a left-drag can pan. Ignore repeats and don't
  // hijack space while typing in an input/textarea (the Data Model panel).
  useEffect(() => {
    const isTextEntry = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTextEntry(e.target)) {
        spaceHeld.current = true;
        setGrabReady(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        setGrabReady(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Ctrl/Cmd + wheel = zoom toward the cursor. A plain wheel is left alone (it can
  // scroll the surrounding page / does nothing inside the clipped viewport), so the
  // zoom gesture never fights ordinary scrolling. The wheel listener is attached
  // non-passively (so preventDefault works) via the ref effect below.
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    userAdjusted.current = true;
    setView((v) => zoomTowardCursor(v, cursorX, cursorY, scaleForWheel(v.scale, e.deltaY)));
  }, []);

  // React's onWheel is passive (can't preventDefault), so attach the wheel handler
  // imperatively as a non-passive listener on the viewport.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Pan gesture: space + left-drag OR middle-mouse drag. Element drag (a plain
  // left-drag on the selected box) is handled INSIDE GuiPreview on the stage; the
  // pan here runs on the viewport and only claims the pointer when the gesture is
  // unambiguously a pan (space held, or the middle button), so the two never fight.
  const pan = useRef<{ x: number; y: number } | null>(null);

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const isPanGesture = e.button === 1 || (e.button === 0 && spaceHeld.current);
    if (!isPanGesture) return;
    // A space+left pan must NOT fall through to the stage's element-drag/select.
    e.preventDefault();
    e.stopPropagation();
    pan.current = { x: e.clientX, y: e.clientY };
    setGrabbing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const active = pan.current;
    if (!active) return;
    const dx = e.clientX - active.x;
    const dy = e.clientY - active.y;
    pan.current = { x: e.clientX, y: e.clientY };
    userAdjusted.current = true;
    setView((v) => panBy(v, dx, dy));
  };

  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan.current) return;
    pan.current = null;
    setGrabbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // F7 drag-to-move: capture the dragged node's `position` at drag START so each
  // move applies the CUMULATIVE delta to that fixed base — `applyDragDelta` is
  // idempotent per-move, so writing the absolute (start-relative) delta every move
  // never drifts. Held in a ref (not state) so capturing it doesn't re-render.
  const dragBasePosition = useRef<string | undefined>(undefined);
  // A per-GESTURE coalescing key (task 470): every `setNodeAttrs` of one drag
  // shares it, so the whole gesture collapses to ONE undo step instead of one per
  // pointermove. A fresh key is minted on each drag start, so the next gesture
  // opens a new step. Held in a ref so minting it doesn't re-render.
  const dragCoalesceKey = useRef<string>("");

  const handleDragStart = (nodeId: string) => {
    const node = findNode(root, nodeId);
    dragBasePosition.current = node?.attrs.position;
    dragCoalesceKey.current = `drag:${nodeId}:${Date.now()}`;
  };

  const handleDragMove = (nodeId: string, totalDx: number, totalDy: number) => {
    const node = findNode(root, nodeId);
    if (!node) return;
    // Apply the cumulative delta to the position captured at drag start; the offset
    // half tracks the cursor while the scale half is preserved verbatim.
    const nextPosition = applyDragDelta(dragBasePosition.current, totalDx, totalDy);
    dispatch({
      type: "setNodeAttrs",
      nodeId,
      attrs: withAttr(node.attrs, "position", nextPosition),
      // One undo step per gesture (see `dragCoalesceKey`).
      coalesceKey: dragCoalesceKey.current,
    });
  };

  return (
    // Viewport: the measured main-content area. It CLIPS (overflow-hidden) the
    // view-transformed stage; the stage centers itself via the pan baked into
    // `fitView`. The view gestures (zoom wheel, space/middle-drag pan) live here
    // on the viewport; element drag + selection live on the stage inside. The Data
    // Model panel is no longer a sibling here — it is hoisted to MainContent so it
    // stays visible across the View/Controller/XML tabs (task 476).
    <div
      ref={viewportRef}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      // The clipping viewport — the area BEHIND/around the 1280×768 stage. It paints
      // only the flat void color; the two-tier graph-paper grid is a dedicated child
      // LAYER below (so it can pan by a compositor transform instead of repainting its
      // gradients every frame — see `gridLayerStyle`). The cursor style is set here.
      className="relative h-full min-h-0 overflow-hidden"
      style={{
        backgroundColor: VIEWPORT_VOID_COLOR,
        cursor: grabbing ? "grabbing" : grabReady ? "grab" : undefined,
      }}
    >
      {/* Blueprint backdrop (479/480/481): a two-tier graph-paper grid that PANS with
          the view but does NOT zoom. Rendered as its own pointer-transparent layer
          BEHIND the stage so a pan TRANSLATES it (cheap composite) rather than
          repainting its gradients. `grabbing` promotes it to a layer only while
          panning. It carries no node ids, so it never affects hit-testing/selection. */}
      <div aria-hidden="true" className="pointer-events-none" style={gridLayerStyle(view, grabbing)} />

      <GuiPreview
        root={root}
        selectedNodeId={selectedNodeId}
        onSelect={(nodeId) => dispatch({ type: "select", nodeId })}
        model={model}
        palette={palette}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        view={view}
        isPanGesture={(e) => e.button === 1 || (e.button === 0 && spaceHeld.current)}
        isLocked={(nodeId) => state.lockedNodeIds.has(nodeId)}
        // While a pan drag is active, let the stage composite as its own layer (perf).
        interacting={grabbing}
      />
      <GuiPreviewToolbar
        scale={view.scale}
        onZoomOut={() => stepZoom(1 / ZOOM_STEP)}
        onZoomIn={() => stepZoom(ZOOM_STEP)}
        onFit={handleFit}
        onActualSize={handleActualSize}
      />
    </div>
  );
}
