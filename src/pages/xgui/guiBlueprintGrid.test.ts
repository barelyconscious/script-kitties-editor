import { describe, expect, it } from "vitest";
import {
  GRID_MAJOR_PX,
  GRID_MINOR_PX,
  VIEWPORT_VOID_COLOR,
  viewportGridStyle,
} from "./guiBlueprintGrid";

describe("viewportGridStyle", () => {
  it("paints the flat void color behind the grid", () => {
    expect(viewportGridStyle().backgroundColor).toBe(VIEWPORT_VOID_COLOR);
  });

  it("uses fixed integer cell sizes (does not track zoom)", () => {
    const size = viewportGridStyle().backgroundSize as string;
    // Minor + major tiles are the constant integer spacings, independent of any view.
    expect(size).toContain(`${GRID_MINOR_PX}px ${GRID_MINOR_PX}px`);
    expect(size).toContain(`${GRID_MAJOR_PX}px ${GRID_MAJOR_PX}px`);
    // The spacings are integers and the major is an integer multiple of the minor.
    expect(Number.isInteger(GRID_MINOR_PX)).toBe(true);
    expect(Number.isInteger(GRID_MAJOR_PX)).toBe(true);
    expect(GRID_MAJOR_PX % GRID_MINOR_PX).toBe(0);
  });

  it("anchors at a static integer origin (does not track pan)", () => {
    // A fixed (0,0) background-position keeps every line on a whole pixel.
    expect(viewportGridStyle().backgroundPosition).toBe("0 0");
  });

  it("draws four layers (minor + major, each H and V) with hard 1px stops", () => {
    const image = viewportGridStyle().backgroundImage as string;
    // Four comma-separated repeating-linear-gradient layers.
    expect(image.match(/repeating-linear-gradient/g)).toHaveLength(4);
    // Each line is a hard 1px stop, not a soft gradient — so it renders crisp.
    expect(image.match(/0 1px, transparent 1px/g)).toHaveLength(4);
  });

  it("returns a stable style regardless of how it is called (it is view-independent)", () => {
    // No view argument: the same backdrop every time, so it stays fixed while the
    // artboard zooms/pans on top of it.
    expect(viewportGridStyle()).toEqual(viewportGridStyle());
  });
});
