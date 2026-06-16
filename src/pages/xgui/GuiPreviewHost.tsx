/**
 * GuiPreviewHost — wires the F3 resolution loop end to end:
 *
 *   Data Model JSON  ──parse──▶  flat root model ─┐
 *   palette (get_palette, module-cached) ─────────┼──▶ GuiPreview resolves tokens
 *                                                  │     + palette names + colors
 *   recolor → invalidatePalette() → re-fetch ─────┘
 *
 * Holds the Data Model panel's text and the LAST GOOD parsed model (so an invalid
 * keystroke surfaces an error without blanking the preview), subscribes to the
 * module-cached palette so a recolor updates the preview, and threads both into
 * {@link GuiPreview}. Selection is read from the SHARED editor store (F9a) — the
 * preview's click and the structure tree's click both drive the one
 * `selectedNodeId`, so highlighting syncs both ways with no local copy.
 *
 * This is the smallest composition that satisfies the F3 acceptance criteria
 * "editing the Data Model JSON updates the preview" and "recoloring a palette entry
 * updates the preview." The full XGUI page shell (component list, structure column,
 * tabs) is later work; this host is the preview-side integration point those will
 * mount.
 */

import { useEffect, useRef, useState } from "react";
import { applyDragDelta, computeFitScale, STAGE_HEIGHT, STAGE_WIDTH } from "../../lib/guiGeometry";
import type { GuiNode } from "../../lib/guiNode";
import { usePalette } from "../../lib/guiPalette";
import { DataModelPanel } from "./DataModelPanel";
import { useEditorStore } from "./editorState";
import { GuiPreview } from "./GuiPreview";
import { withAttr } from "./guiProperties";
import { findNode } from "./guiTreeEdit";

export type GuiPreviewHostProps = {
  /** The parsed component to preview. */
  root: GuiNode;
  /** Initial Data Model JSON text (defaults to an empty object). */
  initialModelText?: string;
};

/**
 * The preview + Data Model panel pair. The model text is controlled here; the last
 * successfully-parsed model is kept live so the preview only re-resolves against
 * valid JSON. The palette comes from the module-cached hook, so a recolor (which
 * calls `invalidatePalette`) re-fetches and re-renders without a remount.
 */
export function GuiPreviewHost({ root, initialModelText = "{}" }: GuiPreviewHostProps) {
  const [modelText, setModelText] = useState(initialModelText);
  // Last GOOD model: only advanced when the JSON parses, so an invalid keystroke
  // shows the error (in the panel) but the preview keeps the last valid state.
  const [model, setModel] = useState<unknown>(() => {
    try {
      return JSON.parse(initialModelText);
    } catch {
      return {};
    }
  });
  // Selection is the SHARED store's single `selectedNodeId` (F9a): a preview click
  // dispatches `select`, the structure tree dispatches the same, and both surfaces
  // highlight off this one value — sync is free because there is one source.
  const { state, dispatch } = useEditorStore();
  const selectedNodeId = state.selectedNodeId;

  const palette = usePalette();

  // Scale-to-fit: measure the available main-content area and derive the largest
  // uniform scale that fits the 1280×768 stage inside it (letterbox, aspect
  // preserved). A ResizeObserver keeps it live as the window/pane resizes. The
  // scale threads into GuiPreview (applied as the stage transform AND the drag's
  // screen→logical divisor).
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setScale(computeFitScale(el.clientWidth, el.clientHeight));
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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
    <div className="flex h-full min-h-0">
      {/* Viewport: the measured main-content area. Flex-centers the scaled stage
          (fit-and-center / letterbox). overflow-hidden clips any letterbox bleed. */}
      <div
        ref={viewportRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
      >
        {/* Footprint box sized to the SCALED stage. A CSS transform doesn't change
            layout size, so without this the flex centering would center the stage's
            unscaled 1280×768 footprint. Sizing the wrapper to the scaled dimensions
            (with the stage pinned top-left inside it) centers what's actually drawn. */}
        <div
          style={{
            width: `${STAGE_WIDTH * scale}px`,
            height: `${STAGE_HEIGHT * scale}px`,
            flex: "none",
          }}
        >
          <GuiPreview
            root={root}
            selectedNodeId={selectedNodeId}
            onSelect={(nodeId) => dispatch({ type: "select", nodeId })}
            model={model}
            palette={palette}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            scale={scale}
          />
        </div>
      </div>
      <div className="w-80 shrink-0 border-border border-l">
        <DataModelPanel
          value={modelText}
          onChange={(text, parse) => {
            setModelText(text);
            if (parse.ok) setModel(parse.model);
          }}
        />
      </div>
    </div>
  );
}
