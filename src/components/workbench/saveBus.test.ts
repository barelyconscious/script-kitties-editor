import { describe, expect, it, vi } from "vitest";
import {
  aggregateDirty,
  type SaveOutcome,
  type SaveTarget,
  saveAllTargets,
  summarizeOutcomes,
} from "./saveBus";

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

describe("summarizeOutcomes", () => {
  const ok = (id: string): SaveOutcome => ({ id, ok: true });
  const fail = (id: string, error: string): SaveOutcome => ({ id, ok: false, error });

  it("treats an empty outcome list as a no-op (ok, no message)", () => {
    expect(summarizeOutcomes([])).toEqual({ ok: true, message: "" });
  });

  it("reports a plain 'Saved' when every target succeeded", () => {
    expect(summarizeOutcomes([ok("data"), ok("script")])).toEqual({
      ok: true,
      message: "Saved",
    });
  });

  it("reports 'Saved' for a single successful target", () => {
    expect(summarizeOutcomes([ok("script")])).toEqual({ ok: true, message: "Saved" });
  });

  it("names the partial split when data saved but script failed", () => {
    const summary = summarizeOutcomes([ok("data"), fail("script", "disk full")]);
    expect(summary.ok).toBe(false);
    expect(summary.message).toBe("Data saved, but script: disk full");
  });

  it("names the partial split when script saved but data failed", () => {
    const summary = summarizeOutcomes([fail("data", "permission denied"), ok("script")]);
    expect(summary.ok).toBe(false);
    expect(summary.message).toBe("Script saved, but data: permission denied");
  });

  it("reports a total failure when nothing landed", () => {
    const summary = summarizeOutcomes([fail("data", "permission denied"), fail("script", "oops")]);
    expect(summary.ok).toBe(false);
    expect(summary.message).toBe("Save failed: data: permission denied; script: oops");
  });

  it("reports a total failure for a single failing target", () => {
    const summary = summarizeOutcomes([fail("script", "boom")]);
    expect(summary.ok).toBe(false);
    expect(summary.message).toBe("Save failed: script: boom");
  });

  it("a partial failure is NEVER reported as success", () => {
    // The trust core: any failure forces ok:false even when some saves landed.
    for (const outcomes of [
      [ok("data"), fail("script", "x")],
      [fail("data", "x"), ok("script")],
      [ok("data"), ok("itemDrop"), fail("script", "x")],
    ]) {
      expect(summarizeOutcomes(outcomes).ok).toBe(false);
    }
  });

  it("falls back to the raw id for an unknown target label", () => {
    const summary = summarizeOutcomes([ok("data"), fail("itemDrop", "nope")]);
    expect(summary.message).toBe("Data saved, but itemdrop: nope");
  });

  it("includes a failed target with no error message gracefully", () => {
    const summary = summarizeOutcomes([{ id: "script", ok: false }]);
    expect(summary).toEqual({ ok: false, message: "Save failed: script" });
  });
});
