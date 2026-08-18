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
 *
 * ── SCALING / KNOWN LANDMINES (read before optimizing, or if this feels slow) ──
 *
 * This design is deliberately COARSE and cheap-to-write, matching the sprite-name
 * / palette precedent. It scales fine for the editor's realistic data sizes
 * (hundreds of records per domain, a handful of open surfaces). The ceilings, and
 * the ONE lever that removes them, are documented here so a future reader who
 * trips a landmine knows it's a known trade-off, not a bug:
 *
 *  1. WHOLE-DOMAIN RE-FETCH, NOT PER-RECORD. A bump re-fetches the ENTIRE `get_*`
 *     array and re-parses it across the IPC bridge — the changed record isn't
 *     isolated. Cost per change ≈ O(domain size) × O(surfaces subscribed to that
 *     kind). Imperceptible at hundreds of records; the first thing to feel slow at
 *     tens of thousands.
 *  2. `useAnyEntityVersion` AMPLIFIES. The Workbench object list re-fetches
 *     `get_game_objects` (ALL domains) on ANY single entity change anywhere. It's
 *     the most expensive consumer and hits the ceiling first.
 *  3. DOUBLE-BUMP PER AUTO-SAVE. An auto-save fires TWO refresh waves: the in-app
 *     {@link bumpEntityVersion}, then the disk write echoes back through the
 *     watcher → `data-changed` → a second bump. A disk round-trip separates them,
 *     so they do NOT coalesce. The echo is a CORRECTNESS no-op (content equality
 *     via `classifyExternalRecord` catches it) but still pays a full
 *     fetch + parse + `JSON.stringify` compare to DISCOVER it's a no-op. This is
 *     the conscious trade-off vs. `scriptDiskSync`, which suppresses echoes BEFORE
 *     re-fetching via a last-write map: simpler here (no registry), more redundant
 *     work under active editing. Fine at small data; the scripts' pattern wins at
 *     large data.
 *  4. `window.confirm` (the dirty-editor conflict/deletion prompts in the panes)
 *     is BLOCKING. A burst of external edits landing while several tabs are dirty
 *     stacks sequential modal dialogs. Annoying, not broken — and identical to how
 *     the existing script / GUI live-reload already behave, so it's consistent.
 *
 *  THE LEVER (do NOT build preemptively — reach for it the day a domain file gets
 *  big enough to notice): carry the CHANGED IDS in the `data-changed` payload (the
 *  backend already upserts by id, so it knows them) and have consumers PATCH their
 *  local list instead of re-fetching the whole domain. That kills landmines #1 and
 *  #2 together and is a localized change — payload shape + a consumer merge step —
 *  that touches none of the subscription wiring here. Secondary levers: adopt the
 *  scripts' suppress-before-fetch echo filter (#3); coalesce a burst of bumps into
 *  one refresh on the next frame.
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
  | "packs"
  | "arenaSurfaces";

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
  arenaSurfaces: 0,
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
    case "save_arena_surface":
      return "arenaSurfaces";
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
