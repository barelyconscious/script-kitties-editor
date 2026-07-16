# Backend

Rust + Tauri 2 in `src-tauri/src/`. A thin, layered pipeline: a command receives the
frontend call, the DAL does the work against a JSON file, Serde models define the shapes.
Start with [`README.md`](./README.md) for shared terms.

## Layers

- **`model/`** — Serde structs (`Creature`, `Ability`, `Charm`, `Item`, `Season`, `Pack`, …),
  all `#[serde(rename_all = "camelCase")]` so JSON/TS use camelCase. Sparse/optional fields
  use `#[serde(default, skip_serializing_if = …)]` to stay out of the JSON when empty.
- **`dal/`** — the **DAL**. One file per domain (`creatures`, `abilities`, `seasons`,
  `packs`, …). The `Dal` struct owns a **Moka cache** per domain and a **`notify` watcher**
  that invalidates a cache when its file changes outside the app. `dal::mod::data_dir()` =
  `<gameInstallPath>/Data`. Reads are cache-or-load; saves re-read, **upsert by `id`**,
  sort, and **write atomically** (temp + rename).
- **`commands/`** — `#[tauri::command]` functions, thin wrappers over the DAL. Per domain:
  `get_<domain>` / `save_<singular>`. Plus `get_game_objects` (the unified projection used
  by the Workbench), `get_config`/`save_config`, `get_registry`/`save_registry`, and the
  sprite/script commands.
- **`lib.rs`** — registers every command in `invoke_handler![…]` and manages the `Dal` as
  Tauri-managed app state.
- **`config/`** — loads/creates `editor.conf.json` (holds `gameInstallPath`); runtime-
  updatable via `save_config`.
- **`registry/`** — the editor-owned tweakable **enums**, persisted in
  `editor.registry.json` (separate from game data). Each enum field has a serde default so
  older files backfill new enums.

## Adding a command (the recipe)

1. Add/extend the struct in `model/`.
2. Implement `get_*` / `save_*` on `Dal` in a `dal/<domain>.rs` (cache field + watcher entry
   in `dal/mod.rs`).
3. Add the thin wrapper in `commands/<domain>.rs`.
4. Register it in `invoke_handler![…]` in `lib.rs`.

The frontend then calls it via `invoke("name", { argKey })` — arg keys are camelCase and
must match the Rust parameter names.

## Notes

- The game data repo (`worlds-cpp`) is separate; this app only reads/writes its `Data/*.json`
  and `assets.json` (the logical-name → on-disk-path manifest used to resolve sprites).
- Verify Rust changes with `cargo check` / `cargo build` from `src-tauri/`.
