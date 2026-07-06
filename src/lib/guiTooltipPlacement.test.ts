import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOLTIP_SIZE,
  pickTopmostRect,
  placeTooltip,
  rectContainsPoint,
  type StageRect,
  screenRectToStageRect,
  TOOLTIP_GAP,
  tooltipSizeFromRoot,
} from "./guiTooltipPlacement";

const STAGE = { width: 1280, height: 768 };

// A screen rect helper: build the {left,top,right,bottom,width,height} DOMRect subset.
function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe("tooltipSizeFromRoot", () => {
  it("uses the absolute (absX/absY) fields of the root size", () => {
    expect(tooltipSizeFromRoot("0,0,200,120")).toEqual({ width: 200, height: 120 });
  });

  it("falls back to the default per axis when the absolute field is non-positive", () => {
    // Absent size → default both axes.
    expect(tooltipSizeFromRoot(undefined)).toEqual(DEFAULT_TOOLTIP_SIZE);
    // A relative-only root size (abs 0) → default both axes.
    expect(tooltipSizeFromRoot("1,1,0,0")).toEqual(DEFAULT_TOOLTIP_SIZE);
    // Mixed: absX present, absY zero → width kept, height defaulted.
    expect(tooltipSizeFromRoot("0,0,300,0")).toEqual({
      width: 300,
      height: DEFAULT_TOOLTIP_SIZE.height,
    });
  });

  it("ignores relative fields entirely (only abs matters)", () => {
    expect(tooltipSizeFromRoot("0.5,0.5,80,60")).toEqual({ width: 80, height: 60 });
  });
});

describe("placeTooltip", () => {
  const tooltip = { width: 160, height: 96 };

  it("anchors below the provider, left edges aligned, a gap under its bottom", () => {
    const anchor: StageRect = { x: 100, y: 100, width: 64, height: 64 };
    expect(placeTooltip(anchor, tooltip, STAGE)).toEqual({
      x: 100,
      y: 100 + 64 + TOOLTIP_GAP,
    });
  });

  it("flips above when the below placement overflows the stage bottom", () => {
    // Provider near the bottom: below would be 700+64+8=772 + 96 > 768 → flip above.
    const anchor: StageRect = { x: 100, y: 700, width: 64, height: 64 };
    const p = placeTooltip(anchor, tooltip, STAGE);
    // Above: bottom edge a gap over the provider top → y = 700 - 8 - 96.
    expect(p).toEqual({ x: 100, y: 700 - TOOLTIP_GAP - tooltip.height });
  });

  it("does NOT flip when the card fits below (boundary: exactly reaches the edge)", () => {
    // belowY + height == stage.height exactly → not an overflow (uses strict >).
    // Pick anchor so belowY = 768 - 96 = 672 → anchor.y + 64 + 8 = 672 → anchor.y = 600.
    const anchor: StageRect = { x: 0, y: 600, width: 64, height: 64 };
    const p = placeTooltip(anchor, tooltip, STAGE);
    expect(p.y).toBe(600 + 64 + TOOLTIP_GAP);
    expect(p.y + tooltip.height).toBe(STAGE.height);
  });

  it("clamps horizontally so the card stays within the stage right edge", () => {
    // Provider hard against the right edge: x would overflow → clamp to width - card.
    const anchor: StageRect = { x: 1260, y: 100, width: 20, height: 20 };
    const p = placeTooltip(anchor, tooltip, STAGE);
    expect(p.x).toBe(STAGE.width - tooltip.width); // 1120
  });

  it("clamps horizontally to 0 when the provider is off the left edge", () => {
    const anchor: StageRect = { x: -50, y: 100, width: 20, height: 20 };
    const p = placeTooltip(anchor, tooltip, STAGE);
    expect(p.x).toBe(0);
  });

  it("pins a card wider than the stage to the left edge", () => {
    const wide = { width: 2000, height: 40 };
    const anchor: StageRect = { x: 500, y: 100, width: 20, height: 20 };
    const p = placeTooltip(anchor, wide, STAGE);
    expect(p.x).toBe(0);
  });

  it("honors a custom gap", () => {
    const anchor: StageRect = { x: 10, y: 10, width: 30, height: 30 };
    expect(placeTooltip(anchor, tooltip, STAGE, 20)).toEqual({ x: 10, y: 10 + 30 + 20 });
  });
});

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
