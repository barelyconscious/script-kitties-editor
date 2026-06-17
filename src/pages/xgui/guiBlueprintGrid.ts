/**
 * guiBlueprintGrid — the pure backdrop math for the XGUI viewport's blueprint
 * graph-paper grid (tasks 479/480).
 *
 * Task 478 painted the grid ON the 1280×768 stage; 479 flipped it so the stage is
 * a SOLID artboard and the grid lives BEHIND it on the clipping viewport. 480
 * makes the grid a FIXED backdrop: it does NOT pan or zoom with the artboard — it
 * stays put while the view-transformed stage moves on top of it. A minor line
 * every {@link GRID_MINOR_PX} px sits under a stronger major line every
 * {@link GRID_MAJOR_PX} — both blue-tinted and very low alpha so the grid reads as
 * a backdrop and never competes with content.
 *
 * Crispness comes from drawing with INTEGER cell sizes, integer line widths, and a
 * static integer background-position via HARD-stop repeating-linear-gradients: each
 * line spans exactly `0 1px` then transparent to the integer cell edge, anchored at
 * the origin, so every line falls on a whole device pixel and renders sharp (no
 * fractional sub-pixel offsets to blur it).
 *
 * This is a PURE style builder (no DOM, no React, no view transform) so the layer
 * order and tile sizing are assertable without a real editor. The caller drops the
 * returned `CSSProperties` onto the clipping viewport as a pure backdrop — it is
 * only `background-*`, adding nothing to hit-testing/selection/drag.
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

/**
 * Build the viewport's FIXED blueprint backdrop style.
 *
 * The grid is independent of the view transform: constant integer cell sizes and a
 * static (0,0) origin, so it stays put while the artboard zooms/pans on top. Every
 * line falls on a whole pixel (integer size + integer position + hard gradient
 * stops), so the grid renders crisp rather than blurry.
 */
export function viewportGridStyle(): CSSProperties {
  return {
    backgroundColor: VIEWPORT_VOID_COLOR,
    backgroundImage: gridImageLayers(),
    backgroundSize: gridSizeLayers(),
    // Static integer origin: all four layers anchored at (0,0) so lines stay on
    // whole pixels and the major/minor phases stay locked.
    backgroundPosition: "0 0",
  };
}
