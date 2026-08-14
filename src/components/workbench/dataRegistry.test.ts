import { describe, expect, it } from "vitest";
import { classifyExternalRecord, dataDescriptorFor, hasDataPane, selectById } from "./dataRegistry";
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

describe("dataDescriptorFor kinds", () => {
  it("each descriptor declares at least one watched entity kind", () => {
    const types: GameObjectType[] = ["Ability", "Biogram", "Effect", "Item", "Charm"];
    for (const t of types) {
      const d = dataDescriptorFor(t);
      expect(d?.kinds.length, t).toBeGreaterThan(0);
    }
  });

  it("the item descriptor watches both sides of its join", () => {
    expect(dataDescriptorFor("Item")?.kinds).toEqual(["items", "itemDrops"]);
  });
});

describe("classifyExternalRecord", () => {
  const record = { id: "a", name: "Alpha", range: 3 };

  it("is 'none' when the fetched record equals the baseline (unchanged or own-save echo)", () => {
    expect(classifyExternalRecord({ ...record }, record, false)).toBe("none");
    // Content equality doubles as the echo filter even under unsaved edits.
    expect(classifyExternalRecord({ ...record }, record, true)).toBe("none");
  });

  it("is 'adopt' when the record changed and the pane is clean", () => {
    expect(classifyExternalRecord({ ...record, range: 5 }, record, false)).toBe("adopt");
  });

  it("is 'adopt' when there is no baseline yet (first data for this pane)", () => {
    expect(classifyExternalRecord(record, null, false)).toBe("adopt");
  });

  it("is 'conflict' when the record changed under unsaved edits", () => {
    expect(classifyExternalRecord({ ...record, range: 5 }, record, true)).toBe("conflict");
  });

  it("is 'missing' when the record no longer exists, regardless of dirtiness", () => {
    expect(classifyExternalRecord(null, record, false)).toBe("missing");
    expect(classifyExternalRecord(null, record, true)).toBe("missing");
  });

  it("compares structurally, not by reference", () => {
    const clone = JSON.parse(JSON.stringify(record));
    expect(classifyExternalRecord(clone, record, false)).toBe("none");
  });
});
