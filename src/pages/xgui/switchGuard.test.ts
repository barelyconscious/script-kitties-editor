import { describe, expect, it } from "vitest";
import { decideSwitch } from "./switchGuard";

describe("decideSwitch", () => {
  it("proceeds when nothing is dirty", () => {
    expect(decideSwitch({ openName: "bag", dirty: false }, "shop")).toBe("proceed");
  });

  it("proceeds when nothing is open (no edits to lose)", () => {
    expect(decideSwitch({ openName: null, dirty: false }, "bag")).toBe("proceed");
  });

  it("proceeds when re-selecting the SAME open component, even while dirty", () => {
    // Re-opening the open component discards nothing — never nag.
    expect(decideSwitch({ openName: "bag", dirty: true }, "bag")).toBe("proceed");
  });

  it("prompts when switching to a DIFFERENT component while dirty", () => {
    expect(decideSwitch({ openName: "bag", dirty: true }, "shop")).toBe("prompt");
  });

  it("never prompts on a dirty flag with no open name (defensive)", () => {
    expect(decideSwitch({ openName: null, dirty: true }, "shop")).toBe("proceed");
  });
});
