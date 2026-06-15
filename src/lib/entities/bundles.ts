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
  await invoke("save_bundle", { bundle: { ...bundle, creatures } });
}
