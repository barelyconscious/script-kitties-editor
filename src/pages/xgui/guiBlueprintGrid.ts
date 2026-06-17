/**
 * guiBlueprintGrid — the pure backdrop math for the XGUI viewport's blueprint
 * graph-paper grid (tasks 479/480).
 *
 * Task 478 painted the grid ON the 1280×768 stage; 479 flipped it so the stage is
 * a SOLID artboard and the grid lives BEHIND it on the clipping viewport. 480 made
 * the grid a fully FIXED backdrop. 481 re-introduces PAN (but NOT zoom): the grid
 * PANS with the view — its background-position is offset by the view's pan — so the
 * graph paper feels anchored to the canvas and scrolls under the artboard as the
 * user pans. It still does NOT zoom: the cell size stays a constant integer, screen-
 * fixed, regardless of scale. A minor line every {@link GRID_MINOR_PX} px sits under
 * a stronger major line every {@link GRID_MAJOR_PX} — both blue-tinted and very low
 * alpha so the grid reads as a backdrop and never competes with content.
 *
 * Crispness comes from drawing with INTEGER cell sizes, integer line widths, and an
 * INTEGER-rounded background-position via HARD-stop repeating-linear-gradients: each
 * line spans exactly `0 1px` then transparent to the integer cell edge, and the pan
 * offset is rounded to whole pixels, so every line falls on a whole device pixel and
 * renders sharp (no fractional sub-pixel offsets to blur it) even while panning.
 *
 * This is a PURE style builder (no DOM, no React) so the layer order, tile sizing,
 * and pan offset are assertable without a real editor. The caller drops the returned
 * `CSSProperties` onto the clipping viewport as a pure backdrop — it is only
 * `background-*`, adding nothing to hit-testing/selection/drag.
 */

import type { CSSProperties } from "react";

/**
 * Minor / major grid spacing in fixed SCREEN pixels. Both are integers and the
 * major is an integer multiple of the minor, so the two tiers stay phase-aligned.
 * These are constant — the grid never scales with zoom, so the cells stay sharp.
 */
export const GRID_MINOR_PX = 24;
export const GRID_MAJOR_PX = 120;

/**
 * The faint MINOR / stronger MAJOR grid line colors — blue-tinted, very low alpha
 * so the grid reads as a backdrop on the dark viewport void and never competes
 * with the solid artboard or the rendered boxes on it.
 */
export const GRID_MINOR_COLOR = "rgba(120, 150, 220, 0.05)";
export const GRID_MAJOR_COLOR = "rgba(130, 165, 235, 0.10)";

/** The flat void color behind the grid (the viewport area outside the artboard). */
export const VIEWPORT_VOID_COLOR = "#0d0d10";

/**
 * The four `background-image` layers painting the two-tier graph-paper grid: a
 * pair of 1px repeating-linear-gradients (vertical + horizontal) per tier. The
 * MAJOR pair is listed FIRST so it paints on top of the MINOR pair where they
 * coincide. Each gradient HARD-stops a 1px line then jumps transparent to the
 * integer cell edge, so the line lands on a whole pixel and stays crisp.
 */
function gridImageLayers(): string {
  return [
    `repeating-linear-gradient(to right, ${GRID_MAJOR_COLOR} 0 1px, transparent 1px ${GRID_MAJOR_PX}px)`,
    `repeating-linear-gradient(to bottom, ${GRID_MAJOR_COLOR} 0 1px, transparent 1px ${GRID_MAJOR_PX}px)`,
    `repeating-linear-gradient(to right, ${GRID_MINOR_COLOR} 0 1px, transparent 1px ${GRID_MINOR_PX}px)`,
    `repeating-linear-gradient(to bottom, ${GRID_MINOR_COLOR} 0 1px, transparent 1px ${GRID_MINOR_PX}px)`,
  ].join(", ");
}

/** The per-layer integer tile size matching {@link gridImageLayers} (major, major, minor, minor). */
function gridSizeLayers(): string {
  return [
    `${GRID_MAJOR_PX}px ${GRID_MAJOR_PX}px`,
    `${GRID_MAJOR_PX}px ${GRID_MAJOR_PX}px`,
    `${GRID_MINOR_PX}px ${GRID_MINOR_PX}px`,
    `${GRID_MINOR_PX}px ${GRID_MINOR_PX}px`,
  ].join(", ");
}

/** The view's pan offset in screen pixels — the only part of the view the grid uses. */
export type GridPan = {
  panX: number;
  panY: number;
};

/**
 * Build the viewport's blueprint backdrop style for the given pan offset.
 *
 * The grid PANS with the view but does NOT zoom: the cell sizes are constant
 * integers (screen-fixed, never multiplied by scale), and the background-position is
 * offset by the view's pan so the graph paper scrolls under the artboard as the user
 * pans. The pan offset is ROUNDED to whole pixels so every line still falls on a
 * whole pixel (integer size + integer position + hard gradient stops) and the grid
 * renders crisp rather than blurry, even mid-pan.
 */
export function viewportGridStyle({ panX, panY }: GridPan): CSSProperties {
  // Round the pan to whole pixels so all four layers anchor on integer offsets and
  // the lines stay sharp while the major/minor phases stay locked together.
  const x = Math.round(panX);
  const y = Math.round(panY);
  return {
    backgroundColor: VIEWPORT_VOID_COLOR,
    backgroundImage: gridImageLayers(),
    backgroundSize: gridSizeLayers(),
    backgroundPosition: `${x}px ${y}px`,
  };
}
