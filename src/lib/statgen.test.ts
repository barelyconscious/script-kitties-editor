import { describe, expect, it } from "vitest";
import type { Creature } from "@/lib/creature";
import { applyRolledStats, rollCreatureStats } from "@/lib/statgen";

const PRIMARIES = ["health", "attack", "defense", "speed"] as const;

/** Draw many rolls once so distribution assertions share the sample. */
const SAMPLE = Array.from({ length: 4000 }, () => rollCreatureStats());

describe("rollCreatureStats", () => {
  it("always produces the five core base stats and four primary gains", () => {
    for (const roll of SAMPLE.slice(0, 200)) {
      for (const s of PRIMARIES) {
        expect(roll.baseStats[s]).toBeGreaterThanOrEqual(5);
        expect(Number.isInteger(roll.baseStats[s])).toBe(true);
        expect(roll.statGainsPerLevel[s]).toBeGreaterThan(0);
      }
      expect(roll.baseStats.luck).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(roll.baseStats.luck)).toBe(true);
      // Luck grows no per-level gain.
      expect(roll.statGainsPerLevel.luck).toBeUndefined();
    }
  });

  it("keeps the four-primary total within the starter band", () => {
    for (const roll of SAMPLE) {
      const total = PRIMARIES.reduce((sum, s) => sum + roll.baseStats[s], 0);
      // MIN_PRIMARY rounding can nudge the sum a hair past the clamp; allow slack.
      expect(total).toBeGreaterThanOrEqual(150);
      expect(total).toBeLessThanOrEqual(245);
    }
    const avg =
      SAMPLE.reduce((sum, r) => sum + PRIMARIES.reduce((a, s) => a + r.baseStats[s], 0), 0) /
      SAMPLE.length;
    // Should center near the 195 budget mean.
    expect(avg).toBeGreaterThan(185);
    expect(avg).toBeLessThan(205);
  });

  it("spreads the primaries rather than making them uniform", () => {
    // Average within-roll coefficient of variation should sit near the ~0.27
    // measured in the source distribution — not ~0 (all equal).
    const cvs = SAMPLE.map((r) => {
      const vals = PRIMARIES.map((s) => r.baseStats[s]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return Math.sqrt(variance) / mean;
    });
    const avgCv = cvs.reduce((a, b) => a + b, 0) / cvs.length;
    expect(avgCv).toBeGreaterThan(0.1);
    expect(avgCv).toBeLessThan(0.45);
  });

  it("rolls luck as a frequently-zero minor stat", () => {
    const zeros = SAMPLE.filter((r) => r.baseStats.luck === 0).length;
    const zeroFrac = zeros / SAMPLE.length;
    expect(zeroFrac).toBeGreaterThan(0.25);
    expect(zeroFrac).toBeLessThan(0.55);
    // Non-zero luck stays a small bonus.
    for (const r of SAMPLE) {
      if (r.baseStats.luck > 0) {
        expect(r.baseStats.luck).toBeGreaterThanOrEqual(8);
        expect(r.baseStats.luck).toBeLessThanOrEqual(24);
      }
    }
  });

  it("scales each primary's gain to its base value", () => {
    for (const roll of SAMPLE.slice(0, 500)) {
      for (const s of PRIMARIES) {
        const rate = roll.statGainsPerLevel[s] / roll.baseStats[s];
        // ~2–4.5% band, with rounding slack at small bases.
        expect(rate).toBeGreaterThan(0.01);
        expect(rate).toBeLessThan(0.06);
      }
    }
  });
});

describe("applyRolledStats", () => {
  const base: Creature = {
    id: "c1",
    name: "Test",
    sprite: "",
    animationGroup: "",
    description: "",
    aiController: "",
    rarity: "",
    baseStats: { health: 1, attack: 1, defense: 1, speed: 1, luck: 1, fireDamage: 7 },
    baseAbilities: [],
    statGainsPerLevel: { attack: 9, fireDamage: 3 },
    abilitiesByLevel: [],
  };

  it("replaces the core kit while preserving elements", () => {
    const roll = {
      baseStats: { health: 40, attack: 55, defense: 45, speed: 50, luck: 0 },
      statGainsPerLevel: { health: 1, attack: 1.4, defense: 1.1, speed: 1.2 },
    };
    const next = applyRolledStats(base, roll);

    expect(next.baseStats).toMatchObject(roll.baseStats);
    // Element base untouched.
    expect(next.baseStats.fireDamage).toBe(7);
    // Primary gains replaced, non-primary gain (fireDamage) preserved.
    expect(next.statGainsPerLevel.attack).toBe(1.4);
    expect(next.statGainsPerLevel.fireDamage).toBe(3);
    // Identity fields carried through unchanged.
    expect(next.id).toBe("c1");
  });
});
