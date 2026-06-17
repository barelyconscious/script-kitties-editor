import { describe, expect, it } from "vitest";
import {
  GRID_MAJOR_PX,
  GRID_MINOR_PX,
  VIEWPORT_VOID_COLOR,
  viewportGridStyle,
} from "./guiBlueprintGrid";

describe("viewportGridStyle", () => {
  it("paints the flat void color behind the grid", () => {
    expect(viewportGridStyle({ panX: 0, panY: 0 }).backgroundColor).toBe(VIEWPORT_VOID_COLOR);
  });

  it("uses fixed integer cell sizes (does not zoom with the view)", () => {
    const size = viewportGridStyle({ panX: 0, panY: 0 }).backgroundSize as string;
    // Minor + major tiles are the constant integer spacings, independent of any view.
    expect(size).toContain(`${GRID_MINOR_PX}px ${GRID_MINOR_PX}px`);
    expect(size).toContain(`${GRID_MAJOR_PX}px ${GRID_MAJOR_PX}px`);
    // The spacings are integers and the major is an integer multiple of the minor.
    expect(Number.isInteger(GRID_MINOR_PX)).toBe(true);
    expect(Number.isInteger(GRID_MAJOR_PX)).toBe(true);
    expect(GRID_MAJOR_PX % GRID_MINOR_PX).toBe(0);
  });

  it("cell size stays constant regardless of how far the view has panned", () => {
    // Panning a long way must not change the tile spacing — the grid never zooms.
    const near = viewportGridStyle({ panX: 0, panY: 0 }).backgroundSize as string;
    const far = viewportGridStyle({ panX: 9999, panY: -4321 }).backgroundSize as string;
    expect(far).toBe(near);
  });

  it("pans with the view: background-position is offset by the pan", () => {
    expect(viewportGridStyle({ panX: 40, panY: 75 }).backgroundPosition).toBe("40px 75px");
    // Negative pans (artboard dragged the other way) offset the grid the other way.
    expect(viewportGridStyle({ panX: -16, panY: -120 }).backgroundPosition).toBe("-16px -120px");
  });

  it("rounds the pan to whole pixels so lines stay crisp mid-pan", () => {
    // Fractional pan offsets are rounded so each line lands on a whole device pixel.
    expect(viewportGridStyle({ panX: 12.4, panY: 7.5 }).backgroundPosition).toBe("12px 8px");
    expect(viewportGridStyle({ panX: -3.2, panY: -8.6 }).backgroundPosition).toBe("-3px -9px");
  });

  it("draws four layers (minor + major, each H and V) with hard 1px stops", () => {
    const image = viewportGridStyle({ panX: 0, panY: 0 }).backgroundImage as string;
    // Four comma-separated repeating-linear-gradient layers.
    expect(image.match(/repeating-linear-gradient/g)).toHaveLength(4);
    // Each line is a hard 1px stop, not a soft gradient — so it renders crisp.
    expect(image.match(/0 1px, transparent 1px/g)).toHaveLength(4);
  });

  it("returns a stable style for the same pan (pure builder)", () => {
    expect(viewportGridStyle({ panX: 32, panY: 48 })).toEqual(
      viewportGridStyle({ panX: 32, panY: 48 }),
    );
  });
});
