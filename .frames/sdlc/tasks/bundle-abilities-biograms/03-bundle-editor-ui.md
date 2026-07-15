# Task 03 — Bundle editor UI: Abilities & Biograms sections

## Goal

Add two new collection sections — **Abilities** and **Biograms** — to the bundle
editor (`BundleEditorPane.tsx`), each mirroring the existing **Creatures** section:
an "Add …" picker in the header and a responsive grid of member cards. Each ability/
biogram card shows the base entity (icon + name + id) and lets the user edit
**name / sprite / description** overrides, plus remove the member.

Depends on **task 02** (the `BundleAbility` / `BundleBiogram` types and the
`abilities` / `biograms` arrays on `Bundle`).

## Context

`script-kitties-editor` is a Tauri 2 app; frontend in `src/`. The bundle editor is
`src/components/workbench/BundleEditorPane.tsx` — a bespoke full-width pane for a
bundle tab. It:
- loads the bundle + the creature population + abilities on mount (`Promise.all`),
- tracks a `draft` (with undo/redo via `useHistoryState`) vs. a `loaded` baseline,
- auto-saves the draft (debounced) and registers a save target with the tab save bus,
- renders an **Identity** section then a **Creatures** section (an `AddCreaturePicker`
  header + a grid of `MemberCard`s).

You are adding two more sections after Creatures, following the same structure.

### Data shapes (from task 02, `src/lib/entities/bundles.ts`)

```ts
export type BundleAbility = { id: string; nameOverride?: string; descriptionOverride?: string; spriteOverride?: string };
export type BundleBiogram = { id: string; nameOverride?: string; descriptionOverride?: string; spriteOverride?: string };
export type Bundle = { id; name; description; sprite?; creatures: BundleCreature[]; abilities: BundleAbility[]; biograms: BundleBiogram[] };
```

### Entity populations you can load

- **Abilities** — `invoke("get_abilities")` returns full `Ability` records:
  `{ id, name, sprite, description, … }` (the pane currently narrows this to
  `{ id, name }[]` — widen it to also keep `sprite`).
- **Biograms** — `import { loadBiograms } from "@/lib/entities/biograms"` →
  `Biogram[]` where `Biogram = { id, name, sprite, script, description, tags }`.

Both entities expose `id`, `name`, `sprite`, `description` — enough for a card that
displays the base and shows override placeholders.

### Key existing code (from `BundleEditorPane.tsx`)

The creatures section is the template. Relevant existing pieces:

- **Load (mount effect):** `Promise.all([loadBundles(), loadCreatures(), invoke("get_abilities")])`
  then `setPopulation`, `setAbilities`, seed the draft. Extend this to also load
  biograms, and enrich the abilities load to keep `sprite`.
- **Draft mutators for creatures:**
  ```ts
  const setMember = (index, next) => setDraft({ ...draft, creatures: draft.creatures.map((m,i)=> i===index?next:m) });
  const removeMember = (index) => setDraft({ ...draft, creatures: draft.creatures.filter((_,i)=> i!==index) });
  const addMember = (creatureId) => { if (draft.creatures.some(m=>m.id===creatureId)) return; setDraft({ ...draft, creatures: [...draft.creatures, { id: creatureId }] }); };
  ```
- **Section markup** (Creatures) — a `<section>` with a header (`<h3>` + description +
  `<AddCreaturePicker>`), then either an empty-state `<p>` or a
  `[grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]` grid of `<MemberCard>`.
- **`AddCreaturePicker`** — a searchable `Popover` over `{id,name,sprite}`-ish options,
  disables already-added ids, calls `onAdd(id)`. **Generalize this** to `{ id, name, sprite }`
  options so all three sections reuse it.
- **`MemberCard`** — the creature card: sprite + name + id header, remove button,
  name/sprite/description override inputs, plus ability & stat override rows.
- **`AbilityPicker`** (`@/pages/creature-editor/AbilityPicker`) — a multi-select for
  the creature's `abilitiesOverride`. **Not** what the new sections need (they add a
  single member at a time, like `AddCreaturePicker`). Do not confuse the two.

## Implementation

### 1. Load abilities (with sprite) + biograms

- Widen the abilities state type from `{ id, name }` to include `sprite` (reuse a
  `{ id: string; name: string; sprite: string }` shape or a small local type). Add
  `loadBiograms()` to the mount `Promise.all` and store a biogram population.
- Build `byId` lookup maps for abilities and biograms (mirroring the existing
  creature `byId = new Map(population.map(c => [c.id, c]))`).

### 2. Draft mutators for the two new arrays

Add `set/remove/add` trios for `abilities` and `biograms`, mirroring the creature
mutators. Guard with `?? []` (`draft.abilities ?? []`) so drafts predating the field
don't throw. `add` inserts `{ id }` and is a no-op if the id is already present.

### 3. Two new sections

After the Creatures `<section>`, add an **Abilities** section and a **Biograms**
section, each following the creatures markup: header (`<h3>` + one-line description +
the shared add-picker) → empty-state `<p>` when the array is empty, otherwise the
`auto-fill,minmax(20rem,1fr)` grid of cards. Suggested copy:
- Abilities: "The abilities granted by this bundle. Override attributes applied when drawn."
- Biograms: "The biograms granted by this bundle. Override attributes applied when drawn."

### 4. Card + picker components

- **Generalize `AddCreaturePicker` → `AddMemberPicker`** taking `options: { id, name, sprite }[]`,
  `disabledIds`, `onAdd`, `container`, and a `label` (e.g. "Add creature" / "Add ability"
  / "Add biogram") + search placeholder. All three sections use it.
- **Add an `OverrideCard`** for abilities/biograms: header (base sprite via
  `<Sprite name={member.spriteOverride || base?.sprite || member.id} />`, base name,
  id, remove button) + name / sprite / description override fields. This is
  `MemberCard` minus the ability-override and stat-override rows. Reuse the existing
  `SpritePicker`, `Input`, `Textarea`, `Label`, `Button`, `Sprite` imports already in
  the file. You may keep `MemberCard` as-is for creatures and add a separate
  `OverrideCard` for the two simpler collections, or factor a shared header — either
  is fine; prefer the smaller diff.

Pass `portalContainer` through to the sprite pickers exactly as the creatures cards
do (the popovers portal into the `<div ref={setPortalContainer} />` at the bottom of
the pane so they scroll within it).

### 5. Wire through undo/save (should be automatic)

The draft is a single `Bundle` object; `setDraft` already records undo history and
triggers auto-save. As long as the new mutators go through `setDraft`, undo/redo and
autosave work with no extra wiring. Do **not** add separate save/undo targets.

## Requirements / done-whens

### Functional
- [ ] The pane renders three collection sections: Creatures, Abilities, Biograms.
- [ ] "Add ability" / "Add biogram" pickers list the live ability/biogram
      populations, are searchable, and disable ids already in the bundle.
- [ ] Adding a member appends `{ id }`; removing drops it; both are undoable (Ctrl+Z)
      and auto-saved.
- [ ] Each ability/biogram card shows the base entity's icon + name + id, and edits
      to name / sprite / description overrides persist to `bundles.json`.
- [ ] Empty-state copy shows for an ability/biogram section with no members.
- [ ] Override placeholders show the base entity's value (e.g. name override input
      placeholder = base name), mirroring creature cards.
- [ ] Reloading (or a live external edit via the `bundles`/`gui`-style watcher)
      shows the saved abilities/biograms.

### Nonfunctional
- [ ] `bunx tsc --noEmit` passes.
- [ ] `bunx biome check src/components/workbench/BundleEditorPane.tsx` passes (plus
      any other file touched).
- [ ] No duplicated add-picker logic — the three sections share one `AddMemberPicker`.
- [ ] Visual layout matches the Creatures section (same grid, spacing, card styling,
      section header pattern). Nothing regresses in the creatures section.
- [ ] No new save/undo targets registered; the single existing "data" save target
      still covers the whole draft.

## Verification

```
bunx tsc --noEmit
bunx biome check src/components/workbench/BundleEditorPane.tsx
bunx vitest run
```
Manual (via `bun tauri dev`): open a bundle, add an ability and a biogram, set a name
override on each, confirm the tab auto-saves, then reopen the bundle (or check
`Data/bundles.json`) and confirm the members + overrides persisted and that a member
with no overrides is stored as just `{ "id": "…" }`.

## References

- `src/components/workbench/BundleEditorPane.tsx` — **the file to edit.** Study the
  Creatures section, `MemberCard`, and `AddCreaturePicker` — they are the template.
- `src/lib/entities/bundles.ts` — `Bundle`, `BundleAbility`, `BundleBiogram` types
  (from task 02).
- `src/lib/entities/biograms.ts` — `loadBiograms()` → `Biogram[]`
  (`{ id, name, sprite, script, description, tags }`).
- `src-tauri/src/commands/abilities.rs` — `get_abilities` returns full `Ability`
  records (id, name, sprite, description, …); safe to keep `sprite`.
- `src/lib/entities/abilities.ts` — the `Ability` type.
- `src/components/data-tables/SpritePicker.tsx` — the sprite override input (already
  used in the pane).
- `src/components/Sprite.tsx` — renders a sprite by logical name.
- `src/pages/creature-editor/AbilityPicker.tsx` — the creature ability-override
  multi-select (context only; **not** used by the new sections).
- `src/components/workbench/StatOverridesGrid.tsx` — creature stat overrides (context
  only; abilities/biograms have no stat overrides).
