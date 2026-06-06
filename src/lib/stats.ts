import {
  Brain,
  Clover,
  Droplet,
  Flame,
  Heart,
  type LucideIcon,
  Shield,
  ShieldHalf,
  Skull,
  Snowflake,
  Sparkles,
  Sword,
  Wind,
  Zap,
} from "lucide-react";

/**
 * Shared metadata for every creature/charm stat key: a glyph + color + human
 * label. Keeping this in one place means charms and creatures read the same way
 * ("+3 ⚔") and a new stat only has to be described once.
 *
 * Defenses share the shield, tinted by their element; offenses get the
 * element's own icon. Insertion order is meaningful — it drives the order stats
 * appear in editors and dropdowns (core stats → element pairs).
 */
export const STAT_META: Record<string, { label: string; Icon: LucideIcon; color: string }> = {
  health: { label: "Health", Icon: Heart, color: "text-rose-400" },
  attack: { label: "Attack", Icon: Sword, color: "text-red-400" },
  defense: { label: "Defense", Icon: Shield, color: "text-slate-400" },
  specialAttack: { label: "Special Attack", Icon: Sparkles, color: "text-violet-400" },
  specialDefense: { label: "Special Defense", Icon: ShieldHalf, color: "text-violet-300" },
  speed: { label: "Speed", Icon: Wind, color: "text-cyan-400" },
  luck: { label: "Luck", Icon: Clover, color: "text-green-400" },
  memory: { label: "Memory", Icon: Brain, color: "text-fuchsia-400" },
  fireDamage: { label: "Fire Damage", Icon: Flame, color: "text-orange-400" },
  fireDefense: { label: "Fire Defense", Icon: Shield, color: "text-orange-300" },
  frostDamage: { label: "Frost Damage", Icon: Snowflake, color: "text-sky-400" },
  frostDefense: { label: "Frost Defense", Icon: Shield, color: "text-sky-300" },
  lightningDamage: { label: "Lightning Damage", Icon: Zap, color: "text-amber-400" },
  lightningDefense: { label: "Lightning Defense", Icon: Shield, color: "text-amber-300" },
  poisonDamage: { label: "Poison Damage", Icon: Skull, color: "text-green-500" },
  poisonDefense: { label: "Poison Defense", Icon: Shield, color: "text-emerald-400" },
  waterDamage: { label: "Water Damage", Icon: Droplet, color: "text-blue-400" },
};

/** All known stat keys, in canonical display order. */
export const STAT_KEYS = Object.keys(STAT_META);

/**
 * The stat block every creature carries. A fixed, ordered set so the editor's
 * grid is consistent across creatures (missing keys default to 0). Excludes
 * charm-only stats (memory, water) the creature data never uses.
 */
export const CREATURE_STATS = [
  "health",
  "attack",
  "defense",
  "specialAttack",
  "specialDefense",
  "speed",
  "luck",
  "fireDamage",
  "fireDefense",
  "frostDamage",
  "frostDefense",
  "lightningDamage",
  "lightningDefense",
  "poisonDamage",
  "poisonDefense",
];

/** Human label for a stat key, falling back to the raw key. */
export function statLabel(key: string): string {
  return STAT_META[key]?.label ?? key;
}

/** "+3" / "-1" — signed so buffs vs. debuffs read at a glance. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** Drop zero-valued entries — a +0 conveys nothing and just clutters a row. */
export function nonZeroStats(stats: Record<string, number>): [string, number][] {
  return Object.entries(stats).filter(([, v]) => v !== 0);
}
