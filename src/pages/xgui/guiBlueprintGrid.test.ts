import { describe, expect, it } from "vitest";
import type { ViewTransform } from "../../lib/guiGeometry";
import {
  GRID_MAJOR_LOGICAL_PX,
  GRID_MINOR_LOGICAL_PX,
  VIEWPORT_VOID_COLOR,
  viewportGridStyle,
} from "./guiBlueprintGrid";

const view = (scale: number, panX = 0, panY = 0): ViewTransform => ({ scale, panX, panY });

describe("viewportGridStyle", () => {
  it("paints the flat void color behind the grid", () => {
    expect(viewportGridStyle(view(1)).backgroundColor).toBe(VIEWPORT_VOID_COLOR);
  });

  it("scales the cell size by the current zoom (tracks zoom)", () => {
    const at1 = viewportGridStyle(view(1)).backgroundSize as string;
    // At 100%, the minor tile is the logical spacing; the major tile its multiple.
    expect(at1).toContain(`${GRID_MINOR_LOGICAL_PX}px ${GRID_MINOR_LOGICAL_PX}px`);
    expect(at1).toContain(`${GRID_MAJOR_LOGICAL_PX}px ${GRID_MAJOR_LOGICAL_PX}px`);

    const at2 = viewportGridStyle(view(2)).backgroundSize as string;
    // At 200% the cells double, so the grid grows WITH the artboard.
    expect(at2).toContain(`${GRID_MINOR_LOGICAL_PX * 2}px ${GRID_MINOR_LOGICAL_PX * 2}px`);
    expect(at2).toContain(`${GRID_MAJOR_LOGICAL_PX * 2}px ${GRID_MAJOR_LOGICAL_PX * 2}px`);
  });

  it("offsets the origin by the pan (tracks pan) on every layer", () => {
    const style = viewportGridStyle(view(1, 37, -12));
    const position = style.backgroundPosition as string;
    // Every layer shares the pan origin so major/minor phases stay locked.
    expect(position.split(", ").every((p) => p === "37px -12px")).toBe(true);
  });

  it("draws four layers (minor + major, each H and V) at normal zoom", () => {
    const image = viewportGridStyle(view(1)).backgroundImage as string;
    // Four comma-separated repeating-linear-gradient layers.
    expect(image.match(/repeating-linear-gradient/g)).toHaveLength(4);
  });

  it("drops the minor tier when zoomed out enough to alias (keeps major)", () => {
    // minor cell = 20 * scale; below ~4px the minor tier is dropped. 0.1 → 2px.
    const style = viewportGridStyle(view(0.1));
    const image = style.backgroundImage as string;
    // Only the two MAJOR layers survive.
    expect(image.match(/repeating-linear-gradient/g)).toHaveLength(2);
    // And the size/position layer counts stay consistent (2 each).
    expect((style.backgroundSize as string).split(", ")).toHaveLength(2);
    expect((style.backgroundPosition as string).split(", ")).toHaveLength(2);
  });
});
