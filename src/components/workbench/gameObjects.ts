/**
 * Frontend model + grouping/filtering logic for the Workbench object list,
 * mirroring the Rust `GameObject` returned by the `get_game_objects` command.
 *
 * IMPORTANT serialization note: the Rust `GameObjectType` enum has NO serde
 * rename, so its variants serialize as their PascalCase Rust names — hence the
 * union below is PascalCase, while every other field is camelCase.
 */

/** Mirrors Rust `GameObjectType` — serialized as bare PascalCase variant names. */
export type GameObjectType = "Ability" | "Biogram" | "Effect" | "Charm" | "Item" | "Creature";

/** Mirrors Rust `GameObject` (camelCase fields). */
export type GameObject = {
  objectType: GameObjectType;
  id: string;
  name: string;
  sprite: string;
  script: string;
  description: string;
};

/**
 * Display order of the object-list groups. Creatures lead (the headline editor),
 * then the script-bearing entities, with Charms (data-only today) last.
 */
export const GROUP_ORDER: readonly GameObjectType[] = [
  "Creature",
  "Ability",
  "Biogram",
  "Effect",
  "Item",
  "Charm",
];

/** Human-friendly plural label for each group header. */
export const GROUP_LABELS: Record<GameObjectType, string> = {
  Creature: "Creatures",
  Ability: "Abilities",
  Biogram: "Biograms",
  Effect: "Effects",
  Item: "Items",
  Charm: "Charms",
};

/** A group of objects sharing a type, ready to render under one header. */
export type GameObjectGroup = {
  type: GameObjectType;
  label: string;
  objects: GameObject[];
};

/** Whether a row should show the script affordance — purely data-driven. */
export function hasScript(obj: GameObject): boolean {
  return obj.script.trim().length > 0;
}

/**
 * How many game objects point at a given script file. Scripts are SHARED, not
 * 1:1 with objects, so a controller script may back several creatures/items at
 * once. The Workbench surfaces this count ("shared by N") so editing a shared
 * script is a sighted choice rather than a surprise.
 *
 * Matches on the exact `script` field. An empty/whitespace `scriptName` has no
 * reach (returns 0) — a script-less object shares nothing.
 */
export function scriptReach(objects: readonly GameObject[], scriptName: string): number {
  if (scriptName.trim().length === 0) return 0;
  let count = 0;
  for (const obj of objects) {
    if (obj.script === scriptName) count += 1;
  }
  return count;
}

/**
 * Case-insensitive match of an object against a search query, across name and
 * id. An empty/whitespace query matches everything.
 */
export function matchesQuery(obj: GameObject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return obj.name.toLowerCase().includes(q) || obj.id.toLowerCase().includes(q);
}

/**
 * Group objects by type into {@link GROUP_ORDER}, applying the cross-group
 * search filter. Within a group, objects are sorted by name (case-insensitive).
 * Groups that end up empty after filtering are dropped so the list stays tight.
 */
export function groupObjects(objects: readonly GameObject[], query: string): GameObjectGroup[] {
  const buckets = new Map<GameObjectType, GameObject[]>();
  for (const type of GROUP_ORDER) buckets.set(type, []);

  for (const obj of objects) {
    if (!matchesQuery(obj, query)) continue;
    const bucket = buckets.get(obj.objectType);
    // Guard against an unknown/future variant rather than dropping it silently.
    if (bucket) bucket.push(obj);
  }

  const groups: GameObjectGroup[] = [];
  for (const type of GROUP_ORDER) {
    const bucket = buckets.get(type) ?? [];
    if (bucket.length === 0) continue;
    bucket.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ type, label: GROUP_LABELS[type], objects: bucket });
  }
  return groups;
}

/**
 * Flatten grouped objects into a single ordered list, preserving group order
 * (and the within-group name sort). Used by the collapsed Workbench rail, which
 * renders sprites in the same order as the expanded list but without headers.
 */
export function flattenGroups(groups: readonly GameObjectGroup[]): GameObject[] {
  return groups.flatMap((group) => group.objects);
}
