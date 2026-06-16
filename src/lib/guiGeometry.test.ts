import { describe, expect, it } from "vitest";
import {
  applyDragDelta,
  calcAxis,
  clampScale,
  computeBoxGeometry,
  computeFitScale,
  DEFAULT_POSITION,
  DEFAULT_SIZE,
  DRAG_CLICK_THRESHOLD_PX,
  fitView,
  isDragGesture,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  parseUDim2,
  refitTriggerKey,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  scaleForWheel,
  screenDeltaToLogical,
  textureToLoad,
  type ViewTransform,
  ZOOM_STEP,
  zoomTowardCursor,
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

describe("computeFitScale (scale-to-fit)", () => {
  it("returns 1 when the container exactly matches the stage", () => {
    expect(computeFitScale(STAGE_WIDTH, STAGE_HEIGHT)).toBe(1);
  });

  it("scales down uniformly to fit a smaller container (width-bound)", () => {
    // Half the stage width, ample height → width is the binding constraint → 0.5.
    expect(computeFitScale(STAGE_WIDTH / 2, STAGE_HEIGHT)).toBe(0.5);
  });

  it("scales down uniformly to fit a smaller container (height-bound)", () => {
    // Ample width, half the stage height → height is the binding constraint → 0.5.
    expect(computeFitScale(STAGE_WIDTH, STAGE_HEIGHT / 2)).toBe(0.5);
  });

  it("picks the SMALLER of the two ratios (letterbox, aspect preserved)", () => {
    // A wide container (2x width, 1x height): the height ratio (1) wins, so the
    // stage scales to 1 and letterboxes horizontally rather than stretching.
    expect(computeFitScale(STAGE_WIDTH * 2, STAGE_HEIGHT)).toBe(1);
    // A tall container: width ratio binds.
    expect(computeFitScale(STAGE_WIDTH, STAGE_HEIGHT * 3)).toBe(1);
  });

  it("scales UP when the container is larger than the stage", () => {
    expect(computeFitScale(STAGE_WIDTH * 2, STAGE_HEIGHT * 2)).toBe(2);
  });

  it("falls back to 1 for an unmeasured/degenerate container (no collapse to 0)", () => {
    expect(computeFitScale(0, 0)).toBe(1);
    expect(computeFitScale(0, STAGE_HEIGHT)).toBe(1);
    expect(computeFitScale(-100, -100)).toBe(1);
    expect(computeFitScale(Number.NaN, 768)).toBe(1);
    expect(computeFitScale(Number.POSITIVE_INFINITY, 768)).toBe(1);
  });

  it("preserves the 1280:768 aspect ratio under the computed scale", () => {
    // Whatever the container, the scaled stage keeps the source aspect ratio,
    // because a single uniform scale never distorts.
    const scale = computeFitScale(640, 400);
    expect((STAGE_WIDTH * scale) / (STAGE_HEIGHT * scale)).toBeCloseTo(STAGE_WIDTH / STAGE_HEIGHT);
  });
});

describe("textureToLoad (texture-as-background)", () => {
  it("returns the trimmed name for a present, resolved literal texture", () => {
    expect(textureToLoad("ability_bite.png", true)).toBe("ability_bite.png");
    expect(textureToLoad("  gui_kittycoin.png  ", true)).toBe("gui_kittycoin.png");
  });

  it("returns null for an absent texture (renders nothing)", () => {
    expect(textureToLoad(undefined, true)).toBeNull();
  });

  it("returns null for an empty / whitespace-only texture (no broken image)", () => {
    expect(textureToLoad("", true)).toBeNull();
    expect(textureToLoad("   ", true)).toBeNull();
  });

  it("returns null for an UNRESOLVED texture (dangling {token}, paint nothing)", () => {
    // An interpolated/bound texture that didn't resolve still carries a literal
    // {token} — not a real filename — so we load nothing and let the box's
    // waiting-for-binding affordance signal it instead of fetching garbage.
    expect(textureToLoad("icon_{type}.png", false)).toBeNull();
    expect(textureToLoad("{spriteName}", false)).toBeNull();
  });

  it("loads a RESOLVED interpolated texture (the substituted filename)", () => {
    // After F3 interpolation, `icon_{type}.png` with type=bite resolves to a real
    // filename and resolved=true → it loads.
    expect(textureToLoad("icon_bite.png", true)).toBe("icon_bite.png");
  });
});

describe("screenDeltaToLogical (drag delta ÷ scale)", () => {
  it("is 1:1 at scale 1 (native size)", () => {
    expect(screenDeltaToLogical(40, 12, 1)).toEqual({ dx: 40, dy: 12 });
  });

  it("divides the screen delta by the scale (scaled-down stage)", () => {
    // At 0.5 scale, 40 screen px is an 80px move in logical space — dragging stays
    // accurate because the offset is written in logical (1280×768) coordinates.
    expect(screenDeltaToLogical(40, 20, 0.5)).toEqual({ dx: 80, dy: 40 });
  });

  it("divides by a scale > 1 (scaled-up stage)", () => {
    expect(screenDeltaToLogical(40, 20, 2)).toEqual({ dx: 20, dy: 10 });
  });

  it("preserves the sign of the delta", () => {
    expect(screenDeltaToLogical(-30, 15, 0.5)).toEqual({ dx: -60, dy: 30 });
  });

  it("falls back to 1:1 for a degenerate scale (no divide-by-zero / NaN)", () => {
    expect(screenDeltaToLogical(40, 12, 0)).toEqual({ dx: 40, dy: 12 });
    expect(screenDeltaToLogical(40, 12, -1)).toEqual({ dx: 40, dy: 12 });
    expect(screenDeltaToLogical(40, 12, Number.NaN)).toEqual({ dx: 40, dy: 12 });
  });

  it("composes with applyDragDelta to write the correct logical offset when scaled", () => {
    // End-to-end: a 50px screen drag at 0.5 scale → 100 logical px → applied onto a
    // box at offset (10,20) from the origin lands the offset at (110,120).
    const { dx, dy } = screenDeltaToLogical(50, 50, 0.5);
    expect(applyDragDelta("0,0,10,20", dx, dy)).toBe("0,0,110,120");
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

describe("applyDragDelta — whole-pixel snapping (469)", () => {
  it("rounds a fractional offset to a whole pixel", () => {
    // A fractional logical delta (the 468 scale divisor yields these) snaps to the
    // nearest integer so the offset stays a pixel coordinate.
    expect(applyDragDelta("0,0,0,0", 12.4, 7.6)).toBe("0,0,12,8");
  });

  it("rounds at the .5 boundary (Math.round: half rounds up)", () => {
    expect(applyDragDelta("0,0,0,0", 10.5, 20.5)).toBe("0,0,11,21");
  });

  it("rounds the ACCUMULATED offset (base + fractional delta) to an integer", () => {
    // Base offset 10/20 plus a fractional delta rounds the SUM, not the delta alone.
    expect(applyDragDelta("0,0,10,20", 5.3, 5.8)).toBe("0,0,15,26");
  });

  it("rounds negative fractional offsets toward the nearest integer", () => {
    // Math.round(-12.4) === -12, Math.round(-12.6) === -13 — signed rounding holds.
    expect(applyDragDelta("0,0,0,0", -12.4, -12.6)).toBe("0,0,-12,-13");
  });

  it("snaps the offset to integers but leaves the float scale half untouched", () => {
    // The whole point: scale stays a float (0.5/0.25), the offset becomes an integer.
    expect(applyDragDelta("0.5,0.25,0,0", 8.7, 3.2)).toBe("0.5,0.25,9,3");
  });

  it("produces integer offsets end-to-end from a fractional scaled drag", () => {
    // 25 screen px at 0.7 scale → ~35.71 logical px → snaps to 36 (a real drag path:
    // screenDeltaToLogical then applyDragDelta, the live per-move pipeline).
    const { dx, dy } = screenDeltaToLogical(25, 25, 0.7);
    const result = applyDragDelta("0,0,0,0", dx, dy);
    expect(result).toBe("0,0,36,36");
    // And the offset fields are integers (no decimal point) in the serialized value.
    const [, , absX, absY] = result.split(",");
    expect(Number.isInteger(Number(absX))).toBe(true);
    expect(Number.isInteger(Number(absY))).toBe(true);
  });

  it("snaps a bound offset field to a whole pixel too (you dragged it, you set it)", () => {
    // A bound offset is replaced by the literal pixel result; that literal is rounded
    // like any other offset.
    expect(applyDragDelta("0,0,{xOff},0", 30.6, 0)).toBe("0,0,31,0");
  });
});

describe("isDragGesture — drag vs. click (469)", () => {
  it("a zero-move release is a click, not a drag", () => {
    // Press and release in place → genuine click → selection logic runs as normal.
    expect(isDragGesture(100, 100, 100, 100)).toBe(false);
  });

  it("a tiny jitter within the threshold is still a click", () => {
    // A 2px wobble (< 3px threshold) on both axes — a hand-shake, not a reposition.
    expect(isDragGesture(100, 100, 102, 98)).toBe(false);
  });

  it("a move of exactly the threshold is still a click (strict >)", () => {
    // The drag must clearly exceed the threshold; equality stays a click.
    expect(isDragGesture(100, 100, 100 + DRAG_CLICK_THRESHOLD_PX, 100)).toBe(false);
    expect(isDragGesture(100, 100, 100, 100 + DRAG_CLICK_THRESHOLD_PX)).toBe(false);
  });

  it("a move past the threshold on the X axis is a drag", () => {
    expect(isDragGesture(100, 100, 140, 100)).toBe(true);
  });

  it("a move past the threshold on the Y axis is a drag", () => {
    expect(isDragGesture(100, 100, 100, 60)).toBe(true);
  });

  it("a move past the threshold on EITHER axis is a drag (negative direction too)", () => {
    expect(isDragGesture(100, 100, 90, 100)).toBe(true);
    expect(isDragGesture(100, 100, 100, 90)).toBe(true);
    expect(isDragGesture(200, 200, 150, 150)).toBe(true);
  });

  it("the threshold default is a small whole-pixel value", () => {
    // Pin the contract: the gesture threshold is 3 screen px (the value the preview's
    // click-suppression reads). A change here is a behavior change, not an accident.
    expect(DRAG_CLICK_THRESHOLD_PX).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// View transform (473): zoom + pan
// ---------------------------------------------------------------------------

describe("clampScale (zoom bounds)", () => {
  it("passes through a scale inside the bounds", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0.5)).toBe(0.5);
    expect(clampScale(4)).toBe(4);
  });

  it("clamps below the minimum to MIN_SCALE", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(-3)).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
  });

  it("clamps above the maximum to MAX_SCALE", () => {
    expect(clampScale(50)).toBe(MAX_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE);
  });

  it("falls back to MIN_SCALE for a non-finite scale (NaN guard)", () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
  });

  it("exposes sensible, ordered bounds", () => {
    expect(MIN_SCALE).toBeGreaterThan(0);
    expect(MAX_SCALE).toBeGreaterThan(MIN_SCALE);
  });
});

describe("fitView (fit + center)", () => {
  it("scale 1 and zero pan when the viewport exactly matches the stage", () => {
    expect(fitView(STAGE_WIDTH, STAGE_HEIGHT)).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it("centers the letterboxed stage in a wider viewport (height-bound)", () => {
    // 2x width, 1x height → fit scale 1; the scaled stage is STAGE_WIDTH wide, so it
    // is centered horizontally with (2W - W)/2 = W/2 pad, zero vertical pad.
    const view = fitView(STAGE_WIDTH * 2, STAGE_HEIGHT);
    expect(view.scale).toBe(1);
    expect(view.panX).toBe(STAGE_WIDTH / 2);
    expect(view.panY).toBe(0);
  });

  it("centers the letterboxed stage in a taller viewport (width-bound)", () => {
    const view = fitView(STAGE_WIDTH, STAGE_HEIGHT * 3);
    expect(view.scale).toBe(1);
    expect(view.panX).toBe(0);
    expect(view.panY).toBe(STAGE_HEIGHT);
  });

  it("scales down and centers in a smaller viewport", () => {
    // Half-size viewport → fit scale 0.5 → scaled stage is exactly the viewport, so
    // the centering pan is zero on both axes.
    const view = fitView(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    expect(view.scale).toBe(0.5);
    expect(view.panX).toBe(0);
    expect(view.panY).toBe(0);
  });

  it("the centered stage stays fully inside the viewport", () => {
    // With fit-and-center, the scaled stage fits within the viewport on both axes:
    // pan >= 0 and pan + scaledDim <= viewport dim.
    const W = 900;
    const H = 1000;
    const view = fitView(W, H);
    expect(view.panX).toBeGreaterThanOrEqual(0);
    expect(view.panY).toBeGreaterThanOrEqual(0);
    expect(view.panX + STAGE_WIDTH * view.scale).toBeLessThanOrEqual(W + 1e-9);
    expect(view.panY + STAGE_HEIGHT * view.scale).toBeLessThanOrEqual(H + 1e-9);
  });

  it("falls back to scale 1 for a degenerate viewport", () => {
    const view = fitView(0, 0);
    expect(view.scale).toBe(1);
  });
});

describe("zoomTowardCursor (keep the point under the cursor fixed)", () => {
  // The defining property across MANY scales: the logical point under the cursor
  // before the zoom maps back to the same cursor position after the zoom.
  const cases: Array<{ view: ViewTransform; cursor: [number, number]; next: number }> = [
    { view: { scale: 1, panX: 0, panY: 0 }, cursor: [100, 100], next: 2 },
    { view: { scale: 1, panX: 0, panY: 0 }, cursor: [100, 100], next: 0.5 },
    { view: { scale: 0.5, panX: 40, panY: 20 }, cursor: [300, 200], next: 1 },
    { view: { scale: 2, panX: -100, panY: -50 }, cursor: [640, 360], next: 0.8 },
    { view: { scale: 0.37, panX: 220, panY: 15 }, cursor: [512, 333], next: 1.4 },
  ];

  for (const { view, cursor, next } of cases) {
    it(`keeps the cursor's logical point fixed (scale ${view.scale} → ${next})`, () => {
      const [cx, cy] = cursor;
      // Logical point under the cursor BEFORE the zoom.
      const lxBefore = (cx - view.panX) / view.scale;
      const lyBefore = (cy - view.panY) / view.scale;
      const after = zoomTowardCursor(view, cx, cy, next);
      // Where that same logical point lands AFTER the zoom — must be the cursor.
      const screenX = lxBefore * after.scale + after.panX;
      const screenY = lyBefore * after.scale + after.panY;
      expect(screenX).toBeCloseTo(cx, 9);
      expect(screenY).toBeCloseTo(cy, 9);
    });
  }

  it("applies the requested scale when within bounds", () => {
    expect(zoomTowardCursor({ scale: 1, panX: 0, panY: 0 }, 0, 0, 3).scale).toBe(3);
  });

  it("clamps the scale at the max and still pins the cursor point", () => {
    const view: ViewTransform = { scale: 4, panX: 10, panY: 10 };
    const cx = 200;
    const cy = 150;
    const lx = (cx - view.panX) / view.scale;
    const ly = (cy - view.panY) / view.scale;
    // Request a huge scale → clamps to MAX_SCALE; the cursor point still stays put.
    const after = zoomTowardCursor(view, cx, cy, 100);
    expect(after.scale).toBe(MAX_SCALE);
    expect(lx * after.scale + after.panX).toBeCloseTo(cx, 9);
    expect(ly * after.scale + after.panY).toBeCloseTo(cy, 9);
  });

  it("clamps the scale at the min", () => {
    expect(zoomTowardCursor({ scale: 0.2, panX: 0, panY: 0 }, 0, 0, 0.001).scale).toBe(MIN_SCALE);
  });

  it("zooming at the origin cursor leaves pan at zero (origin is the fixed point)", () => {
    expect(zoomTowardCursor({ scale: 1, panX: 0, panY: 0 }, 0, 0, 2)).toEqual({
      scale: 2,
      panX: 0,
      panY: 0,
    });
  });
});

describe("scaleForWheel (wheel → target scale)", () => {
  it("zooms IN on a negative deltaY (wheel up)", () => {
    expect(scaleForWheel(1, -1)).toBeCloseTo(ZOOM_STEP, 9);
  });

  it("zooms OUT on a positive deltaY (wheel down)", () => {
    expect(scaleForWheel(1, 1)).toBeCloseTo(1 / ZOOM_STEP, 9);
  });

  it("ignores the magnitude of deltaY — only the sign matters (one notch per tick)", () => {
    expect(scaleForWheel(2, -120)).toBeCloseTo(2 * ZOOM_STEP, 9);
    expect(scaleForWheel(2, 0.5)).toBeCloseTo(2 / ZOOM_STEP, 9);
  });

  it("the step is > 1 (a real zoom increment)", () => {
    expect(ZOOM_STEP).toBeGreaterThan(1);
  });
});

describe("panBy (pure translate)", () => {
  it("adds the screen delta to the pan, leaving scale untouched", () => {
    expect(panBy({ scale: 0.75, panX: 10, panY: 20 }, 5, -8)).toEqual({
      scale: 0.75,
      panX: 15,
      panY: 12,
    });
  });

  it("never changes scale regardless of delta", () => {
    expect(panBy({ scale: 3, panX: 0, panY: 0 }, 100, 100).scale).toBe(3);
  });
});

describe("element drag under combined zoom + pan (integration)", () => {
  // Pan is a PURE translate, so it must NOT change the screen→logical delta the
  // element drag writes — only scale divides. These pin that invariant: the same
  // screen drag writes the same integer logical offset at any pan, and the right
  // offset under a non-unit scale.
  it("pan does not affect the logical drag delta (only scale does)", () => {
    const screenDx = 50;
    const screenDy = 30;
    const scale = 0.5;
    const noPan = screenDeltaToLogical(screenDx, screenDy, scale);
    // Whatever the pan, the conversion is identical (pan never enters it).
    expect(noPan).toEqual({ dx: 100, dy: 60 });
    // And the written offset (integer) is the same with any pan in play.
    expect(applyDragDelta("0,0,0,0", noPan.dx, noPan.dy)).toBe("0,0,100,60");
  });

  it("writes the correct INTEGER offset when zoomed and panned", () => {
    // A fit-and-center view at 0.5 scale with a non-zero centering pan; the drag
    // offset is driven purely by scale, and the result is a whole-pixel offset.
    const view = fitView(STAGE_WIDTH / 2, STAGE_HEIGHT); // scale 0.5, panX 0, panY 192
    expect(view.scale).toBe(0.5);
    const { dx, dy } = screenDeltaToLogical(25, 25, view.scale);
    const result = applyDragDelta("0,0,10,20", dx, dy);
    expect(result).toBe("0,0,60,70");
    const [, , absX, absY] = result.split(",");
    expect(Number.isInteger(Number(absX))).toBe(true);
    expect(Number.isInteger(Number(absY))).toBe(true);
  });
});

describe("refitTriggerKey (task 474: re-fit only on opening a different component)", () => {
  it("is null when nothing is open", () => {
    expect(refitTriggerKey(null)).toBeNull();
  });

  it("is the open component's stable path", () => {
    expect(refitTriggerKey({ path: "widgets/bag.xml" })).toBe("widgets/bag.xml");
  });

  it("is STABLE across an immutable edit to the same component (the bug)", () => {
    // The regression: a drag's per-pointermove setNodeAttrs (and add/remove,
    // undo/redo, live-reload) replaces `root` but never touches `path`. The trigger
    // must NOT change, so the fit-and-center reset does NOT fire and the user's
    // zoom/pan survives. We model two successive edit states of the SAME file —
    // distinct objects (immutable), distinct `root` refs — sharing one path.
    const beforeEdit = { path: "widgets/bag.xml", root: { ref: "old" } };
    const afterEdit = { path: "widgets/bag.xml", root: { ref: "new" } };
    expect(afterEdit.root).not.toBe(beforeEdit.root); // root reference DID change
    // ...yet the trigger key is identical, so the effect does not re-run.
    expect(refitTriggerKey(afterEdit)).toBe(refitTriggerKey(beforeEdit));
  });

  it("CHANGES when a different component is opened (still fits-and-centers)", () => {
    const bag = refitTriggerKey({ path: "widgets/bag.xml" });
    const inventory = refitTriggerKey({ path: "widgets/inventory.xml" });
    expect(inventory).not.toBe(bag);
  });
});
