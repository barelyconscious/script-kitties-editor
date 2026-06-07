import { describe, expect, it } from "vitest";
import { dataDescriptorFor, hasDataPane, selectById } from "./dataRegistry";
import type { GameObjectType } from "./gameObjects";

describe("dataDescriptorFor", () => {
  it("returns a descriptor for each schema-driven non-creature type", () => {
    const types: GameObjectType[] = ["Ability", "Biogram", "Effect", "Item", "Charm"];
    for (const t of types) {
      const d = dataDescriptorFor(t);
      expect(d, t).not.toBeNull();
      expect(Array.isArray(d?.fields)).toBe(true);
      expect(typeof d?.load).toBe("function");
      expect(typeof d?.save).toBe("function");
    }
  });

  it("returns null for Creature (bespoke form, not a schema pane)", () => {
    expect(dataDescriptorFor("Creature")).toBeNull();
  });

  it("each descriptor's schema includes the read-only id field", () => {
    const types: GameObjectType[] = ["Ability", "Biogram", "Effect", "Item", "Charm"];
    for (const t of types) {
      const d = dataDescriptorFor(t);
      const idField = d?.fields.find((f) => f.key === "id");
      expect(idField, t).toBeDefined();
      expect(idField?.readOnly, t).toBe(true);
    }
  });
});

describe("hasDataPane", () => {
  it("is true for schema-driven types and false for Creature", () => {
    expect(hasDataPane("Ability")).toBe(true);
    expect(hasDataPane("Item")).toBe(true);
    expect(hasDataPane("Charm")).toBe(true);
    expect(hasDataPane("Creature")).toBe(false);
  });
});

describe("selectById", () => {
  const records = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];

  it("finds the record matching the id", () => {
    expect(selectById(records, "b")).toEqual({ id: "b", name: "Beta" });
  });

  it("returns null when no record matches", () => {
    expect(selectById(records, "z")).toBeNull();
  });

  it("returns null for an empty record set", () => {
    expect(selectById([], "a")).toBeNull();
  });
});
