import { describe, expect, it } from "vitest";
import {
  GRID_MAJOR_PX,
  GRID_MINOR_PX,
  GRID_OVERSCAN_PX,
  gridLayerStyle,
} from "./guiBlueprintGrid";

describe("gridLayerStyle", () => {
  it("is an absolutely-positioned layer inset by one period (overscan) on every side", () => {
    const style = gridLayerStyle({ panX: 0, panY: 0 });
    expect(style.position).toBe("absolute");
    expect(style.inset).toBe(`-${GRID_OVERSCAN_PX}px`);
    // Overscan is exactly one major period, so the [0, period) pan translate always covers.
    expect(GRID_OVERSCAN_PX).toBe(GRID_MAJOR_PX);
  });

  it("uses fixed integer cell sizes (does not zoom with the view)", () => {
    const size = gridLayerStyle({ panX: 0, panY: 0 }).backgroundSize as string;
    expect(size).toContain(`${GRID_MINOR_PX}px ${GRID_MINOR_PX}px`);
    expect(size).toContain(`${GRID_MAJOR_PX}px ${GRID_MAJOR_PX}px`);
    expect(Number.isInteger(GRID_MINOR_PX)).toBe(true);
    expect(Number.isInteger(GRID_MAJOR_PX)).toBe(true);
    expect(GRID_MAJOR_PX % GRID_MINOR_PX).toBe(0);
  });

  it("cell size stays constant regardless of how far the view has panned", () => {
    const near = gridLayerStyle({ panX: 0, panY: 0 }).backgroundSize as string;
    const far = gridLayerStyle({ panX: 9999, panY: -4321 }).backgroundSize as string;
    expect(far).toBe(near);
  });

  it("pans by a transform translate within one period (compositor-friendly)", () => {
    expect(gridLayerStyle({ panX: 40, panY: 75 }).transform).toBe("translate(40px, 75px)");
    // A pan past one period wraps via positive modulo (visually identical — periodic grid).
    expect(gridLayerStyle({ panX: GRID_MAJOR_PX + 10, panY: 0 }).transform).toBe(
      "translate(10px, 0px)",
    );
    // Negative pans map into [0, period) the same way (e.g. -16 → period-16).
    expect(gridLayerStyle({ panX: -16, panY: -120 }).transform).toBe(
      `translate(${GRID_MAJOR_PX - 16}px, 0px)`,
    );
  });

  it("rounds the pan to whole pixels so lines stay crisp mid-pan", () => {
    expect(gridLayerStyle({ panX: 12.4, panY: 7.5 }).transform).toBe("translate(12px, 8px)");
  });

  it("promotes to its own layer ONLY while interacting (pan), to avoid standing GPU cost", () => {
    expect(gridLayerStyle({ panX: 0, panY: 0 }, false).willChange).toBeUndefined();
    expect(gridLayerStyle({ panX: 0, panY: 0 }, true).willChange).toBe("transform");
  });

  it("draws four layers (minor + major, each H and V) with hard 1px stops", () => {
    const image = gridLayerStyle({ panX: 0, panY: 0 }).backgroundImage as string;
    expect(image.match(/repeating-linear-gradient/g)).toHaveLength(4);
    expect(image.match(/0 1px, transparent 1px/g)).toHaveLength(4);
  });

  it("returns a stable style for the same pan (pure builder)", () => {
    expect(gridLayerStyle({ panX: 32, panY: 48 })).toEqual(gridLayerStyle({ panX: 32, panY: 48 }));
  });
});
