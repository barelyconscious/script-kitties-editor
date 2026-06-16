import { describe, expect, it } from "vitest";
import type { Palette } from "./guiBinding";
import {
  DEFAULT_PALETTE_CODE,
  firstPaletteError,
  hexToRgb,
  normalizeCode,
  type PaletteRow,
  paletteToRows,
  parseRgba,
  rgbaToCode,
  rgbaToHex,
  rowsToPalette,
} from "./guiPaletteEdit";

describe("paletteToRows / rowsToPalette round-trip", () => {
  it("preserves key order from map to rows", () => {
    const palette: Palette = {
      Zebra: "1,1,1,255",
      Apple: "2,2,2,255",
      Mango: "3,3,3,255",
    };
    const rows = paletteToRows(palette);
    expect(rows.map((r) => r.name)).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("emits keys in ROW order on save, not alphabetical", () => {
    const rows: PaletteRow[] = [
      { name: "Zebra", code: "1,1,1,255" },
      { name: "Apple", code: "2,2,2,255" },
      { name: "Mango", code: "3,3,3,255" },
    ];
    const palette = rowsToPalette(rows);
    expect(Object.keys(palette)).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("round-trips an untouched palette to identical keys+codes", () => {
    const palette: Palette = {
      TextDefault: "185,178,165,255",
      PanelBg: "0,0,0,200",
    };
    expect(rowsToPalette(paletteToRows(palette))).toEqual(palette);
  });

  it("trims names and normalizes codes on save", () => {
    const rows: PaletteRow[] = [{ name: "  Spaced  ", code: " 1, 2, 3 " }];
    const palette = rowsToPalette(rows);
    expect(palette).toEqual({ Spaced: "1,2,3,255" });
  });
});

describe("firstPaletteError", () => {
  it("returns null for a clean palette", () => {
    const rows: PaletteRow[] = [
      { name: "A", code: "1,1,1,255" },
      { name: "B", code: "2,2,2,255" },
    ];
    expect(firstPaletteError(rows)).toBeNull();
  });

  it("flags an empty name (including whitespace-only)", () => {
    expect(firstPaletteError([{ name: "", code: "1,1,1,255" }])).toMatch(/empty/i);
    expect(firstPaletteError([{ name: "   ", code: "1,1,1,255" }])).toMatch(/empty/i);
  });

  it("flags a duplicate name", () => {
    const rows: PaletteRow[] = [
      { name: "Dup", code: "1,1,1,255" },
      { name: "Dup", code: "2,2,2,255" },
    ];
    expect(firstPaletteError(rows)).toMatch(/listed twice/i);
  });

  it("treats names differing only by surrounding whitespace as duplicates", () => {
    const rows: PaletteRow[] = [
      { name: "Dup", code: "1,1,1,255" },
      { name: "  Dup  ", code: "2,2,2,255" },
    ];
    expect(firstPaletteError(rows)).toMatch(/listed twice/i);
  });
});

describe("parseRgba / rgbaToCode swatch↔code sync", () => {
  it("parses a four-channel code", () => {
    expect(parseRgba("185,178,165,200")).toEqual({ r: 185, g: 178, b: 165, a: 200 });
  });

  it("defaults missing alpha to opaque", () => {
    expect(parseRgba("10,20,30")).toEqual({ r: 10, g: 20, b: 30, a: 255 });
  });

  it("clamps out-of-range channels and rounds floats", () => {
    expect(parseRgba("-5,300,127.6,255")).toEqual({ r: 0, g: 255, b: 128, a: 255 });
  });

  it("falls back to opaque black on garbage", () => {
    expect(parseRgba("not,a,color")).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it("round-trips a code through parse → serialize", () => {
    expect(rgbaToCode(parseRgba("185,178,165,200"))).toBe("185,178,165,200");
  });

  it("normalizeCode fills in a missing alpha", () => {
    expect(normalizeCode("10,20,30")).toBe("10,20,30,255");
  });
});

describe("hex <-> rgb for the color input", () => {
  it("converts rgba to a #rrggbb hex (alpha dropped)", () => {
    expect(rgbaToHex({ r: 255, g: 0, b: 16, a: 128 })).toBe("#ff0010");
  });

  it("parses a #rrggbb hex back to channels", () => {
    expect(hexToRgb("#ff0010")).toEqual({ r: 255, g: 0, b: 16 });
  });

  it("tolerates a missing leading hash", () => {
    expect(hexToRgb("00ff00")).toEqual({ r: 0, g: 255, b: 0 });
  });
});

describe("DEFAULT_PALETTE_CODE", () => {
  it("is a valid normalized code", () => {
    expect(normalizeCode(DEFAULT_PALETTE_CODE)).toBe(DEFAULT_PALETTE_CODE);
  });
});
