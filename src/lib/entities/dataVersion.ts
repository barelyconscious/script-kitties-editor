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
 *
 * TWO sources feed the signal:
 *  - in-app saves: every `saveX` wrapper (and `EntityDataTable`'s raw-command
 *    path) calls {@link bumpEntityVersion} after a successful write, and
 *  - external disk edits: the backend watcher emits `data-changed` with the
 *    changed domain's kind, which `useDataLiveReload` routes into the same bump
 *    (see `src/components/useDataLiveReload.ts`).
 * Subscribing a surface via {@link useEntityVersion} therefore covers BOTH
 * staleness sources at once. An own-save echoing back through the watcher just
 * causes a second bump — consumers re-fetch data equal to what they hold, so the
 * echo self-suppresses at the record level (no content registry needed).
 */

import { useSyncExternalStore } from "react";

/**
 * The entity domains a consumer can watch — one per `Data/*.json` domain file.
 * Kind strings MUST match the backend watcher's `data-changed` payloads
 * (`src-tauri/src/dal/mod.rs`, the invalidator table).
 */
export type EntityKind =
  | "abilities"
  | "biograms"
  | "charms"
  | "creatures"
  | "dlc"
  | "effects"
  | "items"
  | "itemDrops"
  | "seasons"
  | "packs";

/** Per-kind monotonic version, bumped on every save of that kind. */
const versions: Record<EntityKind, number> = {
  abilities: 0,
  biograms: 0,
  charms: 0,
  creatures: 0,
  dlc: 0,
  effects: 0,
  items: 0,
  itemDrops: 0,
  seasons: 0,
  packs: 0,
};

/** Whether an arbitrary string (e.g. a `data-changed` payload) names a watched kind. */
export function isEntityKind(value: string): value is EntityKind {
  return value in versions;
}

/** Subscribers — the store-change callbacks of each mounted watcher. */
const listeners = new Set<() => void>();

/**
 * Bump a kind's version and notify subscribers so open watchers re-fetch. Call
 * after a successful save of an entity of `kind` (the mutation chokepoint), or
 * when the backend reports that kind's file changed on disk (`data-changed`).
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
    case "save_biogram":
      return "biograms";
    case "save_charm":
      return "charms";
    case "save_creature":
      return "creatures";
    case "save_dlc":
      return "dlc";
    case "save_effect":
      return "effects";
    case "save_item":
      return "items";
    case "save_item_drop":
      return "itemDrops";
    case "save_season":
      return "seasons";
    case "save_pack":
      return "packs";
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

/**
 * Subscribe to SEVERAL kinds at once (e.g. the items surface watches both
 * `items` and `itemDrops` — its rows join the two files). Returns the SUM of the
 * kinds' versions — each bump is +1, so the sum changes on every save of any
 * watched kind; thread it into a fetch effect's deps like {@link useEntityVersion}.
 * `kinds` must be a stable reference (module scope or memoized) to keep the
 * snapshot cheap; identity changes just re-read, they don't resubscribe storms.
 */
export function useEntityVersions(kinds: readonly EntityKind[]): number {
  return useSyncExternalStore(subscribe, () => {
    let sum = 0;
    for (const kind of kinds) sum += versions[kind];
    return sum;
  });
}

/**
 * Subscribe to EVERY kind — for surfaces aggregating across all domains (the
 * Workbench object list's `get_game_objects`). Same sum semantics as
 * {@link useEntityVersions}.
 */
export function useAnyEntityVersion(): number {
  return useSyncExternalStore(subscribe, () => {
    let sum = 0;
    for (const kind in versions) sum += versions[kind as EntityKind];
    return sum;
  });
}
