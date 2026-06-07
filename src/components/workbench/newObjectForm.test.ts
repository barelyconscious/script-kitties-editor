import { describe, expect, it } from "vitest";
import type { GameObject, GameObjectType } from "./gameObjects";
import {
  deriveScript,
  hasScriptField,
  ID_PATTERN,
  initialFormState,
  isScriptOptional,
  isValid,
  type NewObjectFormState,
  reduceForm,
  showScriptName,
  validateNewObject,
} from "./newObjectForm";

/** Minimal GameObject fixture; only the fields the validators read matter. */
function obj(over: Partial<GameObject>): GameObject {
  return {
    objectType: "Ability",
    id: "x",
    name: "X",
    sprite: "",
    script: "",
    description: "",
    ...over,
  };
}

describe("initialFormState", () => {
  it("seeds empty name/id and clears the manual-edit flags", () => {
    const s = initialFormState("Ability");
    expect(s).toMatchObject({
      type: "Ability",
      name: "",
      id: "",
      idEdited: false,
      scriptEdited: false,
    });
  });

  it("seeds a create-policy script to the derived (empty-id) name", () => {
    // deriveName("") → "ability_.lua" — the field re-derives as soon as a name is typed.
    expect(initialFormState("Ability").script).toBe("ability_.lua");
  });

  it("seeds a shared-policy (Creature) script to its default", () => {
    expect(initialFormState("Creature").script).toBe("ai_default.lua");
  });

  it("seeds the staged charm script name even though it starts un-attached", () => {
    const s = initialFormState("Charm");
    expect(s.script).toBe("charm_.lua");
    expect(s.attachScript).toBe(false);
  });

  it("defaults attachScript OFF for optional types and ON for intrinsic ones", () => {
    for (const t of ["Item", "Charm", "Creature"] as GameObjectType[]) {
      expect(initialFormState(t).attachScript, t).toBe(false);
    }
    for (const t of ["Ability", "Biogram", "Effect"] as GameObjectType[]) {
      expect(initialFormState(t).attachScript, t).toBe(true);
    }
  });
});

describe("deriveScript / hasScriptField / isScriptOptional", () => {
  it("derives <type>_<id>.lua for create-policy types", () => {
    expect(deriveScript("Effect", "burn")).toBe("effect_burn.lua");
    expect(deriveScript("Item", "bandage")).toBe("item_bandage.lua");
    expect(deriveScript("Charm", "luck")).toBe("charm_luck.lua");
  });

  it("returns the shared default for Creature regardless of id", () => {
    expect(deriveScript("Creature", "bitlynx")).toBe("ai_default.lua");
  });

  it("reports a script field for every (now script-bearing) type", () => {
    for (const t of ["Ability", "Biogram", "Effect", "Item", "Charm", "Creature"] as const) {
      expect(hasScriptField(t), t).toBe(true);
    }
  });

  it("marks item/charm/creature optional and the intrinsic types not", () => {
    for (const t of ["Item", "Charm", "Creature"] as GameObjectType[]) {
      expect(isScriptOptional(t), t).toBe(true);
    }
    for (const t of ["Ability", "Biogram", "Effect"] as GameObjectType[]) {
      expect(isScriptOptional(t), t).toBe(false);
    }
  });
});

describe("showScriptName", () => {
  it("always shows the name field for intrinsic types", () => {
    expect(showScriptName(initialFormState("Ability"))).toBe(true);
  });

  it("hides the name field for an optional type until the toggle is on", () => {
    const off = initialFormState("Item");
    expect(showScriptName(off)).toBe(false);
    const on = reduceForm(off, { kind: "attachScript", value: true });
    expect(showScriptName(on)).toBe(true);
  });
});

describe("reduceForm — derivation chain", () => {
  it("editing name derives id and (create) script", () => {
    const s = reduceForm(initialFormState("Ability"), { kind: "name", value: "Fire Bite" });
    expect(s.id).toBe("fire_bite");
    expect(s.script).toBe("ability_fire_bite.lua");
    expect(s.idEdited).toBe(false);
    expect(s.scriptEdited).toBe(false);
  });

  it("a hand-edited id freezes against later name edits, but still drives the script", () => {
    let s = reduceForm(initialFormState("Ability"), { kind: "name", value: "Fire" });
    s = reduceForm(s, { kind: "id", value: "custom_id" });
    expect(s.idEdited).toBe(true);
    expect(s.script).toBe("ability_custom_id.lua");

    // A later name edit no longer touches the frozen id (nor, transitively, the script).
    s = reduceForm(s, { kind: "name", value: "Frost" });
    expect(s.id).toBe("custom_id");
    expect(s.script).toBe("ability_custom_id.lua");
  });

  it("a hand-edited script freezes against id and name changes", () => {
    let s = reduceForm(initialFormState("Ability"), { kind: "name", value: "Fire" });
    s = reduceForm(s, { kind: "script", value: "shared.lua" });
    expect(s.scriptEdited).toBe(true);

    s = reduceForm(s, { kind: "id", value: "blaze" });
    expect(s.id).toBe("blaze");
    expect(s.script).toBe("shared.lua");

    s = reduceForm(s, { kind: "name", value: "Inferno" });
    expect(s.script).toBe("shared.lua");
  });

  it("changing type re-derives the script under the new policy (when not hand-edited)", () => {
    let s = reduceForm(initialFormState("Ability"), { kind: "name", value: "Burn" });
    expect(s.script).toBe("ability_burn.lua");
    s = reduceForm(s, { kind: "type", value: "Effect" });
    expect(s.type).toBe("Effect");
    expect(s.id).toBe("burn"); // id preserved
    expect(s.script).toBe("effect_burn.lua");
  });

  it("changing type re-derives the script under each new policy", () => {
    let s = reduceForm(initialFormState("Ability"), { kind: "name", value: "Thing" });
    s = reduceForm(s, { kind: "type", value: "Creature" });
    expect(s.script).toBe("ai_default.lua");
    // Charm is a create-policy type now, so its name derives from the id.
    s = reduceForm(s, { kind: "type", value: "Charm" });
    expect(s.script).toBe("charm_thing.lua");
  });

  it("changing type re-seeds the attach default (optional OFF, intrinsic ON)", () => {
    // Start intrinsic (attach on), switch to an optional type → attach resets off.
    let s = reduceForm(initialFormState("Ability"), { kind: "type", value: "Item" });
    expect(s.attachScript).toBe(false);
    // ...and back to an intrinsic type → attach forced on.
    s = reduceForm(s, { kind: "type", value: "Effect" });
    expect(s.attachScript).toBe(true);
  });

  it("toggling attachScript on seeds the derived name; off leaves it for re-enabling", () => {
    let s = reduceForm(initialFormState("Item"), { kind: "name", value: "Bandage" });
    expect(s.attachScript).toBe(false);
    s = reduceForm(s, { kind: "attachScript", value: true });
    expect(s.attachScript).toBe(true);
    expect(s.script).toBe("item_bandage.lua");
    // A hand-edited name survives a toggle round-trip.
    s = reduceForm(s, { kind: "script", value: "custom.lua" });
    s = reduceForm(s, { kind: "attachScript", value: false });
    s = reduceForm(s, { kind: "attachScript", value: true });
    expect(s.script).toBe("custom.lua");
  });

  it("a hand-edited script survives a type change", () => {
    let s = reduceForm(initialFormState("Creature"), { kind: "name", value: "Bit" });
    s = reduceForm(s, { kind: "script", value: "ai_stalker.lua" });
    s = reduceForm(s, { kind: "type", value: "Ability" });
    expect(s.script).toBe("ai_stalker.lua");
  });
});

describe("validateNewObject", () => {
  const base: NewObjectFormState = {
    type: "Ability",
    name: "Bite",
    id: "bite",
    script: "ability_bite.lua",
    attachScript: true,
    idEdited: false,
    scriptEdited: false,
  };

  it("passes a clean form", () => {
    const errors = validateNewObject(base, []);
    expect(isValid(errors)).toBe(true);
  });

  it("requires a non-empty (trimmed) name", () => {
    expect(validateNewObject({ ...base, name: "   " }, []).name).toBeDefined();
  });

  it("requires a non-empty, lower_snake_case id", () => {
    expect(validateNewObject({ ...base, id: "" }, []).id).toBeDefined();
    expect(validateNewObject({ ...base, id: "Bad-Id" }, []).id).toBeDefined();
    expect(validateNewObject({ ...base, id: "good_id_2" }, []).id).toBeUndefined();
  });

  it("blocks an id COLLISION within the same type (silent-overwrite guard)", () => {
    const objects = [obj({ objectType: "Ability", id: "bite" })];
    const errors = validateNewObject(base, objects);
    expect(errors.id).toContain("already exists");
  });

  it("allows the same id under a DIFFERENT type", () => {
    const objects = [obj({ objectType: "Item", id: "bite" })];
    expect(validateNewObject(base, objects).id).toBeUndefined();
  });

  it("blocks a create-policy script collision", () => {
    const objects = [obj({ objectType: "Item", id: "other", script: "ability_bite.lua" })];
    expect(validateNewObject(base, objects).script).toContain("already used");
  });

  it("requires a create-policy script to end in .lua", () => {
    expect(validateNewObject({ ...base, script: "ability_bite" }, []).script).toBeDefined();
  });

  it("does NOT collision-check a shared (Creature) script, but still wants .lua", () => {
    const creature: NewObjectFormState = {
      type: "Creature",
      name: "Bitlynx",
      id: "bitlynx",
      script: "ai_default.lua",
      attachScript: true,
      idEdited: false,
      scriptEdited: false,
    };
    // Another creature already uses ai_default.lua — sharing is allowed.
    const objects = [obj({ objectType: "Creature", id: "other", script: "ai_default.lua" })];
    expect(validateNewObject(creature, objects).script).toBeUndefined();
    // ...but a non-.lua name is still rejected.
    expect(validateNewObject({ ...creature, script: "ai_default" }, []).script).toBeDefined();
  });

  it("skips script validation for an optional type with the toggle OFF", () => {
    const charm: NewObjectFormState = {
      type: "Charm",
      name: "Luck",
      id: "luck",
      // A junk script name is ignored while the script is not attached.
      script: "not-a-lua",
      attachScript: false,
      idEdited: false,
      scriptEdited: false,
    };
    expect(validateNewObject(charm, []).script).toBeUndefined();
    expect(isValid(validateNewObject(charm, []))).toBe(true);
  });

  it("validates the script for an optional type once the toggle is ON", () => {
    const charm: NewObjectFormState = {
      type: "Charm",
      name: "Luck",
      id: "luck",
      script: "not-a-lua",
      attachScript: true,
      idEdited: false,
      scriptEdited: false,
    };
    // Now the .lua rule bites...
    expect(validateNewObject(charm, []).script).toBeDefined();
    // ...and a create-policy charm collision is caught.
    const objects = [obj({ objectType: "Item", id: "x", script: "charm_luck.lua" })];
    expect(validateNewObject({ ...charm, script: "charm_luck.lua" }, objects).script).toContain(
      "already used",
    );
  });
});

describe("ID_PATTERN", () => {
  it("matches lower_snake_case and rejects other shapes", () => {
    for (const ok of ["a", "fire_bite", "level_2", "x_9_y"]) expect(ID_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "Fire", "fire-bite", "fire bite", "fire!"]) {
      expect(ID_PATTERN.test(bad as string)).toBe(false);
    }
  });
});

// Exhaustive sanity: every type has a coherent script field/derivation pairing.
describe("policy coverage", () => {
  it("every GameObjectType has a defined initial state", () => {
    const types: GameObjectType[] = ["Creature", "Ability", "Biogram", "Effect", "Item", "Charm"];
    for (const t of types) {
      const s = initialFormState(t);
      expect(s.type, t).toBe(t);
    }
  });
});
