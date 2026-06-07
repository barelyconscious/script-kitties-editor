import { describe, expect, it } from "vitest";
import { type ApiItem, GAME_API } from "./gameApi";

/** Depth-first walk over the whole tree. */
function walk(
  items: ApiItem[],
  visit: (item: ApiItem, path: string[]) => void,
  path: string[] = [],
) {
  for (const item of items) {
    const here = [...path, item.name];
    visit(item, here);
    if (item.members) walk(item.members, visit, here);
  }
}

/** Find a top-level item by name. */
function top(name: string): ApiItem | undefined {
  return GAME_API.find((i) => i.name === name);
}

/** Find a member by name within a top-level item. */
function member(parentName: string, memberName: string): ApiItem | undefined {
  return top(parentName)?.members?.find((m) => m.name === memberName);
}

describe("GAME_API well-formedness", () => {
  it("has no duplicate top-level names", () => {
    const names = GAME_API.map((i) => i.name);
    const dupes = names.filter((n, idx) => names.indexOf(n) !== idx);
    expect(dupes).toEqual([]);
  });

  it("gives every item (at any depth) a non-empty name and a type", () => {
    const offenders: string[] = [];
    walk(GAME_API, (item, path) => {
      if (!item.name || item.name.trim() === "") offenders.push(`empty name at ${path.join(".")}`);
      if (!item.type) offenders.push(`missing type at ${path.join(".")}`);
    });
    expect(offenders).toEqual([]);
  });

  it("only allows duplicate member names where the game genuinely overloads", () => {
    // Member names may repeat only as deliberate overloads. We pin the known
    // ones so an accidental copy-paste duplicate elsewhere is caught.
    const allowedOverloads = new Set(["Creature.removeEffect", "BattleState.isFriendly"]);
    const offenders: string[] = [];
    walk(GAME_API, (item) => {
      if (!item.members) return;
      const seen = new Map<string, number>();
      for (const m of item.members) seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
      for (const [memberName, count] of seen) {
        if (count > 1 && !allowedOverloads.has(`${item.name}.${memberName}`)) {
          offenders.push(`${item.name}.${memberName} appears ${count} times`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });

  it("gives functions/methods well-formed args (each with name + type)", () => {
    const offenders: string[] = [];
    walk(GAME_API, (item, path) => {
      if (!item.args) return;
      for (const arg of item.args) {
        if (!arg.name || !arg.type) offenders.push(`bad arg on ${path.join(".")}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe("GAME_API merged surface coverage", () => {
  // Globals from both predecessor sources.
  it("includes GetBag (in both sources) with completion + return info", () => {
    const getBag = top("GetBag");
    expect(getBag).toBeDefined();
    expect(getBag?.returns?.type).toBe("Inventory"); // from gameApi.ts
    expect(getBag?.insertText).toContain("GetBag"); // from CompletionProvider
  });

  it("includes GetParty (only in CompletionProvider) — not dropped", () => {
    expect(top("GetParty")).toBeDefined();
  });

  it("includes GetStore (in both) with its worked example preserved", () => {
    const store = top("GetStore");
    expect(store?.examples?.length).toBeGreaterThan(0);
    expect(store?.insertText).toBeDefined();
  });

  // Combat / battle surface, reconciled into Combat and BattleState.
  it("exposes combat.caster as a member of Combat", () => {
    const caster = member("Combat", "caster");
    expect(caster).toBeDefined();
    expect(caster?.detail).toBe("BattleCreature");
  });

  it("exposes battle:findCreatures as a member of BattleState", () => {
    const find = member("BattleState", "findCreatures");
    expect(find).toBeDefined();
    expect(find?.returns?.type).toBe("BattleCreature[]");
  });

  it("keeps battle:isSelected (only in CompletionProvider) on BattleState", () => {
    expect(member("BattleState", "isSelected")).toBeDefined();
  });

  // Enums / constant namespaces.
  it("includes the full CombatAction enum values", () => {
    const ca = top("CombatAction");
    const values = (ca?.members ?? []).map((m) => m.name);
    for (const v of [
      "DAMAGE",
      "HEALING",
      "APPLY_EFFECT",
      "REMOVE_EFFECT",
      "MOVE",
      "SPRITE_ANIMATION",
      "SET_ARENA_EFFECT",
      "CREATE_ENTITY",
    ]) {
      expect(values).toContain(v);
    }
  });

  it("includes the full DamageType enum values", () => {
    const dt = top("DamageType");
    const values = (dt?.members ?? []).map((m) => m.name);
    for (const v of ["PHYSICAL", "FIRE", "WATER", "ELECTRIC", "POISON", "FROST", "TECHNICAL"]) {
      expect(values).toContain(v);
    }
  });

  it("includes ArenaEffects (only in CompletionProvider) with its members", () => {
    const ae = top("ArenaEffects");
    expect(ae).toBeDefined();
    const values = (ae?.members ?? []).map((m) => m.name);
    expect(values).toContain("frozen");
    expect(values).toContain("burning");
    expect(values).toContain("electrified");
  });

  // Lua language surface (only in CompletionProvider).
  it("includes Lua keywords", () => {
    const kw = top("keywords");
    const names = (kw?.members ?? []).map((m) => m.name);
    for (const k of ["function", "local", "end", "return", "then"]) {
      expect(names).toContain(k);
    }
  });

  it("includes the Lua stdlib (string/table/math libraries + globals)", () => {
    expect(top("string")?.members?.some((m) => m.name === "find")).toBe(true);
    expect(top("table")?.members?.some((m) => m.name === "insert")).toBe(true);
    expect(top("math")?.members?.some((m) => m.name === "floor")).toBe(true);
    expect(top("print")).toBeDefined();
  });

  // Per-entity self.* surface (only in CompletionProvider).
  it("includes the self namespace with entity-scoped members", () => {
    const self = top("self");
    expect(self).toBeDefined();
    const names = (self?.members ?? []).map((m) => m.name);
    expect(names).toContain("name");
    expect(names).toContain("cost"); // ability-only
    const cost = self?.members?.find((m) => m.name === "cost");
    expect(cost?.tags).toContain("ability");
  });

  // Core game types present.
  it("includes the core game types", () => {
    for (const t of ["Creature", "BattleCreature", "Ability", "Item", "Combat", "BattleState"]) {
      expect(top(t)).toBeDefined();
    }
  });
});
