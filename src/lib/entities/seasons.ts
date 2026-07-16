import { invoke } from "@tauri-apps/api/core";
import { nonZeroStats } from "@/lib/stats";

/**
 * One member of a season: a creature referenced by `id`, plus the optional
 * draw-time overrides applied when it's drawn from this season. Empty overrides
 * are absent in the data (the backend skips them) — the editor normalizes
 * missing values with `?? ""` / `?? {}` / `?? []`.
 */
export type SeasonCreature = {
  id: string;
  nameOverride?: string;
  descriptionOverride?: string;
  spriteOverride?: string;
  baseStatsOverride?: Record<string, number>;
  abilitiesOverride?: string[];
};

/**
 * One ability granted by a season: an ability referenced by `id`, plus optional
 * draw-time overrides. Empty overrides are absent in the data (the backend skips
 * them); the editor normalizes missing values with `?? ""`.
 */
export type SeasonAbility = {
  id: string;
  nameOverride?: string;
  descriptionOverride?: string;
  spriteOverride?: string;
};

/** One biogram granted by a season. Same shape/semantics as {@link SeasonAbility}. */
export type SeasonBiogram = {
  id: string;
  nameOverride?: string;
  descriptionOverride?: string;
  spriteOverride?: string;
};

/**
 * A gacha season: a named, customizable collection of creatures (seasons &
 * promotions). Mirrors the Rust `Season` (camelCase fields). Lives at
 * `Data/seasons.json` (an array, like every other entity file).
 */
export type Season = {
  id: string;
  name: string;
  description: string;
  sprite?: string;
  creatures: SeasonCreature[];
  abilities: SeasonAbility[];
  biograms: SeasonBiogram[];
};

export function loadSeasons(): Promise<Season[]> {
  return invoke<Season[]>("get_seasons");
}

/**
 * Persist a season, stripping empty overrides so untouched members stay minimal
 * in `seasons.json` — the same spirit as `saveCharm` / `saveCreature`. A member
 * with no overrides serializes as just `{ "id": … }`.
 */
export async function saveSeason(season: Season): Promise<void> {
  const creatures: SeasonCreature[] = season.creatures.map((c) => {
    const out: SeasonCreature = { id: c.id };
    if (c.nameOverride?.trim()) out.nameOverride = c.nameOverride;
    if (c.descriptionOverride?.trim()) out.descriptionOverride = c.descriptionOverride;
    if (c.spriteOverride?.trim()) out.spriteOverride = c.spriteOverride;
    const stats = Object.fromEntries(nonZeroStats(c.baseStatsOverride ?? {}));
    if (Object.keys(stats).length > 0) out.baseStatsOverride = stats;
    if (c.abilitiesOverride && c.abilitiesOverride.length > 0)
      out.abilitiesOverride = c.abilitiesOverride;
    return out;
  });

  const stripOverrides = <T extends SeasonAbility | SeasonBiogram>(m: T): T => {
    const out = { id: m.id } as T;
    if (m.nameOverride?.trim()) out.nameOverride = m.nameOverride;
    if (m.descriptionOverride?.trim()) out.descriptionOverride = m.descriptionOverride;
    if (m.spriteOverride?.trim()) out.spriteOverride = m.spriteOverride;
    return out;
  };
  const abilities = (season.abilities ?? []).map(stripOverrides);
  const biograms = (season.biograms ?? []).map(stripOverrides);

  await invoke("save_season", { season: { ...season, creatures, abilities, biograms } });
}
