import { describe, expect, it } from "vitest";
import { anyTabDirty, removeTab, setTabDirty } from "./dirtyMap";

describe("anyTabDirty", () => {
  it("is false for an empty map", () => {
    expect(anyTabDirty({})).toBe(false);
  });

  it("is false when every tab is clean", () => {
    expect(anyTabDirty({ "Creature:1": false, "Item:2": false })).toBe(false);
  });

  it("is true when any tab is dirty", () => {
    expect(anyTabDirty({ "Creature:1": false, "Item:2": true })).toBe(true);
  });
});

describe("setTabDirty", () => {
  it("sets a new key's dirtiness", () => {
    expect(setTabDirty({}, "Item:2", true)).toEqual({ "Item:2": true });
  });

  it("updates an existing key", () => {
    expect(setTabDirty({ "Item:2": false }, "Item:2", true)).toEqual({ "Item:2": true });
  });

  it("returns the SAME reference when the value is unchanged", () => {
    const map = { "Item:2": true };
    expect(setTabDirty(map, "Item:2", true)).toBe(map);
  });

  it("does not mutate the input map", () => {
    const map = { "Item:2": false };
    setTabDirty(map, "Item:2", true);
    expect(map).toEqual({ "Item:2": false });
  });
});

describe("removeTab", () => {
  it("removes a present key", () => {
    expect(removeTab({ "Item:2": true, "Creature:1": false }, "Item:2")).toEqual({
      "Creature:1": false,
    });
  });

  it("returns the SAME reference when the key is absent", () => {
    const map = { "Item:2": true };
    expect(removeTab(map, "Creature:9")).toBe(map);
  });

  it("does not mutate the input map", () => {
    const map = { "Item:2": true };
    removeTab(map, "Item:2");
    expect(map).toEqual({ "Item:2": true });
  });
});
