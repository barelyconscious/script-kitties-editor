import { describe, expect, it } from "vitest";
import { computeBoxGeometry } from "./guiGeometry";
import {
  cellGeometryFixed,
  DEFAULT_CELL_SIZE,
  type GridDimension,
  parseGridDimension,
  parseGutter,
} from "./guiGridGeometry";

describe("DEFAULT_CELL_SIZE — engine default when no cellSize is authored", () => {
  it("is the full-parent UDim2 1,1,0,0 (engine ground truth; NOT area division)", () => {
    expect(DEFAULT_CELL_SIZE).toBe("1,1,0,0");
  });

  it("a 1×1 grid with the default: the single cell fills the parent (0,0,0,0 / 1,1,0,0)", () => {
    expect(cellGeometryFixed(0, 1, DEFAULT_CELL_SIZE)).toEqual({
      position: "0,0,0,0",
      size: "1,1,0,0",
    });
  });

  it("a multi-cell grid with the default: every cell is full-parent, stepping 100% per column/row", () => {
    // Each cell is 1,1,0,0 (full parent); positions step by 100% + gutter per axis, so
    // cells stack/overflow — the engine does NOT divide the parent among cells. 3 columns:
    // col = index % 3, row = floor(index / 3).
    expect(cellGeometryFixed(0, 3, DEFAULT_CELL_SIZE)).toEqual({
      position: "0,0,0,0",
      size: "1,1,0,0",
    });
    // index 1 → col 1 → posRelX = 1 (100% to the right), full size.
    expect(cellGeometryFixed(1, 3, DEFAULT_CELL_SIZE)).toEqual({
      position: "1,0,0,0",
      size: "1,1,0,0",
    });
    // index 4 → col 1, row 1 → posRelX = 1, posRelY = 1.
    expect(cellGeometryFixed(4, 3, DEFAULT_CELL_SIZE)).toEqual({
      position: "1,1,0,0",
      size: "1,1,0,0",
    });
  });

  it("the default with a gutter folds the gutter into position only", () => {
    // cellSize 1,1,0,0, gutter 10,10, 3 columns. col 1 → posAbsX = 1*(0+10) = 10.
    expect(cellGeometryFixed(1, 3, DEFAULT_CELL_SIZE, 10, 10)).toEqual({
      position: "1,0,10,0",
      size: "1,1,0,0",
    });
  });
});

describe("cellGeometryFixed", () => {
  it("fixed pixel cells: size is the cellSize UDim2 verbatim, positions grid-computed", () => {
    // cellSize 0,0,64,64 (fixed 64px), no gutter, 3 columns.
    const cell = "0,0,64,64";
    expect(cellGeometryFixed(0, 3, cell)).toEqual({ position: "0,0,0,0", size: "0,0,64,64" });
    expect(cellGeometryFixed(1, 3, cell)).toEqual({ position: "0,0,64,0", size: "0,0,64,64" });
    // index 4 = row 1, col 1 → posX abs = 1*64, posY abs = 1*64.
    expect(cellGeometryFixed(4, 3, cell)).toEqual({ position: "0,0,64,64", size: "0,0,64,64" });
  });

  it("folds the gutter into position (not size): index·(cell + gutter) per axis", () => {
    // cellSize 0,0,64,64, gutter 10,10, 3 columns. col 2 → posAbsX = 2*(64+10) = 148.
    expect(cellGeometryFixed(2, 3, "0,0,64,64", 10, 10)).toEqual({
      position: "0,0,148,0",
      size: "0,0,64,64",
    });
    // index 4 = row 1, col 1 → posAbsX = 1*74, posAbsY = 1*74. Size is gutter-free.
    expect(cellGeometryFixed(4, 3, "0,0,64,64", 10, 10)).toEqual({
      position: "0,0,74,74",
      size: "0,0,64,64",
    });
  });

  it("the acceptance worked example: cellSize 0,0,64,64 + gutter 5 → cell 1 at 0,0,69,0", () => {
    // cellSize 0,0,64,64, gutter 5 (x=5,y=0 via parseGutter), 3 columns. col 1 →
    // posAbsX = 1*(64+5) = 69, posAbsY = 0. Size is the UDim2 verbatim, gutter-free.
    expect(cellGeometryFixed(1, 3, "0,0,64,64", 5, 0)).toEqual({
      position: "0,0,69,0",
      size: "0,0,64,64",
    });
  });

  it("proportional cellSize: rel accumulates against the parent, abs from gutter only", () => {
    // cellSize 0.25,0.25,0,0 (quarter of parent), 3 columns. col 2 → posRelX = 2*0.25 = 0.5.
    expect(cellGeometryFixed(2, 3, "0.25,0.25,0,0")).toEqual({
      position: "0.5,0,0,0",
      size: "0.25,0.25,0,0",
    });
    // With a gutter, the abs offset is purely the gutter (rel cell contributes no abs).
    expect(cellGeometryFixed(1, 3, "0.25,0.25,0,0", 8, 8)).toEqual({
      position: "0.25,0,8,0",
      size: "0.25,0.25,0,0",
    });
  });

  it("mixed rel+abs cellSize accumulates both parts per axis", () => {
    // cellSize 0.1,0,20,40, gutter 5,0, 2 columns. col 1 → posRelX = 0.1, posAbsX = 20+5 = 25.
    expect(cellGeometryFixed(1, 2, "0.1,0,20,40", 5, 0)).toEqual({
      position: "0.1,0,25,0",
      size: "0.1,0,20,40",
    });
  });

  it("an unresolved/missing field falls back to 0 (parseUDim2 tolerance)", () => {
    // A field left as a {token} (never resolved — literal-only) or omitted parses to 0.
    expect(cellGeometryFixed(1, 2, "0,0,{w},64")).toEqual({
      position: "0,0,0,0",
      size: "0,0,0,64",
    });
    expect(cellGeometryFixed(1, 2, "0,0,64")).toEqual({ position: "0,0,64,0", size: "0,0,64,0" });
  });

  it("produces strings computeBoxGeometry consumes unchanged", () => {
    const { position, size } = cellGeometryFixed(1, 3, "0,0,64,64", 10, 10);
    expect(computeBoxGeometry(position, size)).toEqual({
      position: "absolute",
      left: "calc(0% + 74px)",
      top: "calc(0% + 0px)",
      width: "calc(0% + 64px)",
      height: "calc(0% + 64px)",
    });
  });
});

describe("parseGridDimension", () => {
  const count = (value: number): GridDimension => ({ kind: "count", value });

  it("defaults to 1 when absent", () => {
    expect(parseGridDimension(undefined)).toEqual(count(1));
  });

  it("defaults to 1 when blank or non-numeric", () => {
    expect(parseGridDimension("")).toEqual(count(1));
    expect(parseGridDimension("   ")).toEqual(count(1));
    expect(parseGridDimension("abc")).toEqual(count(1));
    // tokens are NOT supported on rows/columns — a literal-only parse, so {n} → default.
    expect(parseGridDimension("{n}")).toEqual(count(1));
  });

  it("parses a positive integer count", () => {
    expect(parseGridDimension("6")).toEqual(count(6));
    expect(parseGridDimension(" 3 ")).toEqual(count(3));
  });

  it("treats an explicit 0 as empty (warn + render nothing)", () => {
    expect(parseGridDimension("0")).toEqual({ kind: "empty" });
    expect(parseGridDimension(" 0 ")).toEqual({ kind: "empty" });
  });

  it("truncates a fractional positive toward its floor", () => {
    expect(parseGridDimension("2.9")).toEqual(count(2));
  });

  it("falls back to the default 1 for a negative count", () => {
    expect(parseGridDimension("-3")).toEqual(count(1));
  });
});

describe("parseGutter", () => {
  it("defaults both fields to 0 when absent", () => {
    expect(parseGutter(undefined)).toEqual({ x: 0, y: 0 });
  });

  it("parses an x,y pixel pair", () => {
    expect(parseGutter("5,8")).toEqual({ x: 5, y: 8 });
    expect(parseGutter(" 0 , 5 ")).toEqual({ x: 0, y: 5 });
  });

  it("defaults a missing/blank/garbage field to 0", () => {
    expect(parseGutter("5")).toEqual({ x: 5, y: 0 });
    expect(parseGutter(",7")).toEqual({ x: 0, y: 7 });
    expect(parseGutter("abc,3")).toEqual({ x: 0, y: 3 });
    expect(parseGutter("")).toEqual({ x: 0, y: 0 });
  });
});
