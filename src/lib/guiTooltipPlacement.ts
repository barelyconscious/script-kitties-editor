/**
 * guiTooltipPlacement — the pure, unit-testable math behind the XGUI preview's
 * tooltip simulation (tasks 515/516). It owns two concerns, both coordinate math and
 * neither React/DOM:
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
 *      zoom/pan transform is undone), so downstream math is trivial and testable in a
 *      single coordinate space. The stage is drawn `translate(pan) scale(scale)` from
 *      its top-left, so `logical = (screen - stageScreenOrigin) / scale`.
 *
 * ANCHORING CONTRACT (task 516, engine ground truth — worlds-cpp GUILoader.cpp:370):
 * the engine parents the loaded tooltip subtree to the PROVIDER element ("it needs a
 * parent to compare its size and position to"), so the tooltip's geometry resolves
 * against the HOVERED ELEMENT'S RECT and placement is authored entirely by the tooltip
 * component itself (a child at `position="1,1,0,0"` sits at the provider's bottom-right
 * corner). The preview therefore renders the tooltip in a frame EQUAL to the provider's
 * stage rect — there is no editor-side placement policy. The design doc's stage-7
 * placement (below-anchor gap / flip / clamp / a default card size) is FUTURE ENGINE
 * work and is deliberately NOT simulated here; the old `placeTooltip` /
 * `tooltipSizeFromRoot` helpers were removed with it. What remains is the hit-test +
 * coordinate-conversion core that feeds the provider rect straight to the overlay.
 *
 * @see design/xgui_mouse_input.md — "Stage 7 — Overlay root + tooltip system" (future)
 */

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

/**
 * The tooltip simulation's Alt-gated hover decision (task 519): the preview only
 * peeks a tooltip while Alt/Option is held, so the target is the topmost provider
 * under the pointer ONLY when `altHeld` is true and a pointer position is known.
 * A released Alt (`altHeld === false`) or an unknown pointer (`null`, e.g. the
 * cursor has never entered the stage) yields `null` → hide.
 *
 * Extracted from the React controller so the gating is a pure, unit-testable step
 * shared by BOTH entry points that drive the peek: the pointermove handler and the
 * window Alt keydown/keyup re-evaluation from the last stored pointer.
 */
export function pickHoverTarget<T extends { rect: ScreenRectEdges }>(
  entries: readonly T[],
  pointer: { x: number; y: number } | null,
  altHeld: boolean,
): T | null {
  if (!altHeld || !pointer) return null;
  return pickTopmostRect(entries, pointer.x, pointer.y);
}
