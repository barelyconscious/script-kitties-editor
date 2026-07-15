# Feature: Abilities & Biograms in Bundles

Bundles today hold a list of **creatures** (a creature `id` + optional draw-time
overrides). This feature adds two sibling collections to a bundle — **abilities**
and **biograms** — each an array of a dedicated `Bundle*` member type so the same
`{ id }`-plus-overrides pattern that creatures use can be reused and extended.

The end state: the Bundle editor shows three collection sections — Creatures,
Abilities, Biograms — each with an "Add …" picker and a grid of member cards that
carry optional name / sprite / description overrides.

## Scope decision (already made)

Ability and biogram members carry the **name / sprite / description** override
trio (both entities have those three fields; it mirrors creatures). They do **not**
get stat overrides or ability-list overrides — those are creature-specific. The
member types are dedicated structs, so more override fields can be added later
without a data migration.

## Tasks (in dependency order)

1. **[01-backend-rust-model.md](./01-backend-rust-model.md)** — Add `BundleAbility`
   / `BundleBiogram` structs and the two new `Vec` fields on `Bundle`. Backend only.
2. **[02-frontend-data-layer.md](./02-frontend-data-layer.md)** — Add the mirror TS
   types, extend `saveBundle` normalization, and initialize the new arrays in the
   new-bundle factory. Depends on nothing at runtime but mirrors task 1's shapes.
3. **[03-bundle-editor-ui.md](./03-bundle-editor-ui.md)** — Add the Abilities and
   Biograms sections to `BundleEditorPane`. Depends on task 2's types.

Each file is self-contained; a fresh agent can implement any one from its file
alone. Tasks 1 and 2 can run in parallel; task 3 needs task 2's types.

## Backward compatibility

Existing `bundles.json` files have no `abilities`/`biograms` keys. `#[serde(default)]`
(Rust) and array guards (TS) mean old data loads as empty collections, and empty
collections are omitted on save — so untouched bundles produce zero diff.
