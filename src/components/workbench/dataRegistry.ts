import type { EntityField } from "@/components/data-tables/EntityEditDialog";
import { ABILITY_FIELDS, type Ability, loadAbilities, saveAbility } from "@/lib/entities/abilities";
import { BIOGRAM_FIELDS, type Biogram, loadBiograms, saveBiogram } from "@/lib/entities/biograms";
import { CHARM_WORKBENCH_FIELDS, type Charm, loadCharms, saveCharm } from "@/lib/entities/charms";
import type { EntityKind } from "@/lib/entities/dataVersion";
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
  /**
   * The entity-version kinds whose bump means `load()` may return different
   * records — usually one, but the item row joins two files. The DATA pane
   * threads these into `useEntityVersions` so it re-fetches on any save OR
   * external disk edit of those domains (see lib/entities/dataVersion).
   */
  kinds: readonly EntityKind[];
};

// Each entry is internally well-typed against its own T; the registry erases T
// to a common `{ id: string }` bound so the pane can dispatch without generics.
// Creature is intentionally absent — its bespoke form is task 425.
const REGISTRY: Partial<Record<GameObjectType, DataDescriptor<{ id: string }>>> = {
  Ability: descriptor<Ability>({
    fields: ABILITY_FIELDS,
    load: loadAbilities,
    save: saveAbility,
    kinds: ["abilities"],
  }),
  Biogram: descriptor<Biogram>({
    fields: BIOGRAM_FIELDS,
    load: loadBiograms,
    save: saveBiogram,
    kinds: ["biograms"],
  }),
  Effect: descriptor<Effect>({
    fields: EFFECT_FIELDS,
    load: loadEffects,
    save: saveEffect,
    kinds: ["effects"],
  }),
  Item: descriptor<ItemRow>({
    fields: ITEM_FIELDS,
    load: loadItemRows,
    save: saveItemRow,
    // The row joins items.json ⋈ itemDropTable.json — watch both sources.
    kinds: ["items", "itemDrops"],
  }),
  Charm: descriptor<Charm>({
    fields: CHARM_WORKBENCH_FIELDS,
    load: loadCharms,
    save: saveCharm,
    kinds: ["charms"],
  }),
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

/**
 * What a DATA editor should do with a freshly re-fetched record after a version
 * bump (an in-app save elsewhere, or an external disk edit). The same trust
 * model the script panes use (see `scriptDiskSync`):
 *
 *  - `"none"`     — the record matches the pane's baseline: either nothing about
 *                   THIS record changed, or the bump is the pane's own save
 *                   echoing back. Record-level content equality doubles as the
 *                   echo filter, so no last-write registry is needed.
 *  - `"adopt"`    — the record changed and the pane is clean: silently adopt.
 *  - `"conflict"` — the record changed under unsaved edits: warn before
 *                   clobbering (the caller confirms, then adopts or keeps).
 *  - `"missing"`  — the record no longer exists (deleted on disk). The caller
 *                   applies the same clean/dirty split before surfacing.
 *
 * Pure and extracted (mirroring the XGUI `liveReload` decision helpers) so the
 * decision table is unit-testable without React or Tauri.
 */
export type ExternalRecordChange = "none" | "adopt" | "conflict" | "missing";

export function classifyExternalRecord<T extends { id: string }>(
  fetched: T | null,
  baseline: T | null,
  dirty: boolean,
): ExternalRecordChange {
  if (!fetched) return "missing";
  // Same cheap structural compare the panes use for dirty-tracking.
  if (baseline != null && JSON.stringify(fetched) === JSON.stringify(baseline)) return "none";
  return dirty ? "conflict" : "adopt";
}
