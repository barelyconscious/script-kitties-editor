# Task 02 — Frontend data layer: bundle ability/biogram types, save normalization, new-object factory

## Goal

Mirror the backend's new bundle member collections in the frontend data layer:
add `BundleAbility` / `BundleBiogram` TypeScript types, add `abilities` and
`biograms` arrays to the `Bundle` type, extend `saveBundle` to strip empty
overrides for the new arrays, and initialize the arrays when a new bundle is
created. **No UI in this task** (that's task 03) — this is the types + persistence
+ factory plumbing only.

## Context

`script-kitties-editor` is a Tauri 2 app; the React/TS frontend is in `src/`.
Bundle types + load/save wrappers live in `src/lib/entities/bundles.ts`. The
frontend calls Rust via `invoke("save_bundle", { bundle })`. Field names must be
camelCase to match the Rust structs (see task 01).

The bundle save path strips empty overrides so untouched members serialize as just
`{ id }` — this keeps `bundles.json` diffs minimal. The new arrays must follow the
same normalization.

### Backend shapes to mirror (from task 01, `src-tauri/src/model/mod.rs`)

`BundleAbility` and `BundleBiogram` are identical: `id: String` plus optional
`nameOverride`, `descriptionOverride`, `spriteOverride` (all `skip_serializing_if`
empty). `Bundle` gains `abilities: Vec<BundleAbility>` and `biograms:
Vec<BundleBiogram>`, both skipped when empty.

### Current `src/lib/entities/bundles.ts` (verbatim)

```ts
import { invoke } from "@tauri-apps/api/core";
import { nonZeroStats } from "@/lib/stats";

export type BundleCreature = {
  id: string;
  nameOverride?: string;
  descriptionOverride?: string;
  spriteOverride?: string;
  baseStatsOverride?: Record<string, number>;
  abilitiesOverride?: string[];
};

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
```

### Current new-object factory (`src/components/workbench/newObject.ts` ~line 302)

```ts
const BUNDLE_DESCRIPTOR: CreationDescriptor<Bundle> = {
  scriptPolicy: { kind: "none" },
  makeDefault: ({ id, name }) => ({
    id,
    name,
    description: "",
    sprite: "",
    creatures: [],
  }),
  save: saveBundle,
};
```

## Implementation

### 1. `src/lib/entities/bundles.ts`

Add the two member types (identical shape, both with the override trio):

```ts
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
```

Add the arrays to `Bundle` (required arrays, like `creatures`):

```ts
export type Bundle = {
  id: string;
  name: string;
  description: string;
  sprite?: string;
  creatures: BundleCreature[];
  abilities: BundleAbility[];
  biograms: BundleBiogram[];
};
```

Extend `saveBundle` to normalize the two new arrays the same way creatures are
normalized (strip empty-string overrides). Guard the source arrays with `?? []`
so a draft created before this field existed can't throw:

```ts
export async function saveBundle(bundle: Bundle): Promise<void> {
  const creatures: BundleCreature[] = bundle.creatures.map((c) => {
    /* …unchanged… */
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
```

> The helper is a suggestion — the requirement is that empty-string overrides are
> stripped and a member with none becomes `{ id }`. Match the file's existing style.

### 2. `src/components/workbench/newObject.ts`

Initialize the new arrays in `BUNDLE_DESCRIPTOR.makeDefault`:

```ts
  makeDefault: ({ id, name }) => ({
    id,
    name,
    description: "",
    sprite: "",
    creatures: [],
    abilities: [],
    biograms: [],
  }),
```

## Requirements / done-whens

### Functional
- [ ] `Bundle` type has `abilities: BundleAbility[]` and `biograms: BundleBiogram[]`.
- [ ] `BundleAbility` / `BundleBiogram` exported with `id` + optional
      name/description/sprite overrides.
- [ ] `saveBundle` strips empty-string overrides from both new arrays; a member
      with no overrides is sent as `{ id }`.
- [ ] `saveBundle` tolerates a draft where `abilities`/`biograms` are `undefined`
      (guarded with `?? []`) — no throw.
- [ ] A newly created bundle (via `newObject.ts`) has `abilities: []` and
      `biograms: []`.

### Nonfunctional
- [ ] `bunx tsc --noEmit` passes.
- [ ] `bunx biome check` passes on the two touched files
      (`src/lib/entities/bundles.ts`, `src/components/workbench/newObject.ts`).
- [ ] Field names are camelCase and exactly match the Rust structs from task 01.
- [ ] Types/comment style consistent with the existing `BundleCreature` definition.

## Verification

```
bunx tsc --noEmit
bunx biome check src/lib/entities/bundles.ts src/components/workbench/newObject.ts
bunx vitest run
```
If `src/components/workbench/newObject.test.ts` asserts the bundle default shape,
update it to include the two empty arrays. **Never run bare `bun test`** — it breaks
the `@/` path alias; use `bunx vitest run`.

## References

- `src/lib/entities/bundles.ts` — the type + save wrapper to edit (verbatim above).
- `src/components/workbench/newObject.ts` — `BUNDLE_DESCRIPTOR` ~line 302.
- `src/components/workbench/newObject.test.ts` — may assert bundle default shape.
- `src/lib/stats.ts` — `nonZeroStats` (already imported; used by the creatures path,
  unchanged).
- Upstream **01-backend-rust-model.md** defines the matching Rust structs — keep
  field names identical.
- Downstream **03-bundle-editor-ui.md** consumes these types.
