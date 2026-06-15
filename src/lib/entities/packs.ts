import { invoke } from "@tauri-apps/api/core";

/**
 * The weighted draw configuration for one pack slot: which bundles can be drawn
 * from (by weight) and the rarity distribution (weights that should sum to 1).
 * Maps may be absent in the data when empty (the backend skips them).
 */
export type DrawRules = {
  bundles: Record<string, number>;
  rarity: Record<string, number>;
};

/** One card slot in a pack. For now a slot carries only its `drawRules`. */
export type PackSlot = {
  drawRules: DrawRules;
};

/**
 * A gacha pack: a card pack whose `slots` each define a draw pool. Mirrors the
 * Rust `Pack` (camelCase fields). Lives at `Data/packs.json` (an array).
 */
export type Pack = {
  id: string;
  name: string;
  description: string;
  sprite?: string;
  slots: PackSlot[];
};

export function loadPacks(): Promise<Pack[]> {
  return invoke<Pack[]>("get_packs");
}

/**
 * Persist a pack. Slots round-trip as authored; the backend skips empty weight
 * maps on write, so a slot with no rules serializes compactly.
 */
export async function savePack(pack: Pack): Promise<void> {
  await invoke("save_pack", { pack });
}
