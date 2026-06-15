import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri bridge so createObject's invoke("create_script", …) is
// observable and never touches a real backend.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock the entity save functions so we can assert the orchestrator's call
// sequence without persisting anything. Each is its own spy.
const saveAbilityMock = vi.fn();
const saveBiogramMock = vi.fn();
const saveEffectMock = vi.fn();
const saveItemRowMock = vi.fn();
const saveCharmMock = vi.fn();
const saveCreatureMock = vi.fn();

vi.mock("@/lib/entities/abilities", () => ({ saveAbility: (r: unknown) => saveAbilityMock(r) }));
vi.mock("@/lib/entities/biograms", () => ({ saveBiogram: (r: unknown) => saveBiogramMock(r) }));
vi.mock("@/lib/entities/effects", () => ({ saveEffect: (r: unknown) => saveEffectMock(r) }));
vi.mock("@/lib/entities/charms", () => ({ saveCharm: (r: unknown) => saveCharmMock(r) }));
vi.mock("@/lib/creature", () => ({ saveCreature: (r: unknown) => saveCreatureMock(r) }));
// items.ts exports both DEFAULT_DROP (used by the module) and saveItemRow (spied).
vi.mock("@/lib/items", () => ({
  saveItemRow: (r: unknown) => saveItemRowMock(r),
  DEFAULT_DROP: { rarity: "COMMON", value: 0, minLevel: 0, maxLevel: 0, biomes: [] },
}));

import type { GameObjectType } from "./gameObjects";
import {
  ABILITY_SCRIPT_TEMPLATE,
  BIOGRAM_SCRIPT_TEMPLATE,
  CHARM_SCRIPT_TEMPLATE,
  createObject,
  creationDescriptorFor,
  deriveId,
  EFFECT_SCRIPT_TEMPLATE,
  ITEM_SCRIPT_TEMPLATE,
  typeStem,
} from "./newObject";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  for (const m of [
    saveAbilityMock,
    saveBiogramMock,
    saveEffectMock,
    saveItemRowMock,
    saveCharmMock,
    saveCreatureMock,
  ]) {
    m.mockReset();
    m.mockResolvedValue(undefined);
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("deriveId", () => {
  it("lower-snake-cases a multi-word name", () => {
    expect(deriveId("Fire Bite")).toBe("fire_bite");
  });

  it("trims leading/trailing whitespace", () => {
    expect(deriveId("  Frost  ")).toBe("frost");
  });

  it("collapses repeated spaces into a single underscore", () => {
    expect(deriveId("Frost   Nova")).toBe("frost_nova");
  });

  it("strips punctuation and other non-id characters", () => {
    expect(deriveId("Fire! Bite?")).toBe("fire_bite");
    expect(deriveId("Mana-Burn (II)")).toBe("manaburn_ii");
  });

  it("collapses underscores left by stripped characters", () => {
    expect(deriveId("a & b")).toBe("a_b");
  });

  it("trims leading/trailing underscores", () => {
    expect(deriveId("  !Bite!  ")).toBe("bite");
    expect(deriveId("___bite___")).toBe("bite");
  });

  it("keeps digits and existing underscores", () => {
    expect(deriveId("Level 2 Heal")).toBe("level_2_heal");
  });

  it("returns empty for a name with no id-safe characters", () => {
    expect(deriveId("!!!")).toBe("");
  });
});

describe("typeStem", () => {
  it("joins the lowercased type with the id", () => {
    expect(typeStem("Ability", "bite")).toBe("ability_bite");
    expect(typeStem("Item", "bandage")).toBe("item_bandage");
  });
});

describe("makeDefault shapes", () => {
  const seed = { id: "bite", name: "Bite", script: "ability_bite.lua" };

  it("Ability: flat record with derived sprite/script and POINT defaults", () => {
    const r = creationDescriptorFor("Ability").makeDefault(seed);
    expect(r).toEqual({
      id: "bite",
      name: "Bite",
      sprite: "ability_bite.png",
      script: "ability_bite.lua",
      description: "",
      shape: "POINT",
      tags: [],
      range: 0,
      radius: 0,
      maxNumTargets: 1,
      cost: 0,
    });
  });

  it("Biogram: derived sprite/script, empty tags", () => {
    const r = creationDescriptorFor("Biogram").makeDefault({
      id: "calm",
      name: "Calm",
      script: "biogram_calm.lua",
    });
    expect(r).toEqual({
      id: "calm",
      name: "Calm",
      sprite: "biogram_calm.png",
      script: "biogram_calm.lua",
      description: "",
      tags: [],
    });
  });

  it("Effect: derived sprite/script, empty tags", () => {
    const r = creationDescriptorFor("Effect").makeDefault({
      id: "burn",
      name: "Burn",
      script: "effect_burn.lua",
    });
    expect(r).toEqual({
      id: "burn",
      name: "Burn",
      sprite: "effect_burn.png",
      script: "effect_burn.lua",
      description: "",
      tags: [],
    });
  });

  it("Item: joined ItemRow carries DEFAULT_DROP fields", () => {
    const r = creationDescriptorFor("Item").makeDefault({
      id: "bandage",
      name: "Bandage",
      script: "item_bandage.lua",
    });
    expect(r).toEqual({
      id: "bandage",
      name: "Bandage",
      sprite: "item_bandage.png",
      script: "item_bandage.lua",
      description: "",
      itemTags: [],
      rarity: "COMMON",
      value: 0,
      minLevel: 0,
      maxLevel: 0,
      biomes: [],
    });
  });

  it("Charm: empty stats and an empty (un-attached) script", () => {
    const r = creationDescriptorFor("Charm").makeDefault({ id: "luck", name: "Luck" });
    expect(r).toEqual({
      id: "luck",
      name: "Luck",
      sprite: "charm_luck.png",
      description: "",
      stats: {},
      // Optional script: empty when no name is seeded.
      script: "",
    });
  });

  it("Charm: stamps an attached script name when one is supplied", () => {
    const r = creationDescriptorFor("Charm").makeDefault({
      id: "luck",
      name: "Luck",
      script: "charm_luck.lua",
    });
    expect(r).toMatchObject({ script: "charm_luck.lua" });
  });

  it("Creature: BARE-stem sprite and an empty (un-attached) controller", () => {
    const r = creationDescriptorFor("Creature").makeDefault({ id: "bitlynx", name: "Bitlynx" });
    expect(r).toEqual({
      id: "bitlynx",
      name: "Bitlynx",
      // bare stem — no .png extension, per the creature sprite convention.
      sprite: "bitlynx",
      description: "",
      // Optional script: empty when none is attached.
      aiController: "",
      rarity: "",
      baseStats: {},
      baseAbilities: [],
      statGainsPerLevel: {},
      abilitiesByLevel: [],
    });
  });
});

describe("script policy", () => {
  it("flat script-bearing types use the create policy with the right template", () => {
    const cases: [GameObjectType, string][] = [
      ["Ability", ABILITY_SCRIPT_TEMPLATE],
      ["Biogram", BIOGRAM_SCRIPT_TEMPLATE],
      ["Effect", EFFECT_SCRIPT_TEMPLATE],
      ["Item", ITEM_SCRIPT_TEMPLATE],
    ];
    for (const [type, template] of cases) {
      const policy = creationDescriptorFor(type).scriptPolicy;
      expect(policy.kind, type).toBe("create");
      if (policy.kind === "create") {
        expect(policy.template, type).toBe(template);
      }
    }
  });

  it("Charm has an OPTIONAL create policy with the charm template", () => {
    const policy = creationDescriptorFor("Charm").scriptPolicy;
    expect(policy.kind).toBe("create");
    expect(policy).toMatchObject({ optional: true });
    if (policy.kind === "create") {
      expect(policy.template).toBe(CHARM_SCRIPT_TEMPLATE);
      expect(policy.deriveName("luck")).toBe("charm_luck.lua");
    }
  });

  it("Creature has an OPTIONAL shared policy pointing at ai_default.lua", () => {
    expect(creationDescriptorFor("Creature").scriptPolicy).toEqual({
      kind: "shared",
      defaultName: "ai_default.lua",
      optional: true,
    });
  });

  it("Item has an OPTIONAL create policy; intrinsic types are NOT optional", () => {
    expect(creationDescriptorFor("Item").scriptPolicy).toMatchObject({ optional: true });
    for (const t of ["Ability", "Biogram", "Effect"] as GameObjectType[]) {
      expect(creationDescriptorFor(t).scriptPolicy).not.toMatchObject({ optional: true });
    }
  });
});

describe("createObject — create-fresh policy", () => {
  it("writes the script BEFORE saving the record, with matching name/contents", async () => {
    const order: string[] = [];
    invokeMock.mockImplementation(async (cmd: string, args: unknown) => {
      order.push(`invoke:${cmd}`);
      void args;
    });
    saveAbilityMock.mockImplementation(async () => {
      order.push("save");
    });

    const result = await createObject("Ability", { name: "Bite", id: "bite" });

    expect(result.ok).toBe(true);
    expect(order).toEqual(["invoke:create_script", "save"]);
    expect(invokeMock).toHaveBeenCalledWith("create_script", {
      name: "ability_bite.lua",
      contents: ABILITY_SCRIPT_TEMPLATE,
    });
    // The saved record's script field agrees with the created file name.
    expect(saveAbilityMock.mock.calls[0][0]).toMatchObject({ script: "ability_bite.lua" });
  });

  it("aborts (does NOT save the record) when create_script fails, returning a script-step failure", async () => {
    invokeMock.mockRejectedValueOnce("disk full");

    const result = await createObject("Effect", { name: "Burn", id: "burn" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("script");
      expect(result.message).toContain("effect_burn.lua");
      expect(result.message).toContain("disk full");
    }
    expect(saveEffectMock).not.toHaveBeenCalled();
  });

  it("honors a user-supplied script override: create_script and the record use the CUSTOM name", async () => {
    const result = await createObject("Ability", {
      name: "Bite",
      id: "bite",
      script: "custom_bite.lua",
    });

    expect(result.ok).toBe(true);
    // The override drives the created file name...
    expect(invokeMock).toHaveBeenCalledWith("create_script", {
      name: "custom_bite.lua",
      contents: ABILITY_SCRIPT_TEMPLATE,
    });
    // ...and the saved record's script field agrees with it.
    expect(saveAbilityMock.mock.calls[0][0]).toMatchObject({ script: "custom_bite.lua" });
  });

  it("ignores a blank/whitespace-only override and falls back to the derived name", async () => {
    const result = await createObject("Ability", { name: "Bite", id: "bite", script: "   " });

    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("create_script", {
      name: "ability_bite.lua",
      contents: ABILITY_SCRIPT_TEMPLATE,
    });
    expect(saveAbilityMock.mock.calls[0][0]).toMatchObject({ script: "ability_bite.lua" });
  });

  it("returns a record-step failure when the entity save fails (after the script succeeds)", async () => {
    saveItemRowMock.mockRejectedValueOnce(new Error("write denied"));

    // Item is script-optional — opt in so the script step runs before the record.
    const result = await createObject("Item", {
      name: "Bandage",
      id: "bandage",
      attachScript: true,
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("record");
      expect(result.message).toContain("write denied");
    }
  });
});

describe("createObject — shared policy (Creature, optional)", () => {
  it("without attachScript: saves a SCRIPT-LESS record, never calling create_script", async () => {
    const result = await createObject("Creature", { name: "Bitlynx", id: "bitlynx" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(saveCreatureMock).toHaveBeenCalledTimes(1);
    expect(saveCreatureMock.mock.calls[0][0]).toMatchObject({
      id: "bitlynx",
      sprite: "bitlynx",
      // Optional script left OFF → empty controller, no shared default forced in.
      aiController: "",
    });
    expect(result.ok).toBe(true);
  });

  it("with attachScript: points at the shared ai_default.lua, still no create_script", async () => {
    const result = await createObject("Creature", {
      name: "Bitlynx",
      id: "bitlynx",
      attachScript: true,
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(saveCreatureMock.mock.calls[0][0]).toMatchObject({ aiController: "ai_default.lua" });
    expect(result.ok).toBe(true);
  });

  it("honors a user-supplied script override: aiController uses the CUSTOM value", async () => {
    const result = await createObject("Creature", {
      name: "Bitlynx",
      id: "bitlynx",
      attachScript: true,
      script: "ai_stalker.lua",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(saveCreatureMock.mock.calls[0][0]).toMatchObject({
      id: "bitlynx",
      aiController: "ai_stalker.lua",
    });
    expect(result.ok).toBe(true);
  });
});

describe("createObject — optional create policy (Charm)", () => {
  it("without attachScript: saves a SCRIPT-LESS charm, never calling create_script", async () => {
    const result = await createObject("Charm", { name: "Luck", id: "luck" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(saveCharmMock).toHaveBeenCalledTimes(1);
    expect(saveCharmMock.mock.calls[0][0]).toMatchObject({ id: "luck", stats: {}, script: "" });
    expect(result.ok).toBe(true);
  });

  it("with attachScript: mints a fresh charm script BEFORE the record", async () => {
    const order: string[] = [];
    invokeMock.mockImplementation(async (cmd: string) => {
      order.push(`invoke:${cmd}`);
    });
    saveCharmMock.mockImplementation(async () => {
      order.push("save");
    });

    const result = await createObject("Charm", { name: "Luck", id: "luck", attachScript: true });

    expect(result.ok).toBe(true);
    expect(order).toEqual(["invoke:create_script", "save"]);
    expect(invokeMock).toHaveBeenCalledWith("create_script", {
      name: "charm_luck.lua",
      contents: CHARM_SCRIPT_TEMPLATE,
    });
    expect(saveCharmMock.mock.calls[0][0]).toMatchObject({ script: "charm_luck.lua" });
  });
});

describe("createObject — optional types default to script-less", () => {
  it("an Item created without attachScript writes no file and an empty script", async () => {
    const result = await createObject("Item", { name: "Bandage", id: "bandage" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(saveItemRowMock).toHaveBeenCalledTimes(1);
    expect(saveItemRowMock.mock.calls[0][0]).toMatchObject({ id: "bandage", script: "" });
    expect(result.ok).toBe(true);
  });

  it("an Item created WITH attachScript mints its derived .lua", async () => {
    const result = await createObject("Item", {
      name: "Bandage",
      id: "bandage",
      attachScript: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("create_script", {
      name: "item_bandage.lua",
      contents: ITEM_SCRIPT_TEMPLATE,
    });
    expect(saveItemRowMock.mock.calls[0][0]).toMatchObject({ script: "item_bandage.lua" });
    expect(result.ok).toBe(true);
  });
});
