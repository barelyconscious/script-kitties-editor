import { describe, expect, it } from "vitest";
import { type CellStamp, stampGrid } from "./guiGridStamp";

describe("stampGrid", () => {
  it("yields exactly rows×columns descriptors in fill order", () => {
    const stamps = stampGrid(["a", "b", "c", "d", "e", "f"], 2, 3);
    expect(stamps).toHaveLength(6);
    expect(stamps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stamps.map((s) => s.item)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("fills cells left-to-right, top-to-bottom (index = array order)", () => {
    // The renderer maps index → grid coordinate; stamping is purely linear fill order.
    const stamps = stampGrid([{ n: 1 }, { n: 2 }], 1, 4);
    expect(stamps).toEqual<CellStamp[]>([
      { index: 0, item: { n: 1 } },
      { index: 1, item: { n: 2 } },
      { index: 2, item: null },
      { index: 3, item: null },
    ]);
  });

  it("drops excess collection entries beyond rows×columns", () => {
    // 2×2 = 4 slots, 6 items → the last two are dropped (pagination is the
    // controller's job, not ours).
    const stamps = stampGrid([1, 2, 3, 4, 5, 6], 2, 2);
    expect(stamps).toHaveLength(4);
    expect(stamps.map((s) => s.item)).toEqual([1, 2, 3, 4]);
  });

  it("fills missing cells with a null item (template chrome still renders)", () => {
    // 3 slots, 1 item → cells 1 and 2 get null items.
    const stamps = stampGrid(["only"], 1, 3);
    expect(stamps.map((s) => s.item)).toEqual(["only", null, null]);
  });

  it("a non-array collection → all-null cells (grid still draws its chrome)", () => {
    expect(stampGrid(undefined, 1, 2).map((s) => s.item)).toEqual([null, null]);
    expect(stampGrid(null, 1, 2).map((s) => s.item)).toEqual([null, null]);
    expect(stampGrid("not-an-array", 1, 2).map((s) => s.item)).toEqual([null, null]);
    expect(stampGrid({ a: 1 }, 1, 2).map((s) => s.item)).toEqual([null, null]);
  });

  it("an empty array → all-null cells", () => {
    expect(stampGrid([], 2, 2).map((s) => s.item)).toEqual([null, null, null, null]);
  });

  it("a 0-dimension grid yields no cells", () => {
    expect(stampGrid([1, 2, 3], 0, 3)).toEqual([]);
    expect(stampGrid([1, 2, 3], 3, 0)).toEqual([]);
    expect(stampGrid([1, 2, 3], 0, 0)).toEqual([]);
  });

  it("a negative dimension yields no cells (defensive; renderer settles 0/default first)", () => {
    expect(stampGrid([1, 2, 3], -1, 3)).toEqual([]);
  });

  it("preserves a genuine null/undefined entry as a null-equivalent item", () => {
    // A real null entry is indistinguishable from a missing slot — both resolve to an
    // empty scope, which is exactly the spec's null-item behavior.
    const stamps = stampGrid([null, undefined, { n: 3 }], 1, 3);
    expect(stamps[0].item).toBeNull();
    expect(stamps[1].item).toBeUndefined();
    expect(stamps[2].item).toEqual({ n: 3 });
  });
});
