import { describe, expect, it } from "vitest";
import { defaultControllerFileName, normalizeControllerFileName } from "./controllerScript";

describe("defaultControllerFileName", () => {
  it("appends _controller.lua to the snake_case component name", () => {
    expect(defaultControllerFileName("bag")).toBe("bag_controller.lua");
  });

  it("snake_cases a mixed-case / spaced component name", () => {
    expect(defaultControllerFileName("Bag Slot")).toBe("bag_slot_controller.lua");
  });
});

describe("normalizeControllerFileName", () => {
  it("appends .lua when missing", () => {
    expect(normalizeControllerFileName("bag_controller")).toBe("bag_controller.lua");
  });

  it("keeps an existing .lua suffix without double-suffixing", () => {
    expect(normalizeControllerFileName("bag_controller.lua")).toBe("bag_controller.lua");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeControllerFileName("  custom.lua  ")).toBe("custom.lua");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeControllerFileName("   ")).toBe("");
  });
});
