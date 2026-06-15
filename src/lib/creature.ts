import { invoke } from "@tauri-apps/api/core";
import { CREATURE_STATS } from "@/lib/stats";

/** A level threshold at which a creature unlocks new abilities. */
export type CreatureLevelUp = {
  level: number;
  abilitiesGained: string[];
};

export type Creature = {
  id: string;
  name: string;
  sprite: string;
  description: string;
  /** Mislabelled in the data — it's the creature's script, not an "ai controller". */
  aiController: string;
  /** Gacha rarity (a Registry `creatureRarities` value). Empty when unset. */
  rarity: string;
  baseStats: Record<string, number>;
  baseAbilities: string[];
  statGainsPerLevel: Record<string, number>;
  abilitiesByLevel: CreatureLevelUp[];
};

/** Structural equality for two creatures — the dirty check compares un-normalized drafts. */
export function sameCreature(a: Creature, b: Creature): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Highest level we project to in the progression chart / previews. */
export const MAX_LEVEL = 25;

/** Levels 1..MAX_LEVEL — the x-axis of every projection. */
export const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

/**
 * A stat's value at a given level. Growth is linear: the base value at level 1
 * plus the per-level gain for each level beyond the first. (Verified against the
 * game: attack 12 + 120·15 = 1812 at level 16.)
 */
export function projectStat(base: number, gainPerLevel: number, level: number): number {
  return base + gainPerLevel * (level - 1);
}

/** A creature's projected value for `stat` across every level (index 0 = L1). */
export function projectStatSeries(creature: Creature, stat: string): number[] {
  const base = creature.baseStats[stat] ?? 0;
  const gain = creature.statGainsPerLevel[stat] ?? 0;
  return LEVELS.map((level) => projectStat(base, gain, level));
}

export type StatProgressionPoint = {
  level: number;
  value: number;
  average: number;
  max: number;
};

/**
 * Per-level progression for one creature's stat, alongside the population's
 * average and max at each level — the balancing reference. The population
 * includes every creature (so a creature can legitimately *be* the max).
 */
export function buildProgression(
  creature: Creature,
  population: Creature[],
  stat: string,
): StatProgressionPoint[] {
  const self = projectStatSeries(creature, stat);
  const others = population.map((c) => projectStatSeries(c, stat));

  return LEVELS.map((level, i) => {
    const atLevel = others.map((series) => series[i]);
    const sum = atLevel.reduce((a, b) => a + b, 0);
    return {
      level,
      value: self[i],
      average: atLevel.length ? sum / atLevel.length : 0,
      max: atLevel.length ? Math.max(...atLevel) : 0,
    };
  });
}

export async function loadCreatures(): Promise<Creature[]> {
  return invoke<Creature[]>("get_creatures");
}

/**
 * The population used for the progression chart's average/max, with the live
 * `draft` swapped in for its persisted counterpart (matched by id) so the
 * reference lines reflect in-progress edits. A `null` draft (nothing selected)
 * returns the population unchanged. Pure so both the standalone editor and the
 * Workbench pane share one definition and stay in sync.
 */
export function populationWithDraft(population: Creature[], draft: Creature | null): Creature[] {
  if (!draft) return population;
  return population.map((c) => (c.id === draft.id ? draft : c));
}

/**
 * Persist a creature. Mirrors the source data's conventions: `baseStats` keeps
 * its full ordered block (zeros included) while `statGainsPerLevel` carries only
 * the non-zero gains, so untouched stats don't churn the file.
 */
export async function saveCreature(creature: Creature): Promise<void> {
  const baseStats: Record<string, number> = {};
  for (const key of CREATURE_STATS) baseStats[key] = creature.baseStats[key] ?? 0;

  const statGainsPerLevel: Record<string, number> = {};
  for (const key of CREATURE_STATS) {
    const gain = creature.statGainsPerLevel[key] ?? 0;
    if (gain !== 0) statGainsPerLevel[key] = gain;
  }

  await invoke("save_creature", {
    creature: { ...creature, baseStats, statGainsPerLevel },
  });
}
