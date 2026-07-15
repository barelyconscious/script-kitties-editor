import { invoke } from "@tauri-apps/api/core";
import { nonZeroStats } from "@/lib/stats";

/**
 * One member of a bundle: a creature referenced by `id`, plus the optional
 * draw-time overrides applied when it's drawn from this bundle. Empty overrides
 * are absent in the data (the backend skips them) — the editor normalizes
 * missing values with `?? ""` / `?? {}` / `?? []`.
 */
export type BundleCreature = {
  id: string;
  nameOverride?: string;
  descriptionOverride?: string;
  spriteOverride?: string;
  baseStatsOverride?: Record<string, number>;
  abilitiesOverride?: string[];
};

/**
 * One ability granted by a bundle: an ability referenced by `id`, plus optional
 * draw-time overrides. Empty overrides are absent in the data (the backend skips
 * them); the editor normalizes missing values with `?? ""`.
 */
export type BundleAbility = {
  id: string;
  nameOverride?: string;
  descriptionOverride?: string;
  spriteOverride?: string;
};

/** One biogram granted by a bundle. Same shape/semantics as {@link BundleAbility}. */
export type BundleBiogram = {
  id: string;
  nameOverride?: string;
  descriptionOverride?: string;
  spriteOverride?: string;
};

/**
 * A gacha bundle: a named, customizable collection of creatures (seasons &
 * promotions). Mirrors the Rust `Bundle` (camelCase fields). Lives at
 * `Data/bundles.json` (an array, like every other entity file).
 */
export type Bundle = {
  id: string;
  name: string;
  description: string;
  sprite?: string;
  creatures: BundleCreature[];
  abilities: BundleAbility[];
  biograms: BundleBiogram[];
};

export function loadBundles(): Promise<Bundle[]> {
  return invoke<Bundle[]>("get_bundles");
}

/**
 * Persist a bundle, stripping empty overrides so untouched members stay minimal
 * in `bundles.json` — the same spirit as `saveCharm` / `saveCreature`. A member
 * with no overrides serializes as just `{ "id": … }`.
 */
export async function saveBundle(bundle: Bundle): Promise<void> {
  const creatures: BundleCreature[] = bundle.creatures.map((c) => {
    const out: BundleCreature = { id: c.id };
    if (c.nameOverride?.trim()) out.nameOverride = c.nameOverride;
    if (c.descriptionOverride?.trim()) out.descriptionOverride = c.descriptionOverride;
    if (c.spriteOverride?.trim()) out.spriteOverride = c.spriteOverride;
    const stats = Object.fromEntries(nonZeroStats(c.baseStatsOverride ?? {}));
    if (Object.keys(stats).length > 0) out.baseStatsOverride = stats;
    if (c.abilitiesOverride && c.abilitiesOverride.length > 0)
      out.abilitiesOverride = c.abilitiesOverride;
    return out;
  });

  const stripOverrides = <T extends BundleAbility | BundleBiogram>(m: T): T => {
    const out = { id: m.id } as T;
    if (m.nameOverride?.trim()) out.nameOverride = m.nameOverride;
    if (m.descriptionOverride?.trim()) out.descriptionOverride = m.descriptionOverride;
    if (m.spriteOverride?.trim()) out.spriteOverride = m.spriteOverride;
    return out;
  };
  const abilities = (bundle.abilities ?? []).map(stripOverrides);
  const biograms = (bundle.biograms ?? []).map(stripOverrides);

  await invoke("save_bundle", { bundle: { ...bundle, creatures, abilities, biograms } });
}
