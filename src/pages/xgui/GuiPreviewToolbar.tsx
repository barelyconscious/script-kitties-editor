/**
 * GuiPreviewToolbar — the unobtrusive zoom/pan controls overlaid in a corner of
 * the XGUI preview (473). It is a thin, stateless control surface: it reads the
 * current scale (to show the zoom %) and calls back on each control. All view-state
 * math (zoom-toward-cursor, fit/center, clamp) lives in the pure `guiGeometry`
 * helpers the host wires these callbacks to — this component owns no logic beyond
 * formatting the percentage.
 *
 * Placement is the host's job (an absolutely-positioned overlay in the bottom-right
 * of the viewport); this renders just the pill of controls so it doesn't steal
 * layout from the preview.
 */

import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";

export type GuiPreviewToolbarProps = {
  /** The current absolute render scale (1 = 100%). */
  scale: number;
  /** Zoom out one step (toward the viewport center). */
  onZoomOut: () => void;
  /** Zoom in one step (toward the viewport center). */
  onZoomIn: () => void;
  /** Reset to fit-and-center (the "Fit" state) and clear the user-adjusted flag. */
  onFit: () => void;
  /** Set the scale to exactly 1 (100%), keeping the view centered on its center. */
  onActualSize: () => void;
};

/** Format an absolute scale as a rounded whole-percent label (e.g. 0.5 → "50%"). */
export function formatZoomPercent(scale: number): string {
  if (!Number.isFinite(scale)) return "100%";
  return `${Math.round(scale * 100)}%`;
}

/**
 * The corner zoom toolbar: −, the current zoom %, +, then Fit and 100% controls.
 * Subtle styling (a translucent pill with a subtle border) so it reads as an
 * overlay affordance, not part of the rendered GUI. Buttons stop pointer events
 * from reaching the stage so a toolbar click never selects/deselects a box.
 */
export function GuiPreviewToolbar({
  scale,
  onZoomOut,
  onZoomIn,
  onFit,
  onActualSize,
}: GuiPreviewToolbarProps) {
  return (
    // The toolbar is a SIBLING of the stage inside the viewport (not a descendant),
    // so its clicks never reach the stage's select handler — no stopPropagation
    // needed. The Buttons own all interactivity; this is a plain labelled container.
    <div
      role="toolbar"
      aria-label="Preview zoom"
      className="pointer-events-auto absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/80 p-1 shadow-sm backdrop-blur-sm"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <Minus />
      </Button>
      <span
        className="min-w-[3.25rem] text-center font-medium text-muted-foreground text-xs tabular-nums"
        title="Current zoom"
      >
        {formatZoomPercent(scale)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <Plus />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onFit}
        title="Fit the component to the viewport"
      >
        <Maximize2 />
        Fit
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onActualSize}
        title="Zoom to 100% (actual size)"
      >
        100%
      </Button>
    </div>
  );
}
