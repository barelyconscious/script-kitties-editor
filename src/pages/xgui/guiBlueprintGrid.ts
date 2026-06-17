/**
 * guiBlueprintGrid — the pure backdrop math for the XGUI viewport's blueprint
 * graph-paper grid (task 479).
 *
 * Task 478 painted the grid ON the 1280×768 stage; 479 flips it: the stage is a
 * SOLID artboard, and the blueprint grid lives BEHIND it on the clipping viewport,
 * so the artboard reads as a sheet sitting on an infinite graph-paper canvas.
 *
 * The grid TRACKS THE VIEW so it feels like one continuous canvas the artboard is
 * pinned to: it scales its cell size by the current zoom and offsets its origin by
 * the pan, exactly matching `translate(panX, panY) scale(scale)` applied to the
 * stage. A minor line every {@link GRID_MINOR_LOGICAL_PX} logical px sits under a
 * stronger major line every {@link GRID_MAJOR_LOGICAL_PX} — both blue-tinted and
 * very low alpha so the grid reads as a backdrop and never competes with content.
 *
 * This is a PURE style builder (no DOM, no React) so the layer order, the
 * pan/zoom tracking, and the tile sizing are all assertable without a real editor.
 * The caller drops the returned `CSSProperties` onto the clipping viewport as a
 * pure backdrop — `pointer-events` stays untouched there since the viewport is
 * already the gesture surface and the grid is only its `background-*`, adding
 * nothing to hit-testing/selection/drag.
 */

import type { CSSProperties } from "react";
import type { ViewTransform } from "../../lib/guiGeometry";

/**
 * Minor / major grid spacing in the stage's LOGICAL pixels (the same 1280×768
 * space the stage content lives in). A faint line every minor step, a stronger
 * line every major step. The major step is an integer multiple of the minor so
 * the two tiers stay phase-aligned at any zoom. Multiplied by the view `scale`
 * to get the on-screen tile size, so the grid scales WITH the artboard.
 */
export const GRID_MINOR_LOGICAL_PX = 20;
export const GRID_MAJOR_LOGICAL_PX = 100;

/**
 * The faint MINOR / stronger MAJOR grid line colors — blue-tinted, very low alpha
 * so the grid reads as a backdrop on the dark viewport void and never competes
 * with the solid artboard or the rendered boxes on it.
 */
export const GRID_MINOR_COLOR = "rgba(120, 150, 220, 0.05)";
export const GRID_MAJOR_COLOR = "rgba(130, 165, 235, 0.10)";

/** The flat void color behind the grid (the viewport area outside the artboard). */
export const VIEWPORT_VOID_COLOR = "#0d0d10";

/** A grid scaled below this many screen px per minor cell is dropped (anti-moiré). */
const MIN_VISIBLE_MINOR_PX = 4;

/**
 * The four `background-image` layers painting the two-tier graph-paper grid: a
 * pair of 1px repeating-linear-gradients (vertical + horizontal) per tier. The
 * MAJOR pair is listed FIRST so it paints on top of the MINOR pair where they
 * coincide. Spacing is given in SCREEN px (logical × scale) so it tracks zoom.
 */
function gridImageLayers(minorPx: number, majorPx: number): string {
  return [
    `repeating-linear-gradient(to right, ${GRID_MAJOR_COLOR} 0 1px, transparent 1px ${majorPx}px)`,
    `repeating-linear-gradient(to bottom, ${GRID_MAJOR_COLOR} 0 1px, transparent 1px ${majorPx}px)`,
    `repeating-linear-gradient(to right, ${GRID_MINOR_COLOR} 0 1px, transparent 1px ${minorPx}px)`,
    `repeating-linear-gradient(to bottom, ${GRID_MINOR_COLOR} 0 1px, transparent 1px ${minorPx}px)`,
  ].join(", ");
}

/** The per-layer tile size matching {@link gridImageLayers} (major, major, minor, minor). */
function gridSizeLayers(minorPx: number, majorPx: number): string {
  return [
    `${majorPx}px ${majorPx}px`,
    `${majorPx}px ${majorPx}px`,
    `${minorPx}px ${minorPx}px`,
    `${minorPx}px ${minorPx}px`,
  ].join(", ");
}

/**
 * Build the viewport's blueprint backdrop style for the current view transform.
 *
 * The grid TRACKS THE VIEW: the tile size is the logical spacing × `scale` (zoom),
 * and the origin is offset by `panX`/`panY` so a grid line stays pinned to the
 * artboard's logical (0,0) as the user pans/zooms — the artboard reads as a sheet
 * on one continuous canvas. All four layers share the same `panX panY` origin so
 * the major lines stay phase-aligned with the minor ones.
 *
 * When the zoom shrinks the minor cell below {@link MIN_VISIBLE_MINOR_PX} screen
 * px the minor tier would collapse into a muddy fill, so only the MAJOR tier is
 * drawn at very low zoom (the grid degrades gracefully instead of moiréing).
 */
export function viewportGridStyle(view: ViewTransform): CSSProperties {
  const { scale, panX, panY } = view;
  const minorPx = GRID_MINOR_LOGICAL_PX * scale;
  const majorPx = GRID_MAJOR_LOGICAL_PX * scale;
  // Pan offsets every layer's origin together so the whole grid slides with the
  // artboard; the major/minor phases stay locked because they share this origin.
  const origin = `${panX}px ${panY}px`;
  const backgroundPosition = [origin, origin, origin, origin].join(", ");

  // Below the floor, the minor grid would alias into noise — drop it, keep major.
  if (minorPx < MIN_VISIBLE_MINOR_PX) {
    return {
      backgroundColor: VIEWPORT_VOID_COLOR,
      backgroundImage: [
        `repeating-linear-gradient(to right, ${GRID_MAJOR_COLOR} 0 1px, transparent 1px ${majorPx}px)`,
        `repeating-linear-gradient(to bottom, ${GRID_MAJOR_COLOR} 0 1px, transparent 1px ${majorPx}px)`,
      ].join(", "),
      backgroundSize: [`${majorPx}px ${majorPx}px`, `${majorPx}px ${majorPx}px`].join(", "),
      backgroundPosition: [origin, origin].join(", "),
    };
  }

  return {
    backgroundColor: VIEWPORT_VOID_COLOR,
    backgroundImage: gridImageLayers(minorPx, majorPx),
    backgroundSize: gridSizeLayers(minorPx, majorPx),
    backgroundPosition,
  };
}
