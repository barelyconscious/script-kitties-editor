import { describe, expect, it } from "vitest";
import {
  applyDragDelta,
  calcAxis,
  computeBoxGeometry,
  DEFAULT_POSITION,
  DEFAULT_SIZE,
  parseUDim2,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from "./guiGeometry";

describe("parseUDim2", () => {
  it("parses four numeric fields in order", () => {
    expect(parseUDim2("1,0,0,5")).toEqual({ relX: 1, relY: 0, absX: 0, absY: 5 });
  });

  it("parses fractional scale fields", () => {
    expect(parseUDim2("0.5,0.25,0,0")).toEqual({ relX: 0.5, relY: 0.25, absX: 0, absY: 0 });
  });

  it("parses negative offsets (right/bottom anchoring)", () => {
    // The bag.xml root panel: position="1,0,-300,0" size="0,1,300,-32".
    expect(parseUDim2("1,0,-300,0")).toEqual({ relX: 1, relY: 0, absX: -300, absY: 0 });
    expect(parseUDim2("0,1,300,-32")).toEqual({ relX: 0, relY: 1, absX: 300, absY: -32 });
  });

  it("tolerates surrounding whitespace on fields", () => {
    expect(parseUDim2(" 1 , 0 , 0 , 5 ")).toEqual({ relX: 1, relY: 0, absX: 0, absY: 5 });
  });

  it("treats a {token} field as 0 (literal-only, F2 fallback)", () => {
    // size="{healthRatio},1,0,0" — scale-x is a binding, resolved in F3. For F2
    // geometry it falls back to 0 while the raw text is surfaced elsewhere.
    expect(parseUDim2("{healthRatio},1,0,0")).toEqual({ relX: 0, relY: 1, absX: 0, absY: 0 });
  });

  it("treats garbage / empty fields as 0", () => {
    expect(parseUDim2("abc,,,")).toEqual({ relX: 0, relY: 0, absX: 0, absY: 0 });
  });

  it("fills missing trailing fields with 0", () => {
    expect(parseUDim2("1,1")).toEqual({ relX: 1, relY: 1, absX: 0, absY: 0 });
  });

  it("ignores extra fields beyond the first four", () => {
    expect(parseUDim2("1,2,3,4,5,6")).toEqual({ relX: 1, relY: 2, absX: 3, absY: 4 });
  });

  it("treats undefined as all-zero", () => {
    expect(parseUDim2(undefined)).toEqual({ relX: 0, relY: 0, absX: 0, absY: 0 });
  });
});

describe("calcAxis", () => {
  it("emits a percentage + pixel calc()", () => {
    expect(calcAxis(0.5, 5)).toBe("calc(50% + 5px)");
  });

  it("keeps a pure-pixel axis as calc(0% + Npx)", () => {
    expect(calcAxis(0, 32)).toBe("calc(0% + 32px)");
  });

  it("keeps a pure-scale axis as calc(N% + 0px)", () => {
    expect(calcAxis(1, 0)).toBe("calc(100% + 0px)");
  });

  it("emits negative offsets verbatim (no clamping)", () => {
    // Right-anchored: position="1,0,-300,0" -> left: calc(100% + -300px).
    expect(calcAxis(1, -300)).toBe("calc(100% + -300px)");
  });

  it("emits >100% scale verbatim (no clamping)", () => {
    expect(calcAxis(1.5, 0)).toBe("calc(150% + 0px)");
  });
});

describe("computeBoxGeometry", () => {
  it("maps position -> left/top and size -> width/height", () => {
    const geo = computeBoxGeometry("0,0,40,12", "1,1,0,0");
    expect(geo).toEqual({
      position: "absolute",
      left: "calc(0% + 40px)",
      top: "calc(0% + 12px)",
      width: "calc(100% + 0px)",
      height: "calc(100% + 0px)",
    });
  });

  it("applies the documented defaults when attrs are absent", () => {
    const geo = computeBoxGeometry(undefined, undefined);
    // Default position 0,0,0,0 -> origin; default size 1,1,0,0 -> fill parent.
    expect(geo.left).toBe("calc(0% + 0px)");
    expect(geo.top).toBe("calc(0% + 0px)");
    expect(geo.width).toBe("calc(100% + 0px)");
    expect(geo.height).toBe("calc(100% + 0px)");
    expect(DEFAULT_POSITION).toBe("0,0,0,0");
    expect(DEFAULT_SIZE).toBe("1,1,0,0");
  });

  it("reproduces the bag.xml right-anchored root panel geometry", () => {
    // <Panel id="root" position="1,0,-300,0" size="0,1,300,-32"> — a 300px-wide
    // panel pinned to the right edge, full parent height minus 32px.
    const geo = computeBoxGeometry("1,0,-300,0", "0,1,300,-32");
    expect(geo.left).toBe("calc(100% + -300px)");
    expect(geo.top).toBe("calc(0% + 0px)");
    expect(geo.width).toBe("calc(0% + 300px)");
    expect(geo.height).toBe("calc(100% + -32px)");
  });

  it("always reports position: absolute", () => {
    expect(computeBoxGeometry("0,0,0,0", "0,0,10,10").position).toBe("absolute");
  });
});

describe("stage constants", () => {
  it("is the fixed 1280x768 preview resolution", () => {
    expect(STAGE_WIDTH).toBe(1280);
    expect(STAGE_HEIGHT).toBe(768);
  });
});

describe("applyDragDelta (F7 drag-to-move)", () => {
  it("adds the pixel delta to the absX/absY offset half", () => {
    // From the origin, a +40,+12 drag lands the offset at exactly the delta.
    expect(applyDragDelta("0,0,0,0", 40, 12)).toBe("0,0,40,12");
  });

  it("accumulates onto existing literal offsets", () => {
    // Box already at offset (10,20); a (+5,-3) drag delta accumulates correctly.
    expect(applyDragDelta("0,0,10,20", 5, -3)).toBe("0,0,15,17");
  });

  it("never touches the scale half — literal scale survives verbatim", () => {
    // relX/relY are passed through unchanged; only the offsets move.
    expect(applyDragDelta("0.5,0.25,10,20", 6, 4)).toBe("0.5,0.25,16,24");
  });

  it("never touches a BOUND scale field — the {token} survives a drag", () => {
    // A responsive scale binding (scale-x = {healthRatio}) is preserved verbatim;
    // only the offset half is written. This is the core "drag moves offset, never
    // scale" guarantee even when scale is data-bound.
    expect(applyDragDelta("{healthRatio},1,0,0", 8, 9)).toBe("{healthRatio},1,8,9");
  });

  it("replaces a BOUND offset field with the resulting literal (base 0 + delta)", () => {
    // A bound offset has no numeric value to accumulate onto, so its base is 0 and
    // the field becomes the literal pixel result. The bound field is NOT clobbered
    // by garbage — it is replaced per the documented "you dragged it, you set it".
    expect(applyDragDelta("0,0,{xOff},0", 30, 0)).toBe("0,0,30,0");
    // The OTHER (literal) offset still accumulates normally alongside it.
    expect(applyDragDelta("0,0,{xOff},5", 30, 7)).toBe("0,0,30,12");
  });

  it("handles negative (right/bottom-anchored) offsets, accumulating signed", () => {
    // bag.xml right-anchored panel position="1,0,-300,0"; dragging left -20 and
    // down +15 keeps the scale half and shifts the signed offset.
    expect(applyDragDelta("1,0,-300,0", -20, 15)).toBe("1,0,-320,15");
  });

  it("applies the default 0,0,0,0 when position is absent", () => {
    // A never-positioned box still drags from origin (the documented default).
    expect(applyDragDelta(undefined, 7, 9)).toBe("0,0,7,9");
  });

  it("fills missing scale/offset fields with 0 (half-authored value)", () => {
    // A short "1,1" value (scale only) drags from a 0 offset base.
    expect(applyDragDelta("1,1", 3, 4)).toBe("1,1,3,4");
  });

  it("tolerates whitespace around fields", () => {
    expect(applyDragDelta(" 0 , 0 , 10 , 20 ", 5, 5)).toBe("0,0,15,25");
  });

  it("treats a garbage offset field as a 0 base", () => {
    expect(applyDragDelta("0,0,abc,xyz", 11, 22)).toBe("0,0,11,22");
  });

  it("is idempotent per-move when applied to a fixed base (no drift)", () => {
    // The host applies the CUMULATIVE delta to the base captured at drag start.
    // Re-applying a larger cumulative delta to the SAME base gives the right answer
    // — this is why per-move writes never accumulate rounding/double-count drift.
    const base = "0,0,100,50";
    expect(applyDragDelta(base, 10, 10)).toBe("0,0,110,60");
    expect(applyDragDelta(base, 25, 25)).toBe("0,0,125,75");
    expect(applyDragDelta(base, 25, 25)).toBe("0,0,125,75");
  });
});
