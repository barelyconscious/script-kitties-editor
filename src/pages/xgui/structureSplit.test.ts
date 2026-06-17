import { describe, expect, it } from "vitest";
import {
  clampTreeFraction,
  DEFAULT_TREE_FRACTION,
  fractionForPointer,
  MIN_PROPS_PX,
  MIN_TREE_PX,
} from "./structureSplit";

describe("clampTreeFraction", () => {
  it("passes through a fraction that satisfies both minimums", () => {
    // 1000px container: min tree = 0.12, max = 0.88; 0.5 is inside.
    expect(clampTreeFraction(0.5, 1000)).toBe(0.5);
  });

  it("clamps up to the tree minimum when the tree would be too short", () => {
    // 1000px, MIN_TREE_PX=120 → minFraction 0.12. A request below it snaps up.
    expect(clampTreeFraction(0.05, 1000)).toBeCloseTo(MIN_TREE_PX / 1000, 10);
  });

  it("clamps down to keep the properties minimum when the tree would be too tall", () => {
    // 1000px, MIN_PROPS_PX=120 → maxFraction 0.88. A request above it snaps down.
    expect(clampTreeFraction(0.99, 1000)).toBeCloseTo(1 - MIN_PROPS_PX / 1000, 10);
  });

  it("leaves both slices at least their minimum pixel height after clamping", () => {
    const containerPx = 500;
    const treePx = clampTreeFraction(0.95, containerPx) * containerPx;
    expect(treePx).toBeGreaterThanOrEqual(MIN_TREE_PX - 1e-6);
    expect(containerPx - treePx).toBeGreaterThanOrEqual(MIN_PROPS_PX - 1e-6);
  });

  it("centers the divider when the container is too short for both minimums", () => {
    // 200px < 120 + 120: no valid window → centered.
    expect(clampTreeFraction(0.3, 200)).toBe(0.5);
  });

  it("falls back to the default for non-finite or non-positive inputs", () => {
    expect(clampTreeFraction(Number.NaN, 1000)).toBe(DEFAULT_TREE_FRACTION);
    expect(clampTreeFraction(0.5, 0)).toBe(DEFAULT_TREE_FRACTION);
    expect(clampTreeFraction(0.5, -10)).toBe(DEFAULT_TREE_FRACTION);
  });
});

describe("fractionForPointer", () => {
  it("maps a pointer offset to the tree fraction it implies", () => {
    // Cursor 600px down a 1000px region → tree wants 0.6 (within bounds).
    expect(fractionForPointer(600, 1000)).toBeCloseTo(0.6, 10);
  });

  it("clamps a pointer near the top so the tree keeps its minimum", () => {
    expect(fractionForPointer(10, 1000)).toBeCloseTo(MIN_TREE_PX / 1000, 10);
  });

  it("clamps a pointer near the bottom so the properties keep their minimum", () => {
    expect(fractionForPointer(990, 1000)).toBeCloseTo(1 - MIN_PROPS_PX / 1000, 10);
  });

  it("returns the default for a degenerate container height", () => {
    expect(fractionForPointer(100, 0)).toBe(DEFAULT_TREE_FRACTION);
  });
});
