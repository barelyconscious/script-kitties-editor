import { describe, expect, it } from "vitest";
import { type EntityKind, entityKindForSaveCommand, isEntityKind } from "./dataVersion";

describe("entityKindForSaveCommand", () => {
  it("maps every domain save command to its kind", () => {
    const expected: Record<string, EntityKind> = {
      save_ability: "abilities",
      save_biogram: "biograms",
      save_charm: "charms",
      save_creature: "creatures",
      save_dlc: "dlc",
      save_effect: "effects",
      save_item: "items",
      save_item_drop: "itemDrops",
      save_season: "seasons",
      save_pack: "packs",
    };
    for (const [command, kind] of Object.entries(expected)) {
      expect(entityKindForSaveCommand(command), command).toBe(kind);
    }
  });

  it("returns null for unwatched commands", () => {
    expect(entityKindForSaveCommand("save_script")).toBeNull();
    expect(entityKindForSaveCommand("save_component")).toBeNull();
    expect(entityKindForSaveCommand("get_abilities")).toBeNull();
    expect(entityKindForSaveCommand("")).toBeNull();
  });
});

describe("isEntityKind", () => {
  it("accepts every kind the save-command mapping can produce", () => {
    const commands = [
      "save_ability",
      "save_biogram",
      "save_charm",
      "save_creature",
      "save_dlc",
      "save_effect",
      "save_item",
      "save_item_drop",
      "save_season",
      "save_pack",
    ];
    for (const command of commands) {
      const kind = entityKindForSaveCommand(command);
      expect(kind, command).not.toBeNull();
      if (kind) expect(isEntityKind(kind), kind).toBe(true);
    }
  });

  it("rejects the non-entity data-changed payloads (routed elsewhere)", () => {
    // "palette" and "assets" are valid `data-changed` payloads but are routed to
    // the palette / sprite-name caches, not the entity version store.
    expect(isEntityKind("palette")).toBe(false);
    expect(isEntityKind("assets")).toBe(false);
    expect(isEntityKind("gui")).toBe(false);
    expect(isEntityKind("")).toBe(false);
  });
});
