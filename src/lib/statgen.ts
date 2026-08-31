import type { Creature } from "@/lib/creature";

/**
 * Procedural starter-tier stat roller for creatures.
 *
 * Modeled on the game's own creatures, whose base stats are lifted straight
 * from Pokémon starter-tier values (Adaline = Charmander's 39/52/43/·/65,
 * CaliGO = Bulbasaur, …). Analyzing the source distribution (Purukitto's
 * pokemon-data, 898 base forms) gave us the shape we reproduce here:
 *
 *  - A creature's four PRIMARY stats (health/attack/defense/speed) share a
 *    total "budget". Starter-tier creatures land around ~195 across those four
 *    (Adaline 199, Cattrix 205, COBOLynx 193, Bitlynx 169); we draw the budget
 *    from a narrow bell around that so most rolls feel comparable with room for
 *    the odd runt or bruiser.
 *  - Within a creature the stats are NOT uniform — the six Pokémon stats spread
 *    with a coefficient of variation around 0.27 (some balanced, some lopsided).
 *    We reproduce that by weighting each primary with an independent log-normal
 *    factor before normalizing to the budget, so a roll might be a glass-cannon
 *    or an even bruiser rather than four near-equal numbers.
 *  - LUCK is a minor stat in the source data (0–21, frequently 0), so it gets a
 *    separate small roll, often zero, rather than a share of the primary budget.
 *  - Per-level GAINS track the base: in the game's creatures a stat's gain is
 *    roughly 2–4.5% of its base per level (Adaline attack 52 → 1.35, health
 *    39 → 1.11). We roll each primary's gain in that band so growth stays in
 *    proportion to the starting spread.
 *
 * Elements and any existing gains outside the four primaries are left untouched
 * — this rolls the CORE kit, not a whole creature.
 */

/** The four stats that share the rolled budget, in canonical order. */
const PRIMARY_STATS = ["health", "attack", "defense", "speed"] as const;

/** Mean of the four-primary total; ~the tier the shipped creatures sit in. */
const BUDGET_MEAN = 195;
/** Spread of the total, so most rolls cluster but a few drift high/low. */
const BUDGET_SD = 18;
/** Hard clamp on the total, keeping every roll recognizably starter-tier. */
const BUDGET_MIN = 160;
const BUDGET_MAX = 235;

/** Log-normal sigma on each primary's weight; tuned to a within-roll CV ≈ 0.27. */
const WEIGHT_SPREAD = 0.28;
/** No primary should roll below this — a 0 in attack/health isn't playable. */
const MIN_PRIMARY = 5;

/** Chance a roll gives the creature no luck at all (matches the source data). */
const LUCK_ZERO_CHANCE = 0.4;
/** When luck IS rolled, it lands in this inclusive integer band. */
const LUCK_MIN = 8;
const LUCK_MAX = 24;

/** A primary's per-level gain as a fraction of its base value. */
const GAIN_RATE_MIN = 0.02;
const GAIN_RATE_MAX = 0.045;

/** A standard-normal sample via Box–Muller. */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Round to 2 decimals — gains carry two (e.g. 1.35), bases stay whole. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type RolledStats = {
  /** The five core base stats (health/attack/defense/speed/luck). */
  baseStats: Record<string, number>;
  /** Per-level gains for the four primary stats (luck grows none). */
  statGainsPerLevel: Record<string, number>;
};

/**
 * Roll a fresh starter-tier core stat kit: whole-number base values for the
 * five core stats plus a proportional per-level gain for each primary. Pure
 * apart from `Math.random`; see the module doc for the distribution it targets.
 */
export function rollCreatureStats(): RolledStats {
  // Draw the four-primary total, clamped to the starter band.
  const budget = Math.min(
    BUDGET_MAX,
    Math.max(BUDGET_MIN, Math.round(BUDGET_MEAN + gaussian() * BUDGET_SD)),
  );

  // Weight each primary log-normally, then normalize to the budget so the four
  // sum to it while spreading into balanced or lopsided kits.
  const weights = PRIMARY_STATS.map(() => Math.exp(gaussian() * WEIGHT_SPREAD));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const baseStats: Record<string, number> = {};
  const statGainsPerLevel: Record<string, number> = {};

  PRIMARY_STATS.forEach((stat, i) => {
    const base = Math.max(MIN_PRIMARY, Math.round((budget * weights[i]) / weightSum));
    baseStats[stat] = base;
    // Gain tracks the base — bigger stats grow faster, keeping the roll's
    // silhouette as the creature levels.
    const rate = GAIN_RATE_MIN + Math.random() * (GAIN_RATE_MAX - GAIN_RATE_MIN);
    statGainsPerLevel[stat] = round2(base * rate);
  });

  // Luck: usually nothing, otherwise a small flat bonus (no per-level growth).
  baseStats.luck =
    Math.random() < LUCK_ZERO_CHANCE
      ? 0
      : LUCK_MIN + Math.floor(Math.random() * (LUCK_MAX - LUCK_MIN + 1));

  return { baseStats, statGainsPerLevel };
}

/**
 * Apply a roll to a creature, replacing the five core base stats and the four
 * primary gains while leaving elements (and any non-primary gains) as they were.
 */
export function applyRolledStats(creature: Creature, roll: RolledStats): Creature {
  return {
    ...creature,
    baseStats: { ...creature.baseStats, ...roll.baseStats },
    statGainsPerLevel: { ...creature.statGainsPerLevel, ...roll.statGainsPerLevel },
  };
}
