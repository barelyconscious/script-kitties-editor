import { describe, expect, it } from "vitest";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import { DROP_EDGE_FRACTION, dropPlanForPointer } from "./guiTreeDnd";

function node(nodeId: string, tag: GuiTag, children: GuiNode[] = []): GuiNode {
  return { nodeId, tag, attrs: {}, children };
}

/** A 20px-tall row starting at y=100, so fractions map to easy pixel Ys. */
const RECT = { top: 100, height: 20 };
/** Pointer Y for a given fraction down RECT. */
const at = (fraction: number) => RECT.top + fraction * RECT.height;

describe("dropPlanForPointer — zone selection from pointer Y", () => {
  // parent[View] > [A, B, C]; we drop relative to B (index 1).
  const a = node("A", "Panel");
  const b = node("B", "Panel");
  const c = node("C", "Panel");
  const parent = node("View", "View", [a, b, c]);

  it("top band (< edge fraction) is BEFORE the row, at the row's own slot", () => {
    const plan = dropPlanForPointer(RECT, at(0.1), b, parent);
    expect(plan).toEqual({ zone: "before", targetParentId: "View", index: 1 });
  });

  it("bottom band (> 1 - edge fraction) is AFTER the row, at slot + 1", () => {
    const plan = dropPlanForPointer(RECT, at(0.9), b, parent);
    expect(plan).toEqual({ zone: "after", targetParentId: "View", index: 2 });
  });

  it("middle band is INTO the row, appended as its last child", () => {
    const withKid = node("B", "Panel", [node("kid", "Text")]);
    const parentWithKid = node("View", "View", [a, withKid, c]);
    const plan = dropPlanForPointer(RECT, at(0.5), withKid, parentWithKid);
    expect(plan).toEqual({ zone: "into", targetParentId: "B", index: 1 });
  });

  it("INTO an empty container appends at index 0", () => {
    const plan = dropPlanForPointer(RECT, at(0.5), b, parent);
    expect(plan).toEqual({ zone: "into", targetParentId: "B", index: 0 });
  });
});

describe("dropPlanForPointer — zone boundaries", () => {
  const a = node("A", "Panel");
  const b = node("B", "Panel");
  const parent = node("View", "View", [a, b]);

  it("exactly at the top edge fraction reads as INTO (not before)", () => {
    // fraction === DROP_EDGE_FRACTION → not `< edge`, so INTO.
    const plan = dropPlanForPointer(RECT, at(DROP_EDGE_FRACTION), b, parent);
    expect(plan.zone).toBe("into");
  });

  it("just above the top edge fraction reads as BEFORE", () => {
    const plan = dropPlanForPointer(RECT, at(DROP_EDGE_FRACTION - 0.01), b, parent);
    expect(plan.zone).toBe("before");
  });

  it("exactly at the bottom edge fraction reads as INTO (not after)", () => {
    const plan = dropPlanForPointer(RECT, at(1 - DROP_EDGE_FRACTION), b, parent);
    expect(plan.zone).toBe("into");
  });

  it("just below the bottom edge fraction reads as AFTER", () => {
    const plan = dropPlanForPointer(RECT, at(1 - DROP_EDGE_FRACTION + 0.01), b, parent);
    expect(plan.zone).toBe("after");
  });

  it("clamps a pointer above the row to the top band (BEFORE)", () => {
    const plan = dropPlanForPointer(RECT, RECT.top - 50, b, parent);
    expect(plan.zone).toBe("before");
  });

  it("clamps a pointer below the row to the bottom band (AFTER)", () => {
    const plan = dropPlanForPointer(RECT, RECT.top + RECT.height + 50, b, parent);
    expect(plan.zone).toBe("after");
  });
});

describe("dropPlanForPointer — before/after index math across positions", () => {
  const a = node("A", "Panel");
  const b = node("B", "Panel");
  const c = node("C", "Panel");
  const parent = node("View", "View", [a, b, c]);

  it("BEFORE the first child is index 0", () => {
    expect(dropPlanForPointer(RECT, at(0.1), a, parent).index).toBe(0);
  });

  it("AFTER the first child is index 1", () => {
    expect(dropPlanForPointer(RECT, at(0.9), a, parent).index).toBe(1);
  });

  it("AFTER the last child is index length (append slot)", () => {
    expect(dropPlanForPointer(RECT, at(0.9), c, parent).index).toBe(3);
  });
});

describe("dropPlanForPointer — root special-casing", () => {
  const root = node("View", "View", [node("A", "Panel"), node("B", "Panel")]);

  it("root row (no parent) is always INTO, appended at the end, regardless of Y", () => {
    for (const f of [0.05, 0.5, 0.95]) {
      const plan = dropPlanForPointer(RECT, at(f), root, null);
      expect(plan).toEqual({ zone: "into", targetParentId: "View", index: 2 });
    }
  });
});

describe("dropPlanForPointer — degenerate rect", () => {
  const a = node("A", "Panel");
  const parent = node("View", "View", [a]);

  it("a zero-height rect is treated as 1px and does not divide-by-zero", () => {
    const plan = dropPlanForPointer({ top: 100, height: 0 }, 100, a, parent);
    // (100 - 100) / 1 = 0 → top band → before.
    expect(plan.zone).toBe("before");
    expect(Number.isNaN(plan.index)).toBe(false);
  });
});
