/**
 * guiPaletteEdit — pure editing logic for the Registry's GUI color palette.
 *
 * The palette persists as a flat, ORDER-PRESERVING `name → "r,g,b,a"` map in game
 * data (`Data/gui_palette.json`, via `get_palette`/`save_palette`). For editing we
 * lift that map into an ordered array of {@link PaletteRow} so that rows survive
 * transient empty/duplicate names while the user types (the map can't hold those),
 * and so key ORDER is the row order the user sees — converting back on save emits
 * keys in row order, which the IndexMap-backed backend writes verbatim (minimal
 * diffs).
 *
 * This module is PURE (no React, no Tauri): the Registry component owns the draft
 * state and Save flow; everything testable about parsing, validation, and the
 * swatch↔code sync lives here so it can be unit-tested in isolation.
 */

import type { Palette } from "./guiBinding";

/** One editable palette entry. `name` is the palette key; `code` is `r,g,b,a`. */
export type PaletteRow = { name: string; code: string };

/** An RGBA tuple, each channel 0–255. */
export type Rgba = { r: number; g: number; b: number; a: number };

/** The code a freshly-added row starts with — opaque mid-grey, a sensible blank. */
export const DEFAULT_PALETTE_CODE = "128,128,128,255";

/** Clamp a number into the 0–255 channel range and round to a whole value. */
function clampChannel(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Lift the persisted `name → code` map into ordered editable rows. Object key
 * order is the persisted order (palette keys are identifiers, never integer-like,
 * so JS preserves their insertion order), so the rows come out in file order.
 */
export function paletteToRows(palette: Palette): PaletteRow[] {
  return Object.entries(palette).map(([name, code]) => ({ name, code }));
}

/**
 * Collapse ordered rows back into the persisted map, in row order. Names are
 * trimmed; codes are normalized. Assumes {@link firstPaletteError} already passed
 * (no empty or duplicate names) — on a later duplicate it would silently overwrite,
 * which is why Save must validate first. The resulting object's key order is the
 * row order, so the backend writes a minimal diff.
 */
export function rowsToPalette(rows: PaletteRow[]): Palette {
  const palette: Palette = {};
  for (const row of rows) {
    palette[row.name.trim()] = normalizeCode(row.code);
  }
  return palette;
}

/**
 * The first blocking validation error across all rows, or `null` if clean.
 * Mirrors the enum sections' rule: no empty names, no duplicate names (the name is
 * the resolution key the game looks colors up by, so it must be unique). Codes are
 * NOT blocked — a malformed code renders as a transparent swatch but is still
 * storable, consistent with the renderer treating unparseable codes leniently.
 */
export function firstPaletteError(rows: PaletteRow[]): string | null {
  const names = rows.map((r) => r.name.trim());
  if (names.some((n) => n.length === 0)) return "A color name is empty.";
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) return `"${dupe}" is listed twice.`;
  return null;
}

/**
 * Parse an `r,g,b,a` (or `r,g,b`) code into an {@link Rgba}. Missing alpha defaults
 * to opaque (255); each channel is clamped to 0–255. A malformed/empty code falls
 * back to opaque black so the picker always has a valid starting value.
 */
export function parseRgba(code: string): Rgba {
  const parts = code.split(",").map((p) => Number(p.trim()));
  const [r, g, b, a] = parts;
  return {
    r: clampChannel(r),
    g: clampChannel(g),
    b: clampChannel(b),
    a: a === undefined || Number.isNaN(a) ? 255 : clampChannel(a),
  };
}

/** Serialize an {@link Rgba} back to a canonical `r,g,b,a` code string. */
export function rgbaToCode(rgba: Rgba): string {
  return `${clampChannel(rgba.r)},${clampChannel(rgba.g)},${clampChannel(rgba.b)},${clampChannel(rgba.a)}`;
}

/**
 * Canonicalize a code string by round-tripping it through {@link parseRgba}, so a
 * `r,g,b` (no alpha) or whitespace-padded code is stored as a clean four-channel
 * `r,g,b,a`. Keeps the swatch and the code field in sync and the file tidy.
 */
export function normalizeCode(code: string): string {
  return rgbaToCode(parseRgba(code));
}

/** A `#rrggbb` hex string (alpha dropped) for an `<input type="color">` value. */
export function rgbaToHex({ r, g, b }: Rgba): string {
  const h = (n: number) => clampChannel(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Parse a `#rrggbb` hex string into r/g/b channels (alpha is carried separately). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const int = Number.parseInt(m[1], 16);
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}
