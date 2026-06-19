import { describe, expect, it } from "vitest";
import { computeBoxGeometry } from "./guiGeometry";
import {
  cellGeometry,
  type GridDimension,
  parseGridDimension,
  parseGutter,
} from "./guiGridGeometry";

describe("cellGeometry", () => {
  it("a 1×1 grid: the single cell fills the parent (0,0,0,0 / 1,1,0,0)", () => {
    expect(cellGeometry(0, 1, 1)).toEqual({ position: "0,0,0,0", size: "1,1,0,0" });
  });

  it("a 1×N row (no gutter): cells split width evenly, full height, no offset", () => {
    // 4 columns, 1 row → each cell 25% wide, 100% tall.
    expect(cellGeometry(0, 1, 4)).toEqual({ position: "0,0,0,0", size: "0.25,1,0,0" });
    expect(cellGeometry(1, 1, 4)).toEqual({ position: "0.25,0,0,0", size: "0.25,1,0,0" });
    expect(cellGeometry(2, 1, 4)).toEqual({ position: "0.5,0,0,0", size: "0.25,1,0,0" });
    expect(cellGeometry(3, 1, 4)).toEqual({ position: "0.75,0,0,0", size: "0.25,1,0,0" });
  });

  it("an N×1 column (no gutter): cells split height evenly, full width, no offset", () => {
    // 1 column, 3 rows → each cell 100% wide, 33.3% tall, stacked vertically.
    expect(cellGeometry(0, 3, 1)).toEqual({ position: "0,0,0,0", size: `1,${1 / 3},0,0` });
    expect(cellGeometry(1, 3, 1)).toEqual({ position: `0,${1 / 3},0,0`, size: `1,${1 / 3},0,0` });
    expect(cellGeometry(2, 3, 1)).toEqual({ position: `0,${2 / 3},0,0`, size: `1,${1 / 3},0,0` });
  });

  it("an N×M grid (no gutter): index maps row-major (left-to-right, top-to-bottom)", () => {
    // 2 rows × 3 columns. index 4 → row 1, col 1 (the middle-bottom cell).
    //   col = 4 % 3 = 1 → relX 1/3 ; row = floor(4/3) = 1 → relY 1/2
    expect(cellGeometry(4, 2, 3)).toEqual({
      position: `${1 / 3},0.5,0,0`,
      size: `${1 / 3},0.5,0,0`,
    });
    // index 0 = top-left, index 5 = bottom-right.
    expect(cellGeometry(0, 2, 3)).toEqual({ position: "0,0,0,0", size: `${1 / 3},0.5,0,0` });
    expect(cellGeometry(5, 2, 3)).toEqual({
      position: `${2 / 3},0.5,0,0`,
      size: `${1 / 3},0.5,0,0`,
    });
  });

  it("gutter sits BETWEEN cells only (N-1 gutters across N) — horizontal", () => {
    // 2 columns, 1 row, 10px horizontal gutter. Each cell: relX 0.5, absX -5 (sheds
    // half of the single 10px gutter). cell0 starts at 0; cell1 at 50%+5.
    const c0 = cellGeometry(0, 1, 2, 10, 0);
    const c1 = cellGeometry(1, 1, 2, 10, 0);
    expect(c0).toEqual({ position: "0,0,0,0", size: "0.5,1,-5,0" });
    expect(c1).toEqual({ position: "0.5,0,5,0", size: "0.5,1,-5,0" });
    // The gap between cell0's right edge (50%-5) and cell1's left edge (50%+5) is 10px;
    // neither edge cell has an outer margin (cell0 starts at 0, cell1 ends at 100%).
  });

  it("gutter sits BETWEEN cells only (N-1 gutters across N) — vertical", () => {
    // 3 rows, 1 column, 6px vertical gutter. Each cell loses (3-1)/3*6 = 4px of height.
    const c0 = cellGeometry(0, 3, 1, 0, 6);
    const c1 = cellGeometry(1, 3, 1, 0, 6);
    const c2 = cellGeometry(2, 3, 1, 0, 6);
    expect(c0).toEqual({ position: "0,0,0,0", size: `1,${1 / 3},0,-4` });
    expect(c1).toEqual({ position: `0,${1 / 3},0,2`, size: `1,${1 / 3},0,-4` });
    expect(c2).toEqual({ position: `0,${2 / 3},0,4`, size: `1,${1 / 3},0,-4` });
    // Gaps: cell0 ends at 33.3%-4, cell1 starts at 33.3%+2 → 6px gap. cell1 ends at
    // 66.6%-2, cell2 starts at 66.6%+4 → 6px gap. Two gutters across three cells.
  });

  it("gutter applies independently per axis in an N×M grid", () => {
    // 2×2 with gutter 8,4. index 3 = row 1, col 1.
    //   x: col 1 → relX 0.5, posAbsX = 1*8/2 = 4 ; sizeAbsX = -(1/2)*8 = -4
    //   y: row 1 → relY 0.5, posAbsY = 1*4/2 = 2 ; sizeAbsY = -(1/2)*4 = -2
    expect(cellGeometry(3, 2, 2, 8, 4)).toEqual({
      position: "0.5,0.5,4,2",
      size: "0.5,0.5,-4,-2",
    });
  });

  it("produces strings computeBoxGeometry consumes unchanged", () => {
    // The whole point: a cell's geometry feeds the existing parser with no special case.
    const { position, size } = cellGeometry(1, 1, 2, 10, 0);
    expect(computeBoxGeometry(position, size)).toEqual({
      position: "absolute",
      left: "calc(50% + 5px)",
      top: "calc(0% + 0px)",
      width: "calc(50% + -5px)",
      height: "calc(100% + 0px)",
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
