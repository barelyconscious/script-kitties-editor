import { describe, expect, it } from "vitest";
import {
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
