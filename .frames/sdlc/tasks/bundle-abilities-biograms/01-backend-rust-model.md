# Task 01 — Backend: add ability & biogram members to the `Bundle` model

## Goal

Extend the Rust `Bundle` model so a bundle can hold **abilities** and **biograms**
as sibling collections to its existing `creatures`, each an array of a dedicated
member struct (`BundleAbility` / `BundleBiogram`) that carries a required `id` plus
optional name / sprite / description overrides — mirroring `BundleCreature`.

This is a **backend-only** task. No frontend, no DAL, no command changes.

## Context

`script-kitties-editor` is a Tauri 2 app. The Rust backend lives in `src-tauri/`.
Bundles are a "gacha-authoring" entity persisted to `<gameInstallPath>/Data/bundles.json`
(a JSON array of `Bundle`). All model structs use `#[serde(rename_all = "camelCase")]`.

The bundle save/load path is **fully generic** — `dal/bundles.rs` deserializes the
whole `Bundle`, upserts by `id`, sorts, and writes the whole struct back. Adding
fields to the struct makes them round-trip automatically, so **`dal/bundles.rs`,
`commands/bundles.rs`, and `lib.rs` need no changes.** (Confirmed: `save_bundle`
just does `serde_json::from_str` → upsert → `serialize_pretty` → `atomic_write`.)

### Current shapes (verbatim, `src-tauri/src/model/mod.rs` ~line 177)

```rust
/// A gacha bundle … (doc comment above the struct)
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sprite: String,
    #[serde(default)]
    pub creatures: Vec<BundleCreature>,
}

/// One member of a `Bundle`: a reference to a creature by `id` plus the optional
/// per-creature overrides applied when the creature is drawn from this bundle.
/// Empty overrides are skipped on save so untouched members stay minimal.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleCreature {
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name_override: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description_override: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sprite_override: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub base_stats_override: BTreeMap<String, i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub abilities_override: Vec<String>,
}
```

`BTreeMap` is already imported in this module (used by `BundleCreature`).

## Implementation

In `src-tauri/src/model/mod.rs`:

1. Add two new member structs near `BundleCreature`. They carry only the
   name/sprite/description override trio (no stat/ability overrides — those are
   creature-specific):

   ```rust
   /// One ability granted by a `Bundle`, referenced by `id`, plus optional
   /// draw-time overrides. Empty overrides are skipped on save.
   #[derive(Serialize, Deserialize)]
   #[serde(rename_all = "camelCase")]
   pub struct BundleAbility {
       pub id: String,
       #[serde(default, skip_serializing_if = "String::is_empty")]
       pub name_override: String,
       #[serde(default, skip_serializing_if = "String::is_empty")]
       pub description_override: String,
       #[serde(default, skip_serializing_if = "String::is_empty")]
       pub sprite_override: String,
   }

   /// One biogram granted by a `Bundle`, referenced by `id`, plus optional
   /// draw-time overrides. Empty overrides are skipped on save.
   #[derive(Serialize, Deserialize)]
   #[serde(rename_all = "camelCase")]
   pub struct BundleBiogram {
       pub id: String,
       #[serde(default, skip_serializing_if = "String::is_empty")]
       pub name_override: String,
       #[serde(default, skip_serializing_if = "String::is_empty")]
       pub description_override: String,
       #[serde(default, skip_serializing_if = "String::is_empty")]
       pub sprite_override: String,
   }
   ```

2. Add the two collections to `Bundle`, following the `creatures` pattern but
   skipping empties (so untouched bundles stay diff-free):

   ```rust
   #[serde(default, skip_serializing_if = "Vec::is_empty")]
   pub abilities: Vec<BundleAbility>,
   #[serde(default, skip_serializing_if = "Vec::is_empty")]
   pub biograms: Vec<BundleBiogram>,
   ```

   > Note: `creatures` uses `#[serde(default)]` **without** `skip_serializing_if`
   > (it always serializes, even when empty). For the two new fields, prefer
   > `skip_serializing_if = "Vec::is_empty"` so existing bundles that never touch
   > abilities/biograms don't gain empty `[]` keys. This is the intended behavior.

## Requirements / done-whens

### Functional
- [ ] `Bundle` deserializes `abilities` and `biograms` arrays from JSON (camelCase keys).
- [ ] `BundleAbility` and `BundleBiogram` each deserialize `id`, `nameOverride`,
      `descriptionOverride`, `spriteOverride`.
- [ ] A bundle with no `abilities`/`biograms` keys in JSON still deserializes
      (fields default to empty `Vec`). **This is the backward-compat guarantee for
      existing `bundles.json`.**
- [ ] On serialization, empty `abilities`/`biograms` are omitted from the JSON, and
      a member with no overrides serializes as `{ "id": "…" }`.

### Nonfunctional
- [ ] `cargo build` (run from `src-tauri/`) passes with no warnings introduced by
      this change.
- [ ] No changes to `dal/bundles.rs`, `commands/bundles.rs`, or `lib.rs`.
- [ ] Camel-case field names match what the frontend sends (`nameOverride`, etc.) —
      guaranteed by `#[serde(rename_all = "camelCase")]`.
- [ ] Field naming and doc-comment style match the existing `BundleCreature`.

## Verification

From `src-tauri/`:
```
cargo build
```
Optional manual round-trip check: hand-add an `"abilities": [{"id":"bite","nameOverride":"Chomp"}]`
entry to a bundle in `Data/bundles.json`, load it in the app (or via a unit test),
confirm it parses and re-serializes without dropping the override.

## References

- `src-tauri/src/model/mod.rs` — all bundle/pack structs live here (`Bundle` ~line
  177, `BundleCreature` ~line 192). Add the new structs adjacent to `BundleCreature`.
- `src-tauri/src/dal/bundles.rs` — the generic load/save path (read for confidence;
  do **not** edit). Shows why no DAL change is needed.
- `src-tauri/src/commands/bundles.rs` — `get_bundles` / `save_bundle` thin wrappers
  (no change).
- Downstream task **02-frontend-data-layer.md** mirrors these exact shapes in
  TypeScript — keep field names in sync.
