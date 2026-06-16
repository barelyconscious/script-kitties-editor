/**
 * guiGeometry — the pure, unit-testable core of the XGUI preview's box layout.
 *
 * The runtime positions/sizes elements with a UDim2-style model: a `position`
 * or `size` is four fields `relX,relY,absX,absY` — a fraction (scale) of the
 * parent plus a pixel offset. That maps directly onto CSS:
 *
 *   left/top    = calc(relX * 100% + absX px)      (from `position`)
 *   width/height = calc(relX * 100% + absX px)      (from `size`)
 *
 * Because `calc()` does the `scale·parent + offset` sum natively, the preview
 * is a plain absolutely-positioned DOM tree with NO layout solver and NO
 * measurement pass — the browser computes the cascade. This module owns the
 * string parsing + `calc()` synthesis; {@link GuiPreview} is a thin React shell
 * around it.
 *
 * SCOPE (F2): LITERAL attribute values only. A `{token}` binding is not
 * resolved here — token/literal resolution is F3. A field that is not a finite
 * number (e.g. `"{healthRatio}"`) is treated as `0` for geometry, so the box
 * still lays out at a sane fallback while its raw text renders elsewhere.
 *
 * @see design/xgui_ta.md — "Mapping the rel/abs (UDim2-style) model to the DOM"
 */

/** Default `position` when the attribute is absent — top-left, no offset. */
export const DEFAULT_POSITION = "0,0,0,0";

/** Default `size` when the attribute is absent — fill the parent (`1,1,0,0`). */
export const DEFAULT_SIZE = "1,1,0,0";

/** The fixed preview stage, per the View tab's locked resolution. */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 768;

/**
 * The fit-to-container scale for the fixed 1280×768 stage: the largest uniform
 * scale that fits the stage entirely inside `containerW × containerH` while
 * preserving the 1280:768 aspect ratio (letterbox / fit-and-center). The caller
 * applies the result as a single `transform: scale()` on the ROOT stage and
 * centers the scaled box; children keep their 1280×768 LOGICAL coordinates.
 *
 *   scale = min(containerW / STAGE_WIDTH, containerH / STAGE_HEIGHT)
 *
 * Returns `1` when the container has not been measured yet (a zero/negative/
 * non-finite dimension) so the stage renders at its native size until the first
 * {@link ResizeObserver} tick, rather than collapsing to scale 0. The result is
 * never ≤ 0 — a degenerate container falls back to `1`, not an invisible stage.
 */
export function computeFitScale(containerW: number, containerH: number): number {
  if (
    !Number.isFinite(containerW) ||
    !Number.isFinite(containerH) ||
    containerW <= 0 ||
    containerH <= 0
  ) {
    return 1;
  }
  const scale = Math.min(containerW / STAGE_WIDTH, containerH / STAGE_HEIGHT);
  return scale > 0 ? scale : 1;
}

/**
 * The four parsed fields of a `position`/`size` value. `rel` fields are scale
 * fractions (1 = 100% of the parent); `abs` fields are pixel offsets. Each is a
 * finite number — a non-numeric (token / malformed) field parses to `0`.
 */
export type UDim2 = {
  relX: number;
  relY: number;
  absX: number;
  absY: number;
};

/**
 * Parse one field of a `relX,relY,absX,absY` string into a finite number.
 *
 * Returns `0` for anything that is not a finite number — empty, whitespace, a
 * `{token}` binding, or garbage. This is the F2 "literal only, tokens fall back"
 * rule: geometry degrades gracefully rather than throwing, because the raw
 * authored text is surfaced to the user by other means (F3 resolves it).
 */
function parseField(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a `relX,relY,absX,absY` string into a {@link UDim2}.
 *
 * Robust to the literal-only F2 contract: missing fields and non-numeric
 * (token) fields become `0`. Extra fields beyond the first four are ignored;
 * fewer than four fields leaves the rest at `0`. Never throws — a malformed
 * value lays out at the origin rather than breaking the whole preview.
 *
 * @param value the raw attribute string, or `undefined` if the attribute is
 *   absent (caller supplies the appropriate default first).
 */
export function parseUDim2(value: string | undefined): UDim2 {
  const parts = (value ?? "").split(",");
  return {
    relX: parseField(parts[0]),
    relY: parseField(parts[1]),
    absX: parseField(parts[2]),
    absY: parseField(parts[3]),
  };
}

/**
 * Build a single CSS `calc()` axis expression from a scale fraction and a pixel
 * offset: `rel` → percentage, `abs` → pixels.
 *
 * - `calc(50% + 5px)` for `rel=0.5, abs=5`.
 * - Negative and >100% values are emitted verbatim — `calc(100% + -300px)` for
 *   a right-anchored `1,0,-300,0` panel. No clamping (the runtime doesn't
 *   clamp; overflow is honored, per the design).
 * - A pure-pixel axis (`rel=0`) still emits `calc(0% + 5px)` rather than a bare
 *   `5px`, so every box is described by one uniform expression shape — simpler
 *   to reason about and to diff, and the `0%` term is free at paint time.
 */
export function calcAxis(rel: number, abs: number): string {
  return `calc(${rel * 100}% + ${abs}px)`;
}

/** The CSS box geometry for one rendered preview box. */
export type BoxGeometry = {
  position: "absolute";
  left: string;
  top: string;
  width: string;
  height: string;
};

/**
 * Compute the absolute-position CSS geometry for a box from its raw `position`
 * and `size` attribute strings (or `undefined` when absent — the documented
 * defaults `0,0,0,0` / `1,1,0,0` apply).
 *
 * The returned box is `position: absolute`; the caller renders it inside a
 * `position: relative` parent so the percentages resolve against the parent's
 * content box ("scale is a fraction of the parent"). This is the only geometry
 * any preview box needs — there is no separate flow/auto path.
 */
export function computeBoxGeometry(
  positionAttr: string | undefined,
  sizeAttr: string | undefined,
): BoxGeometry {
  const pos = parseUDim2(positionAttr ?? DEFAULT_POSITION);
  const size = parseUDim2(sizeAttr ?? DEFAULT_SIZE);
  return {
    position: "absolute",
    left: calcAxis(pos.relX, pos.absX),
    top: calcAxis(pos.relY, pos.absY),
    width: calcAxis(size.relX, size.absX),
    height: calcAxis(size.relY, size.absY),
  };
}

// ---------------------------------------------------------------------------
// Drag-to-move (F7): pixel delta → offset writeback
// ---------------------------------------------------------------------------

/**
 * Apply an on-screen pixel drag delta to a `position` value, writing the delta
 * into the OFFSET half (`absX`/`absY`) ONLY and returning the new serialized
 * `relX,relY,absX,absY` string. This is the pure core of F7 drag-to-move: the
 * preview computes the cursor delta in stage pixels and hands it here; the result
 * is written back through the store's `setNodeAttrs` action.
 *
 * Invariants (the design's "drag moves offset, never scale"):
 *  - The SCALE fields (`relX`, `relY`) are passed through VERBATIM — a literal
 *    `0.5` or a `{healthRatio}` token survives a drag untouched. A drag never
 *    converts, clamps, or otherwise mutates the scale half.
 *  - The OFFSET fields accumulate the delta: `absX' = round(absX + dx)`, `absY' =
 *    round(absY + dy)`. Existing literal offsets are added onto, so repeated/
 *    continuous drags accumulate correctly. The result is ROUNDED to a whole pixel:
 *    the offset half is a pixel coordinate, and after F7's scale-to-fit divides the
 *    screen delta by the render scale the logical delta is fractional, so without
 *    rounding a drag would write sub-pixel offsets. Rounding HERE (in the pure math,
 *    invoked on every pointermove) snaps the box to whole pixels LIVE as the user
 *    drags and keeps the Properties offset fields integral throughout. Only the
 *    offset half is rounded; the scale half stays verbatim (it may be a float).
 *  - A BOUND offset field (`absX`/`absY` is a whole `{token}`) has no numeric value
 *    to accumulate against, so its base is treated as `0` and the field is REPLACED
 *    by the resulting literal pixel value. Rationale: a drag is a direct,
 *    literal-pixel gesture — the user physically placed the box, so the offset
 *    becomes that literal. The scale half (where most bindings live for responsive
 *    layout) is the part a drag promises never to disturb; an offset binding is the
 *    rarer case and "you dragged it, you set it" is the least-surprising rule. A
 *    bound SCALE field is never affected (scale is verbatim).
 *  - Malformed / empty offset fields parse to `0` (the same F2 fallback as
 *    {@link parseUDim2}), so a half-authored value still drags from origin.
 *
 * The pixel delta is already in STAGE pixels — the caller divides the raw screen
 * delta by the preview zoom factor first (the preview is fixed 100%, so today that
 * divisor is 1, but keeping it the caller's job means a future zoom needs no change
 * here). No trig, no layout solver: a stage-pixel delta maps 1:1 to offset pixels.
 *
 * @param positionAttr the raw `position` string, or `undefined` when absent (the
 *   default `0,0,0,0` applies, so a drag from a never-positioned box still works).
 * @param dx stage-pixel delta to add to the x offset (`absX`).
 * @param dy stage-pixel delta to add to the y offset (`absY`).
 */
export function applyDragDelta(positionAttr: string | undefined, dx: number, dy: number): string {
  const parts = (positionAttr ?? DEFAULT_POSITION).split(",");
  // Scale fields verbatim — preserve exactly what was authored (literal or token),
  // defaulting a missing field to "0" so the result always has four segments.
  const relX = (parts[0] ?? "").trim() || "0";
  const relY = (parts[1] ?? "").trim() || "0";
  // Offset fields: parse the current literal (a token/garbage base parses to 0),
  // add the delta, and emit the literal pixel result. parseField is reused so the
  // drag and the renderer agree on what "the current offset" is. Math.round snaps
  // the result to a whole pixel — the 468 scale divisor makes the logical delta
  // fractional, and a pixel offset must stay integral (and read as an integer in the
  // Properties panel as the box moves).
  const absX = Math.round(parseField(parts[2]) + dx);
  const absY = Math.round(parseField(parts[3]) + dy);
  return `${relX},${relY},${absX},${absY}`;
}

/**
 * The screen-pixel move (per axis) past which a grab-release is a DRAG, not a click.
 * Below it the gesture is treated as a click (select/deselect runs normally); at or
 * above it the trailing synthesized `click` is suppressed so a drag-release keeps the
 * dragged box selected instead of clearing the selection on the background.
 */
export const DRAG_CLICK_THRESHOLD_PX = 3;

/**
 * Whether a grab-and-release gesture moved far enough to count as a DRAG rather than
 * a click (469). Compares the absolute per-axis SCREEN-pixel travel from pointerdown
 * to pointerup against {@link DRAG_CLICK_THRESHOLD_PX}: a move exceeding the threshold
 * on EITHER axis is a drag.
 *
 * Why this matters: the browser synthesizes a `click` after the pointerup that ends a
 * drag. If that click ran selection it would re-resolve the target — and because the
 * cursor commonly drifts off the box onto the stage background during a drag, the
 * click would land on the background and CLEAR the selection, so the box you just
 * moved would stop showing in the Properties panel. Treating a past-threshold gesture
 * as a drag lets the caller suppress that one click and keep the box selected. A
 * genuine (near-zero) click on the background still falls through and clears as before.
 *
 * Uses SCREEN pixels (not logical) on purpose: the threshold is about the user's
 * physical intent (did they mean to move it?), which is independent of the stage's
 * render scale. The comparison is strict `>` so a move of exactly the threshold is
 * still a click — the drag must clearly exceed it.
 */
export function isDragGesture(startX: number, startY: number, endX: number, endY: number): boolean {
  return (
    Math.abs(endX - startX) > DRAG_CLICK_THRESHOLD_PX ||
    Math.abs(endY - startY) > DRAG_CLICK_THRESHOLD_PX
  );
}

/**
 * Convert an on-screen pixel delta into a LOGICAL (1280×768-space) pixel delta by
 * dividing out the stage's render scale. When the stage is drawn with
 * `transform: scale(s)`, a cursor move of `dxScreen` screen px corresponds to
 * `dxScreen / s` px in logical space — which is the space `applyDragDelta` writes
 * the offset in. This is the one piece the F7 drag needs to stay accurate when the
 * preview is scaled (fit-to-fit); the preview owns it because the preview owns the
 * scale.
 *
 * `scale` is clamped > 0 by {@link computeFitScale}, but as defense-in-depth a
 * non-positive/non-finite scale falls back to a 1:1 mapping (return the screen
 * delta unchanged) rather than dividing by zero / NaN.
 */
export function screenDeltaToLogical(
  dxScreen: number,
  dyScreen: number,
  scale: number,
): { dx: number; dy: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { dx: dxScreen / s, dy: dyScreen / s };
}

// ---------------------------------------------------------------------------
// View transform (473): zoom + pan over the fit-to-fit base
// ---------------------------------------------------------------------------

/**
 * The preview's view transform: an absolute render `scale` plus a screen-pixel
 * pan offset (`panX`/`panY`). The stage is drawn with
 * `translate(panX, panY) scale(scale)` (transform-origin top-left) on the ROOT
 * stage element only (the one intentional stacking context — F5a). The viewport
 * clips; children stay in 1280×768 logical space.
 *
 * `scale` is an ABSOLUTE factor (not relative to the fit scale): 1 = native
 * 100%, the fit scale = letterboxed-to-fit. Pan is in viewport (screen) pixels,
 * measured from the viewport's top-left corner to the stage's top-left corner.
 */
export type ViewTransform = {
  scale: number;
  panX: number;
  panY: number;
};

/**
 * The zoom clamp bounds. Below {@link MIN_SCALE} the stage is an unusable speck;
 * above {@link MAX_SCALE} a single logical pixel is a huge block and panning gets
 * unwieldy. Both ends are generous — the fit scale (often ~0.3–1) sits comfortably
 * inside, and a user can zoom well past 100% to inspect pixel detail or far out to
 * see an overflowing layout whole.
 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/**
 * Clamp a raw scale into [{@link MIN_SCALE}, {@link MAX_SCALE}]. `NaN` (from a bad
 * wheel event) falls back to {@link MIN_SCALE} rather than corrupting the view —
 * defense-in-depth, the callers never pass one. `±Infinity` clamps normally through
 * `Math.min`/`Math.max` (so `+Infinity` → MAX_SCALE, `-Infinity` → MIN_SCALE).
 */
export function clampScale(scale: number): number {
  if (Number.isNaN(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Compute the fit-and-center view transform for the fixed stage inside a
 * `containerW × containerH` viewport: the fit scale (largest uniform scale that
 * letterboxes the 1280×768 stage inside the viewport, via {@link computeFitScale})
 * plus the pan that CENTERS the scaled stage in the viewport.
 *
 *   scale = computeFitScale(W, H)
 *   panX  = (W - STAGE_WIDTH  * scale) / 2
 *   panY  = (H - STAGE_HEIGHT * scale) / 2
 *
 * This replaces the old flex-centering footprint wrapper: with pan baked into the
 * stage transform, the stage centers itself and the viewport simply clips. It is
 * the "Fit" state and the open-a-component default. A degenerate viewport yields
 * `computeFitScale`'s fallback of 1 and a pan computed against that.
 */
export function fitView(containerW: number, containerH: number): ViewTransform {
  const scale = computeFitScale(containerW, containerH);
  const w = Number.isFinite(containerW) ? containerW : 0;
  const h = Number.isFinite(containerH) ? containerH : 0;
  return {
    scale,
    panX: (w - STAGE_WIDTH * scale) / 2,
    panY: (h - STAGE_HEIGHT * scale) / 2,
  };
}

/**
 * Zoom the view toward a fixed point — the logical stage point currently under
 * the cursor stays pinned under the cursor as the scale changes. This is the
 * standard "zoom where you point" behavior for Ctrl/Cmd+wheel.
 *
 * The math (pure, the reason this lives here): the logical point under the cursor
 * is `L = (cursor - pan) / scale`. After the scale changes to `scale'`, we want
 * that same `L` to still map to the same `cursor`, so the new pan is
 * `pan' = cursor - L * scale'`. Worked per axis with the shared `L`.
 *
 * `nextScaleRaw` is the desired (pre-clamp) target scale; it is clamped to
 * [{@link MIN_SCALE}, {@link MAX_SCALE}] here. When the clamp pins the scale (the
 * user wheels past a bound), `L * scale'` uses the CLAMPED scale, so the pan stops
 * drifting too — the point stays put and the zoom simply doesn't go further.
 *
 * @param view the current view transform.
 * @param cursorX cursor x in VIEWPORT coordinates (relative to the viewport's
 *   top-left, the same frame `panX` is measured in).
 * @param cursorY cursor y in viewport coordinates.
 * @param nextScaleRaw the desired new absolute scale (before clamping).
 */
export function zoomTowardCursor(
  view: ViewTransform,
  cursorX: number,
  cursorY: number,
  nextScaleRaw: number,
): ViewTransform {
  const nextScale = clampScale(nextScaleRaw);
  // The logical point under the cursor, invariant across the zoom.
  const lx = (cursorX - view.panX) / view.scale;
  const ly = (cursorY - view.panY) / view.scale;
  return {
    scale: nextScale,
    panX: cursorX - lx * nextScale,
    panY: cursorY - ly * nextScale,
  };
}

/**
 * The multiplicative step one zoom increment applies — a wheel notch or a +/−
 * button press multiplies (or divides) the scale by this factor. A ~1.1× step is
 * fine-grained enough to feel smooth on a mouse wheel yet reaches the clamp bounds
 * in a handful of notches.
 */
export const ZOOM_STEP = 1.1;

/**
 * Translate a wheel `deltaY` into a target scale, zooming IN on a negative delta
 * (wheel up / scroll toward the screen) and OUT on a positive delta, matching the
 * platform convention. The magnitude of `deltaY` is ignored beyond its sign — one
 * notch is one {@link ZOOM_STEP} — so a high-resolution trackpad and a notched
 * mouse wheel both step predictably. The result is the PRE-CLAMP target scale to
 * hand to {@link zoomTowardCursor} (which clamps).
 */
export function scaleForWheel(currentScale: number, deltaY: number): number {
  return deltaY < 0 ? currentScale * ZOOM_STEP : currentScale / ZOOM_STEP;
}

/**
 * Pan the view by a screen-pixel delta — a pure translate, so it never touches
 * `scale`. Used by the space-drag / middle-mouse pan gesture: each pointer move
 * adds the cursor's screen delta to the pan. Because pan is a pure translate, it
 * does NOT affect the screen→logical delta conversion element drag uses
 * ({@link screenDeltaToLogical} divides by scale only), so element drag stays
 * accurate when zoomed AND panned.
 */
export function panBy(view: ViewTransform, dxScreen: number, dyScreen: number): ViewTransform {
  return { scale: view.scale, panX: view.panX + dxScreen, panY: view.panY + dyScreen };
}

// ---------------------------------------------------------------------------
// Texture rendering (F: sprite-as-background): which sprite name to load
// ---------------------------------------------------------------------------

/**
 * Decide the sprite NAME a box should load for its `texture` background, or
 * `null` for "load nothing" (render no background image, no broken-image icon).
 *
 * The input is the box's RESOLVED `texture` value (tokens already interpolated by
 * F3's {@link resolveAttrs}) plus whether that attribute fully resolved. A texture
 * is loaded ONLY when:
 *   - it is present and non-empty (after trimming), AND
 *   - it fully resolved — an unresolved value still carries a literal `{token}`,
 *     which is not a real filename, so we paint nothing and let the box's
 *     waiting-for-binding affordance signal the dangling binding instead.
 *
 * The returned name is fed verbatim to the existing `get_sprite` pipeline, which
 * resolves it through the asset manifest (abilities/items/charms store the full
 * filename WITH extension, e.g. `ability_bite.png`, and `resolve_asset` also falls
 * back to `<name>.png`, so a bare stem resolves too).
 *
 * @param texture the resolved `attrs.texture` value, or `undefined` when absent.
 * @param resolved whether the `texture` attribute fully resolved (no dangling
 *   `{token}`). Pass `false` when the renderer's `unresolved` set contains
 *   `texture`.
 */
export function textureToLoad(texture: string | undefined, resolved: boolean): string | null {
  if (texture === undefined) return null;
  if (!resolved) return null;
  const trimmed = texture.trim();
  return trimmed === "" ? null : trimmed;
}
