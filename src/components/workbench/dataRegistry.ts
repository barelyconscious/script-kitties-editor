import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { ABILITY_FIELDS, type Ability, loadAbilities, saveAbility } from "@/lib/entities/abilities";
import { BIOGRAM_FIELDS, type Biogram, loadBiograms, saveBiogram } from "@/lib/entities/biograms";
import { CHARM_FIELDS, type Charm, loadCharms, saveCharm } from "@/lib/entities/charms";
import { EFFECT_FIELDS, type Effect, loadEffects, saveEffect } from "@/lib/entities/effects";
import { ITEM_FIELDS, type ItemRow, loadItemRows, saveItemRow } from "@/lib/items";
import type { GameObjectType } from "./gameObjects";

/**
 * The write-side twin of the `get_game_objects` match arm: everything the DATA
 * pane needs to render and persist ONE object type's full per-domain record.
 *
 * `get_game_objects` is a LOSSY projection (id/name/sprite/script/description),
 * so the pane uses `load` to fetch the full records and `select` to find the one
 * being edited by id. `fields` is the SAME schema the Data Tables page uses
 * (single source of truth — see `src/lib/entities/*`), and `save` is the SAME
 * save function (so validation/normalization never diverges between surfaces).
 */
export type DataDescriptor<T extends { id: string }> = {
  fields: EntityField<T>[];
  load: () => Promise<T[]>;
  save: (draft: T) => Promise<void>;
};

// Each entry is internally well-typed against its own T; the registry erases T
// to a common `{ id: string }` bound so the pane can dispatch without generics.
// Creature is intentionally absent — its bespoke form is task 425.
const REGISTRY: Partial<Record<GameObjectType, DataDescriptor<{ id: string }>>> = {
  Ability: descriptor<Ability>({ fields: ABILITY_FIELDS, load: loadAbilities, save: saveAbility }),
  Biogram: descriptor<Biogram>({ fields: BIOGRAM_FIELDS, load: loadBiograms, save: saveBiogram }),
  Effect: descriptor<Effect>({ fields: EFFECT_FIELDS, load: loadEffects, save: saveEffect }),
  Item: descriptor<ItemRow>({ fields: ITEM_FIELDS, load: loadItemRows, save: saveItemRow }),
  Charm: descriptor<Charm>({ fields: CHARM_FIELDS, load: loadCharms, save: saveCharm }),
};

// Erase the concrete T to the common bound. The cast is sound because the DATA
// pane only ever pairs a descriptor with records produced by that same
// descriptor's `load` (same objectType), so no cross-type value can reach it.
function descriptor<T extends { id: string }>(
  d: DataDescriptor<T>,
): DataDescriptor<{ id: string }> {
  return d as unknown as DataDescriptor<{ id: string }>;
}

/**
 * Dispatch an objectType to its DATA descriptor. Returns `null` for Creature
 * (handled by a bespoke form, task 425) and for any unknown/future variant.
 */
export function dataDescriptorFor(
  objectType: GameObjectType,
): DataDescriptor<{ id: string }> | null {
  return REGISTRY[objectType] ?? null;
}

/** Whether an objectType has a schema-driven DATA pane (vs. the bespoke form). */
export function hasDataPane(objectType: GameObjectType): boolean {
  return objectType in REGISTRY;
}

/**
 * Find the record matching `id` within a freshly-loaded record set. Returned
 * separately (rather than inlined) so the by-id selection is unit-testable.
 */
export function selectById<T extends { id: string }>(records: readonly T[], id: string): T | null {
  return records.find((r) => r.id === id) ?? null;
}
