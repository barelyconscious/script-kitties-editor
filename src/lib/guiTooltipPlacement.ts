/**
 * guiTooltipPlacement — the pure, unit-testable math behind the XGUI preview's
 * tooltip simulation (task 515). It owns three concerns, all coordinate math and
 * none of them React/DOM:
 *
 *   1. HIT-TESTING (`rectContainsPoint` / `pickTopmostRect`) — given the pointer in
 *      SCREEN coordinates and the registered tooltip providers' screen rects, pick
 *      the provider under the cursor. Screen space is used because
 *      `getBoundingClientRect` is already screen-space, so the pointer test is free
 *      of zoom/pan. "Topmost" v1 = the LAST registered match (≈ paint order — a
 *      later sibling / a mounted child registers after, so it wins over an
 *      overlapping earlier provider). Refined via z-order later if needed.
 *
 *   2. SCREEN→STAGE CONVERSION (`screenRectToStageRect`) — convert a provider's
 *      screen rect into the stage's LOGICAL 1280×768 space (the one place the
 *      zoom/pan transform is undone), so placement math is trivial and testable in a
 *      single coordinate space. The stage is drawn `translate(pan) scale(scale)` from
 *      its top-left, so `logical = (screen - stageScreenOrigin) / scale`.
 *
 *   3. PLACEMENT (`placeTooltip`) — anchor the tooltip card BELOW the provider (top
 *      edge a gap under the provider's bottom, left edges aligned so the card grows
 *      down-and-right), FLIP it above when it would overflow the stage bottom, and
 *      CLAMP it horizontally into the 1280×768 stage. All in stage-logical space; the
 *      overlay renders inside the stage transform, so it scales with zoom like the
 *      runtime card will.
 *
 * The tooltip card's own size comes from its root's authored ABSOLUTE size
 * (`tooltipSizeFromRoot`) — the loader lint nudges authors toward an absolute root
 * size; a missing/relative one falls back to {@link DEFAULT_TOOLTIP_SIZE} so
 * placement still has a sane box to flip/clamp against.
 *
 * @see design/xgui_mouse_input.md — "Stage 7 — Overlay root + tooltip system"
 */

import { parseUDim2 } from "./guiGeometry";

/** A width/height pair in stage-logical pixels. */
export type Size = { width: number; height: number };

/** The fixed stage bounds placement clamps/flips against (1280×768 logical). */
export type StageBounds = { width: number; height: number };

/** A point in stage-logical space (the tooltip card's top-left). */
export type Point = { x: number; y: number };

/** A rect in stage-logical space: top-left `x`/`y` plus `width`/`height`. */
export type StageRect = { x: number; y: number; width: number; height: number };

/**
 * The subset of a `DOMRect` the hit-test reads — screen-space edges. A real
 * `DOMRect` satisfies this, so a provider's `getBoundingClientRect()` is passed
 * straight through.
 */
export type ScreenRectEdges = { left: number; top: number; right: number; bottom: number };

/** The subset of a `DOMRect` the screen→stage conversion reads. */
export type ScreenRectOrigin = { left: number; top: number; width: number; height: number };

/** The gap (stage-logical px) between the provider's edge and the tooltip card. */
export const TOOLTIP_GAP = 8;

/**
 * The tooltip card size used when the referenced component's root does not declare a
 * usable ABSOLUTE size (missing, or a relative/zero width/height). The loader lint
 * warns authors to give tooltip roots an absolute pixel size; until they do, this
 * keeps placement's flip/clamp math sane rather than degenerating to a 0×0 box.
 */
export const DEFAULT_TOOLTIP_SIZE: Size = { width: 160, height: 96 };

/**
 * The tooltip card's on-screen size, from its root `<View>`'s `size` attribute — the
 * ABSOLUTE (`absX`/`absY`) fields only, since a tooltip sizes in pixels (relative
 * fields would size against the card's own overlay box, which is meaningless). A
 * non-positive absolute field (absent size, or a relative/token root size) falls back
 * to {@link DEFAULT_TOOLTIP_SIZE} per axis.
 */
export function tooltipSizeFromRoot(sizeAttr: string | undefined): Size {
  const { absX, absY } = parseUDim2(sizeAttr);
  return {
    width: absX > 0 ? absX : DEFAULT_TOOLTIP_SIZE.width,
    height: absY > 0 ? absY : DEFAULT_TOOLTIP_SIZE.height,
  };
}

/**
 * Place the tooltip card relative to its provider, all in stage-logical space.
 *
 *   - PREFERRED: directly below the provider — the card's top edge a `gap` under the
 *     provider's bottom, its left edge aligned with the provider's left, so the card
 *     grows down-and-right from the provider's bottom-left corner.
 *   - FLIP: if the card would overflow the stage's bottom edge, place it ABOVE the
 *     provider instead (bottom edge a `gap` above the provider's top).
 *   - CLAMP: the card's left is clamped so it stays within the stage horizontally
 *     (`0 … stage.width - card.width`); a card wider than the stage pins to the left.
 *
 * Vertical is FLIP (not clamp) by design — a flipped card sits fully above the
 * provider rather than being nudged to overlap it. Horizontal is clamp. Returns the
 * card's top-left in stage-logical coordinates.
 */
export function placeTooltip(
  anchor: StageRect,
  tooltip: Size,
  stage: StageBounds,
  gap: number = TOOLTIP_GAP,
): Point {
  const belowY = anchor.y + anchor.height + gap;
  // Flip above when the below placement would run past the stage bottom.
  const flip = belowY + tooltip.height > stage.height;
  const y = flip ? anchor.y - gap - tooltip.height : belowY;
  // Horizontal clamp: keep the card on-stage; a too-wide card pins left.
  const maxX = Math.max(0, stage.width - tooltip.width);
  const x = Math.min(maxX, Math.max(0, anchor.x));
  return { x, y };
}

/**
 * Convert a provider's SCREEN rect into the stage's LOGICAL 1280×768 space. The stage
 * is rendered `translate(pan) scale(scale)` from its top-left, so a child painted at
 * logical `(lx, ly)` sits on screen at `stageOrigin + logical * scale`; inverting
 * gives `logical = (screen - stageOrigin) / scale`. `stageOrigin` is the stage
 * element's own `getBoundingClientRect()` (its transformed top-left), so pan is baked
 * in and only the scale division remains.
 *
 * A non-finite/non-positive `scale` falls back to a 1:1 mapping (defense-in-depth; the
 * caller passes the clamped view scale, always > 0).
 */
export function screenRectToStageRect(
  child: ScreenRectOrigin,
  stageOrigin: { left: number; top: number },
  scale: number,
): StageRect {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: (child.left - stageOrigin.left) / s,
    y: (child.top - stageOrigin.top) / s,
    width: child.width / s,
    height: child.height / s,
  };
}

/** Whether a screen point lies within a screen rect (edges inclusive). */
export function rectContainsPoint(rect: ScreenRectEdges, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Pick the TOPMOST provider whose screen rect contains the pointer, or `null` when
 * none do. Topmost v1 = the LAST match in registration order (≈ paint order): later
 * siblings and mounted children register after their neighbours, so the last
 * containing rect is the one painted on top. Entries are scanned in order and the
 * final match wins.
 *
 * Generic over the entry shape (only `rect` is read) so the caller can carry `src` /
 * `data` / a key on each entry and get the chosen one back whole.
 */
export function pickTopmostRect<T extends { rect: ScreenRectEdges }>(
  entries: readonly T[],
  x: number,
  y: number,
): T | null {
  let hit: T | null = null;
  for (const entry of entries) {
    if (rectContainsPoint(entry.rect, x, y)) hit = entry;
  }
  return hit;
}
