/**
 * dataVersion — a tiny app-wide "this entity list changed" signal, mirroring the
 * version-store half of {@link import("@/components/spriteNamesCache")}.
 *
 * The problem it solves is the same one the sprite-name cache solved: a surface
 * that loads an entity list ONCE on mount never learns when that list changes
 * elsewhere. The Workbench season editor loads abilities / creatures / biograms
 * when its tab mounts, so minting a NEW ability (via the "New" modal or the DATA
 * pane) leaves an already-open season tab serving its pre-create list until the
 * tab is remounted.
 *
 * The fix has the same shape as {@link import("@/components/spriteNamesCache")}:
 * every entity SAVE bumps a per-kind version, and a consumer threads
 * {@link useEntityVersion} into its load effect's deps so the effect re-runs and
 * re-fetches when the version changes. Unlike the sprite-name cache there is no
 * memoized list to drop here — the loaders (`get_*`) already hit the backend,
 * whose Moka cache is the authoritative memo — so this is purely the notify
 * signal, not a second cache.
 */

import { useSyncExternalStore } from "react";

/** The entity domains a consumer can watch. Add kinds as new watchers appear. */
export type EntityKind = "abilities" | "creatures" | "biograms";

/** Per-kind monotonic version, bumped on every save of that kind. */
const versions: Record<EntityKind, number> = {
  abilities: 0,
  creatures: 0,
  biograms: 0,
};

/** Subscribers — the store-change callbacks of each mounted watcher. */
const listeners = new Set<() => void>();

/**
 * Bump a kind's version and notify subscribers so open watchers re-fetch. Call
 * after a successful save of an entity of `kind` (the mutation chokepoint).
 */
export function bumpEntityVersion(kind: EntityKind): void {
  versions[kind] += 1;
  for (const notify of listeners) notify();
}

/**
 * Map a `save_*` Tauri command to the {@link EntityKind} it mutates, or null if
 * that command isn't watched. Lets the generic {@link import("@/components/data-tables/EntityDataTable").EntityDataTable}
 * bump the right kind after a command-based save without knowing the entity type.
 */
export function entityKindForSaveCommand(command: string): EntityKind | null {
  switch (command) {
    case "save_ability":
      return "abilities";
    case "save_creature":
      return "creatures";
    case "save_biogram":
      return "biograms";
    default:
      return null;
  }
}

/** {@link useSyncExternalStore} subscribe: register a listener, return cleanup. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/**
 * Subscribe to a kind's save signal. Returns a number that changes whenever an
 * entity of that kind is saved; thread it into a fetch effect's deps so the effect
 * re-runs and re-fetches.
 */
export function useEntityVersion(kind: EntityKind): number {
  return useSyncExternalStore(subscribe, () => versions[kind]);
}
