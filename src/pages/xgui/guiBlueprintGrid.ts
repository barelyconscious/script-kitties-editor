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
 * How far the grid layer extends BEYOND each viewport edge. The layer pans by a
 * transform within `[0, GRID_MAJOR_PX)` (one period — see {@link gridLayerStyle}), so
 * overscanning by exactly one period guarantees the translated layer never exposes an
 * uncovered edge inside the clipping viewport.
 */
export const GRID_OVERSCAN_PX = GRID_MAJOR_PX;

/**
 * Build the blueprint backdrop style for a DEDICATED, oversized grid LAYER that pans
 * by a CSS `transform` rather than a `background-position` offset (perf).
 *
 * The graph paper is periodic with period {@link GRID_MAJOR_PX}, so translating the
 * layer by `pan mod GRID_MAJOR_PX` is visually IDENTICAL to offsetting the pattern by
 * the full pan — but a transform COMPOSITES (the browser moves a cached layer) whereas
 * a `background-position` change REPAINTS all four gradients across the whole viewport
 * every frame. Over a screen that nests many components, that per-frame backdrop
 * repaint is a real share of pan jank; this removes it.
 *
 * The layer is inset by one period on every side ({@link GRID_OVERSCAN_PX}) so the
 * `[0, period)` translation always keeps it covering the clipped viewport. The pan is
 * rounded to whole pixels (integer size + integer translate + hard gradient stops) so
 * every line lands on a device pixel and stays crisp mid-pan. `interacting` promotes
 * the layer (`will-change: transform`) only while panning so the gesture composites;
 * idle it is a plain painted backdrop (no standing GPU-memory cost).
 *
 * It does NOT zoom: the cell sizes are constant integers, screen-fixed regardless of
 * scale. The flat void color sits on the VIEWPORT behind this transparent layer.
 */
export function gridLayerStyle({ panX, panY }: GridPan, interacting = false): CSSProperties {
  const period = GRID_MAJOR_PX;
  // Positive modulo so the translate stays in [0, period); the one-period overscan
  // then always covers the viewport. Rounded so lines fall on whole device pixels.
  const tx = ((Math.round(panX) % period) + period) % period;
  const ty = ((Math.round(panY) % period) + period) % period;
  return {
    position: "absolute",
    inset: `-${GRID_OVERSCAN_PX}px`,
    backgroundImage: gridImageLayers(),
    backgroundSize: gridSizeLayers(),
    transform: `translate(${tx}px, ${ty}px)`,
    willChange: interacting ? "transform" : undefined,
  };
}
