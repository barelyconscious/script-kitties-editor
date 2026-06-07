import { describe, expect, it } from "vitest";
import {
  type GameObject,
  type GameObjectType,
  groupObjects,
  hasScript,
  matchesQuery,
} from "./gameObjects";

function obj(over: Partial<GameObject> & Pick<GameObject, "objectType" | "id">): GameObject {
  return {
    name: over.id,
    sprite: "",
    script: "",
    description: "",
    ...over,
  };
}

describe("hasScript", () => {
  it("is true for a non-empty script", () => {
    expect(hasScript(obj({ objectType: "Ability", id: "a", script: "x.lua" }))).toBe(true);
  });

  it("is false for an empty script", () => {
    expect(hasScript(obj({ objectType: "Charm", id: "c", script: "" }))).toBe(false);
  });

  it("is false for a whitespace-only script", () => {
    expect(hasScript(obj({ objectType: "Item", id: "i", script: "   " }))).toBe(false);
  });
});

describe("matchesQuery", () => {
  const o = obj({ objectType: "Creature", id: "bitlynx", name: "Bit Lynx" });

  it("matches everything on an empty query", () => {
    expect(matchesQuery(o, "")).toBe(true);
    expect(matchesQuery(o, "   ")).toBe(true);
  });

  it("matches on name, case-insensitively", () => {
    expect(matchesQuery(o, "lynx")).toBe(true);
    expect(matchesQuery(o, "BIT")).toBe(true);
  });

  it("matches on id", () => {
    expect(matchesQuery(o, "bitlynx")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesQuery(o, "dragon")).toBe(false);
  });
});

describe("groupObjects", () => {
  const objects: GameObject[] = [
    obj({ objectType: "Ability", id: "bite", name: "Bite" }),
    obj({ objectType: "Ability", id: "claw", name: "Claw" }),
    obj({ objectType: "Creature", id: "bitlynx", name: "Bit Lynx" }),
    obj({ objectType: "Charm", id: "luck", name: "Lucky Charm" }),
  ];

  it("groups objects into GROUP_ORDER, Creatures first", () => {
    const groups = groupObjects(objects, "");
    expect(groups.map((g) => g.type)).toEqual(["Creature", "Ability", "Charm"]);
  });

  it("sorts within a group by name", () => {
    const groups = groupObjects(
      [
        obj({ objectType: "Ability", id: "z", name: "Zeta" }),
        obj({ objectType: "Ability", id: "a", name: "Alpha" }),
      ],
      "",
    );
    expect(groups[0].objects.map((o) => o.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("drops groups that are empty after filtering", () => {
    const groups = groupObjects(objects, "bit");
    // "bit" matches Bite (Ability) and Bit Lynx / bitlynx (Creature) only.
    expect(groups.map((g) => g.type)).toEqual(["Creature", "Ability"]);
    expect(groups.find((g) => g.type === "Creature")?.objects).toHaveLength(1);
    expect(groups.find((g) => g.type === "Ability")?.objects).toHaveLength(1);
  });

  it("returns no groups when nothing matches", () => {
    expect(groupObjects(objects, "nonexistent")).toEqual([]);
  });

  it("ignores objects with an unknown type rather than throwing", () => {
    const weird = obj({
      objectType: "Mystery" as GameObjectType,
      id: "x",
      name: "X",
    });
    expect(groupObjects([...objects, weird], "")).toHaveLength(3);
  });
});
