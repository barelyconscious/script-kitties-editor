import { describe, expect, it } from "vitest";
import {
  flattenGroups,
  type GameObject,
  type GameObjectType,
  groupObjects,
  hasScript,
  matchesQuery,
  scriptReach,
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

describe("scriptReach", () => {
  const objects: GameObject[] = [
    obj({ objectType: "Creature", id: "bitlynx", script: "ai_default.lua" }),
    obj({ objectType: "Creature", id: "bytecat", script: "ai_default.lua" }),
    obj({ objectType: "Creature", id: "solokit", script: "ai_solo.lua" }),
    obj({ objectType: "Charm", id: "ward", script: "" }),
  ];

  it("counts every object pointing at the same script", () => {
    expect(scriptReach(objects, "ai_default.lua")).toBe(2);
  });

  it("counts a script used by a single object", () => {
    expect(scriptReach(objects, "ai_solo.lua")).toBe(1);
  });

  it("is 0 for a script no object points at", () => {
    expect(scriptReach(objects, "ai_missing.lua")).toBe(0);
  });

  it("is 0 for an empty or whitespace script name (a script-less object shares nothing)", () => {
    expect(scriptReach(objects, "")).toBe(0);
    expect(scriptReach(objects, "   ")).toBe(0);
  });

  it("matches exactly — does not conflate distinct names", () => {
    const o = [obj({ objectType: "Item", id: "x", script: "ai_default.lua.bak" })];
    expect(scriptReach(o, "ai_default.lua")).toBe(0);
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

describe("flattenGroups", () => {
  const objects: GameObject[] = [
    obj({ objectType: "Ability", id: "z", name: "Zeta" }),
    obj({ objectType: "Ability", id: "a", name: "Alpha" }),
    obj({ objectType: "Creature", id: "bitlynx", name: "Bit Lynx" }),
    obj({ objectType: "Charm", id: "luck", name: "Lucky Charm" }),
  ];

  it("flattens groups into one list, preserving group then within-group order", () => {
    const flat = flattenGroups(groupObjects(objects, ""));
    // Creature group first, then Abilities sorted by name, then Charm.
    expect(flat.map((o) => o.id)).toEqual(["bitlynx", "a", "z", "luck"]);
  });

  it("is empty for no groups", () => {
    expect(flattenGroups([])).toEqual([]);
  });

  it("only includes objects surviving the search filter", () => {
    const flat = flattenGroups(groupObjects(objects, "bit"));
    expect(flat.map((o) => o.id)).toEqual(["bitlynx"]);
  });
});
