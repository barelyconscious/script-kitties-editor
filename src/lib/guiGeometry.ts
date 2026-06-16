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
