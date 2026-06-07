import { describe, expect, it, vi } from "vitest";
import { aggregateDirty, type SaveTarget, saveAllTargets } from "./saveBus";

function target(over: Partial<SaveTarget> & Pick<SaveTarget, "id">): SaveTarget {
  return {
    order: 0,
    dirty: true,
    save: vi.fn(async () => {}),
    ...over,
  };
}

describe("saveAllTargets", () => {
  it("only runs dirty targets", async () => {
    const dirtySave = vi.fn(async () => {});
    const cleanSave = vi.fn(async () => {});
    const outcomes = await saveAllTargets([
      target({ id: "a", dirty: true, save: dirtySave }),
      target({ id: "b", dirty: false, save: cleanSave }),
    ]);

    expect(dirtySave).toHaveBeenCalledOnce();
    expect(cleanSave).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ id: "a", ok: true }]);
  });

  it("runs dirty targets in ascending order regardless of array order", async () => {
    const calls: string[] = [];
    await saveAllTargets([
      target({
        id: "script",
        order: 10,
        save: async () => {
          calls.push("script");
        },
      }),
      target({
        id: "data",
        order: 0,
        save: async () => {
          calls.push("data");
        },
      }),
    ]);

    expect(calls).toEqual(["data", "script"]);
  });

  it("catches per-target failures so one failure does not abort the rest", async () => {
    const after = vi.fn(async () => {});
    const outcomes = await saveAllTargets([
      target({
        id: "data",
        order: 0,
        save: async () => {
          throw new Error("disk full");
        },
      }),
      target({ id: "script", order: 10, save: after }),
    ]);

    // The later target still ran.
    expect(after).toHaveBeenCalledOnce();
    expect(outcomes).toEqual([
      { id: "data", ok: false, error: "disk full" },
      { id: "script", ok: true },
    ]);
  });

  it("normalizes a non-Error throw into a string message", async () => {
    const outcomes = await saveAllTargets([
      target({
        id: "data",
        save: async () => {
          throw "raw string failure";
        },
      }),
    ]);

    expect(outcomes).toEqual([{ id: "data", ok: false, error: "raw string failure" }]);
  });

  it("returns an empty list when nothing is dirty", async () => {
    const outcomes = await saveAllTargets([
      target({ id: "a", dirty: false }),
      target({ id: "b", dirty: false }),
    ]);
    expect(outcomes).toEqual([]);
  });
});

describe("aggregateDirty", () => {
  it("is true when any target is dirty", () => {
    expect(
      aggregateDirty([target({ id: "a", dirty: false }), target({ id: "b", dirty: true })]),
    ).toBe(true);
  });

  it("is false when no target is dirty", () => {
    expect(
      aggregateDirty([target({ id: "a", dirty: false }), target({ id: "b", dirty: false })]),
    ).toBe(false);
  });

  it("is false for an empty target set", () => {
    expect(aggregateDirty([])).toBe(false);
  });
});
