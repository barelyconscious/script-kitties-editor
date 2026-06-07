---
name: game-objects-pascalcase-serialization
description: get_game_objects objectType serializes PascalCase (no serde rename) while all other fields are camelCase
metadata:
  type: project
---

`get_game_objects` returns `GameObject` whose `objectType` field serializes as bare PascalCase Rust variant names: `"Ability" | "Biogram" | "Effect" | "Charm" | "Item" | "Creature"`. The Rust `GameObjectType` enum (`src-tauri/src/model/mod.rs`) has NO `#[serde(rename_all)]`, unlike every other struct in that file which is camelCase.

**Why:** Easy to assume camelCase everywhere given the repo convention; the enum is the one exception and a mismatched TS union would silently drop rows.

**How to apply:** The TS mirror is in `src/components/workbench/gameObjects.ts` (`GameObjectType` union + `GameObject` type). Other GameObject fields (id, name, sprite, script, description) ARE camelCase. Charms have empty `script`; creatures' script comes from their `aiController` field. Script affordance is data-driven on `script` presence, never per-type.

Related: [[workbench-save-bus]]
