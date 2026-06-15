import { describe, expect, it } from "vitest";
import { type Creature, populationWithDraft } from "./creature";

function creature(id: string, attack: number): Creature {
  return {
    id,
    name: id,
    sprite: "",
    description: "",
    aiController: "",
    rarity: "",
    baseStats: { attack },
    baseAbilities: [],
    statGainsPerLevel: {},
    abilitiesByLevel: [],
  };
}

describe("populationWithDraft", () => {
  const pop = [creature("a", 10), creature("b", 20), creature("c", 30)];

  it("returns the population unchanged when the draft is null", () => {
    expect(populationWithDraft(pop, null)).toBe(pop);
  });

  it("swaps the live draft in for its persisted counterpart by id", () => {
    const draft = creature("b", 999);
    const result = populationWithDraft(pop, draft);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(pop[0]);
    expect(result[1]).toBe(draft);
    expect(result[2]).toBe(pop[2]);
  });

  it("preserves ordering and replaces only the matching id", () => {
    const draft = creature("b", 999);
    const result = populationWithDraft(pop, draft);
    expect(result.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(result.filter((c) => c === draft)).toHaveLength(1);
  });

  it("leaves the population effectively unchanged when the draft id is absent", () => {
    const draft = creature("z", 999);
    const result = populationWithDraft(pop, draft);
    expect(result).toEqual(pop);
    expect(result).not.toContain(draft);
  });

  it("does not mutate the input population", () => {
    const draft = creature("a", 999);
    populationWithDraft(pop, draft);
    expect(pop[0].baseStats.attack).toBe(10);
  });
});
