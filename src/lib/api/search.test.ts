import { describe, expect, it } from "vitest";
import type { ApiItem } from "./gameApi";
import {
  buildTypeIndex,
  filterApiTree,
  formatSignature,
  hasSignature,
  isDrillable,
  isPrimitiveType,
  itemMatches,
  resolveTypeRef,
} from "./search";

const tree: ApiItem[] = [
  {
    name: "Creature",
    type: "object",
    documentation: "A creature out of combat.",
    members: [
      { name: "name", type: "property", documentation: "The name." },
      {
        name: "applyEffect",
        type: "method",
        documentation: "Applies an effect to the creature.",
        args: [
          { name: "effect", type: "string" },
          { name: "duration", type: "int" },
        ],
      },
    ],
  },
  {
    name: "GetBattleState",
    type: "function",
    documentation: "Returns the current battle.",
    returns: { type: "BattleState" },
  },
  {
    name: "math",
    type: "library",
    documentation: "Math helpers.",
    members: [{ name: "floor", type: "function", documentation: "Round down." }],
  },
];

describe("itemMatches", () => {
  it("matches on name, case-insensitively", () => {
    expect(itemMatches(tree[0], "creat")).toBe(true);
    expect(itemMatches(tree[0], "CREATURE")).toBe(true);
  });

  it("matches on documentation prose", () => {
    expect(itemMatches(tree[1], "current battle")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(itemMatches(tree[1], "inventory")).toBe(false);
  });

  it("treats an empty/whitespace query as a match", () => {
    expect(itemMatches(tree[0], "")).toBe(true);
    expect(itemMatches(tree[0], "   ")).toBe(true);
  });
});

describe("filterApiTree", () => {
  it("returns the input unchanged for an empty query", () => {
    expect(filterApiTree(tree, "")).toBe(tree);
    expect(filterApiTree(tree, "  ")).toBe(tree);
  });

  it("keeps a top-level item that matches by name", () => {
    const out = filterApiTree(tree, "GetBattleState");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("GetBattleState");
  });

  it("keeps the full member list of a directly-matched container", () => {
    const out = filterApiTree(tree, "Creature");
    expect(out).toHaveLength(1);
    // Both members are retained even though neither says "Creature".
    expect(out[0].members?.map((m) => m.name)).toEqual(["name", "applyEffect"]);
  });

  it("surfaces a deep member match and keeps the ancestor spine", () => {
    const out = filterApiTree(tree, "applyEffect");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Creature");
    // Only the matching member survives on the spine, not its sibling.
    expect(out[0].members?.map((m) => m.name)).toEqual(["applyEffect"]);
  });

  it("matches a member by its documentation prose", () => {
    const out = filterApiTree(tree, "round down");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("math");
    expect(out[0].members?.map((m) => m.name)).toEqual(["floor"]);
  });

  it("returns nothing when neither item nor descendants match", () => {
    expect(filterApiTree(tree, "zzzznope")).toEqual([]);
  });

  it("does not mutate the input tree", () => {
    const before = JSON.stringify(tree);
    filterApiTree(tree, "applyEffect");
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe("formatSignature", () => {
  it("renders args and a return type", () => {
    expect(
      formatSignature({
        args: [
          { name: "effect", type: "string" },
          { name: "duration", type: "int" },
        ],
        returns: { type: "bool" },
      }),
    ).toBe("(effect: string, duration: int) → bool");
  });

  it("renders empty parens with no args", () => {
    expect(formatSignature({ returns: { type: "Inventory" } })).toBe("() → Inventory");
  });

  it("omits the arrow when there is no return type", () => {
    expect(formatSignature({ args: [{ name: "x", type: "int" }] })).toBe("(x: int)");
  });
});

describe("hasSignature / isDrillable", () => {
  const creatureMembers = tree[0].members ?? [];

  it("treats functions and methods as having a signature", () => {
    expect(hasSignature(tree[1])).toBe(true); // function
    expect(hasSignature(creatureMembers[1])).toBe(true); // method
  });

  it("does not treat a plain property as having a signature", () => {
    expect(hasSignature(creatureMembers[0])).toBe(false);
  });

  it("reports drillable only for items with members", () => {
    expect(isDrillable(tree[0])).toBe(true);
    expect(isDrillable(tree[1])).toBe(false);
  });
});

describe("isPrimitiveType", () => {
  it("recognizes the closed primitive set", () => {
    for (const p of [
      "string",
      "int",
      "double",
      "bool",
      "table",
      "any",
      "void",
      "number",
      "function",
    ]) {
      expect(isPrimitiveType(p)).toBe(true);
    }
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(isPrimitiveType("Bool")).toBe(true);
    expect(isPrimitiveType("  int  ")).toBe(true);
  });

  it("does not treat a modeled type name as a primitive", () => {
    expect(isPrimitiveType("Creature")).toBe(false);
    expect(isPrimitiveType("BattleState")).toBe(false);
  });
});

describe("buildTypeIndex / resolveTypeRef", () => {
  const index = buildTypeIndex(tree);

  it("indexes top-level items by name", () => {
    expect(index.get("Creature")).toBe(tree[0]);
    expect(index.get("GetBattleState")).toBe(tree[1]);
    expect(index.size).toBe(3);
  });

  it("does not index nested members", () => {
    // `applyEffect` is a Creature member, not a top-level type.
    expect(index.get("applyEffect")).toBeUndefined();
  });

  it("resolves a known type name to its item", () => {
    expect(resolveTypeRef("Creature", index)).toBe(tree[0]);
  });

  it("strips a trailing [] before resolving array types", () => {
    expect(resolveTypeRef("Creature[]", index)).toBe(tree[0]);
  });

  it("returns null for an unknown type name", () => {
    expect(resolveTypeRef("Inventory", index)).toBeNull();
    expect(resolveTypeRef("Nope[]", index)).toBeNull();
  });

  it("returns null for a primitive (never indexed)", () => {
    expect(resolveTypeRef("string", index)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveTypeRef("  Creature  ", index)).toBe(tree[0]);
  });

  it("keeps only the first occurrence of a duplicated top-level name", () => {
    const dupes: ApiItem[] = [
      { name: "Dup", type: "object", documentation: "first" },
      { name: "Dup", type: "object", documentation: "second" },
    ];
    const idx = buildTypeIndex(dupes);
    expect(idx.get("Dup")?.documentation).toBe("first");
  });
});
