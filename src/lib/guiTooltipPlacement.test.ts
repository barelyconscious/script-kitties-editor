import { describe, expect, it } from "vitest";
import {
  pickHoverTarget,
  pickTopmostRect,
  rectContainsPoint,
  screenRectToStageRect,
} from "./guiTooltipPlacement";

// A screen rect helper: build the {left,top,right,bottom,width,height} DOMRect subset.
function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe("screenRectToStageRect", () => {
  it("undoes the stage origin and scale (identity view)", () => {
    const stageOrigin = { left: 0, top: 0 };
    expect(screenRectToStageRect(rect(100, 200, 64, 64), stageOrigin, 1)).toEqual({
      x: 100,
      y: 200,
      width: 64,
      height: 64,
    });
  });

  it("subtracts the stage's screen origin (pan baked into the origin)", () => {
    // Stage rendered offset by (50, 30) on screen; scale 1.
    const stageOrigin = { left: 50, top: 30 };
    expect(screenRectToStageRect(rect(150, 130, 64, 64), stageOrigin, 1)).toEqual({
      x: 100,
      y: 100,
      width: 64,
      height: 64,
    });
  });

  it("divides out the render scale", () => {
    // Stage origin at screen (50, 30), zoomed 2×: a logical (100,100,64,64) box paints
    // at screen (50 + 200, 30 + 200) = (250, 230), size 128×128.
    const stageOrigin = { left: 50, top: 30 };
    expect(screenRectToStageRect(rect(250, 230, 128, 128), stageOrigin, 2)).toEqual({
      x: 100,
      y: 100,
      width: 64,
      height: 64,
    });
  });

  it("falls back to a 1:1 mapping for a degenerate scale", () => {
    const stageOrigin = { left: 0, top: 0 };
    expect(screenRectToStageRect(rect(10, 10, 5, 5), stageOrigin, 0)).toEqual({
      x: 10,
      y: 10,
      width: 5,
      height: 5,
    });
  });
});

describe("rectContainsPoint", () => {
  it("is inclusive of the edges", () => {
    const r = rect(10, 10, 20, 20); // [10..30] × [10..30]
    expect(rectContainsPoint(r, 10, 10)).toBe(true);
    expect(rectContainsPoint(r, 30, 30)).toBe(true);
    expect(rectContainsPoint(r, 20, 20)).toBe(true);
  });

  it("rejects points outside", () => {
    const r = rect(10, 10, 20, 20);
    expect(rectContainsPoint(r, 9, 20)).toBe(false);
    expect(rectContainsPoint(r, 20, 31)).toBe(false);
  });
});

describe("pickTopmostRect", () => {
  it("returns null when no rect contains the point", () => {
    const entries = [{ rect: rect(0, 0, 10, 10), key: "a" }];
    expect(pickTopmostRect(entries, 50, 50)).toBeNull();
  });

  it("returns the single containing rect", () => {
    const entries = [
      { rect: rect(0, 0, 10, 10), key: "a" },
      { rect: rect(100, 100, 10, 10), key: "b" },
    ];
    expect(pickTopmostRect(entries, 105, 105)?.key).toBe("b");
  });

  it("returns the LAST match when rects overlap (topmost ≈ latest registration)", () => {
    const entries = [
      { rect: rect(0, 0, 100, 100), key: "under" },
      { rect: rect(10, 10, 50, 50), key: "over" },
    ];
    // Point inside both → the later-registered "over" wins.
    expect(pickTopmostRect(entries, 20, 20)?.key).toBe("over");
  });

  it("falls through to an earlier rect when the later one does not contain the point", () => {
    const entries = [
      { rect: rect(0, 0, 100, 100), key: "under" },
      { rect: rect(80, 80, 50, 50), key: "over" },
    ];
    // Point in "under" only (outside "over").
    expect(pickTopmostRect(entries, 20, 20)?.key).toBe("under");
  });
});

describe("pickHoverTarget (Alt-gated peek — task 519)", () => {
  const entries = [{ rect: rect(0, 0, 100, 100), key: "a" }];

  it("returns null when Alt is NOT held, even directly over a provider", () => {
    expect(pickHoverTarget(entries, { x: 20, y: 20 }, false)).toBeNull();
  });

  it("returns the topmost provider under the pointer when Alt IS held", () => {
    expect(pickHoverTarget(entries, { x: 20, y: 20 }, true)?.key).toBe("a");
  });

  it("returns null when Alt is held but the pointer is off every provider", () => {
    expect(pickHoverTarget(entries, { x: 500, y: 500 }, true)).toBeNull();
  });

  it("returns null when the pointer position is unknown (never entered the stage)", () => {
    expect(pickHoverTarget(entries, null, true)).toBeNull();
  });

  it("delegates topmost-wins to pickTopmostRect when Alt is held over overlapping providers", () => {
    const overlapping = [
      { rect: rect(0, 0, 100, 100), key: "under" },
      { rect: rect(10, 10, 50, 50), key: "over" },
    ];
    expect(pickHoverTarget(overlapping, { x: 20, y: 20 }, true)?.key).toBe("over");
  });
});
