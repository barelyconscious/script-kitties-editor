# script-kitties-editor

Tauri 2 desktop app — an editor/inspector for the `worlds-cpp` game's data files. The app reads/writes the game's JSON data (abilities, creatures, items, etc.) from a configurable install directory. Product name: **Script Kitties Editor**.

## Stack

- **Frontend**: React 19 + TypeScript, Vite 6, Tailwind 4, shadcn/ui, Radix, Lucide icons
- **Backend**: Rust (Tauri 2), Serde, Moka (in-memory cache), notify (filesystem watcher), base64
- **Tooling**: Bun (package manager), Biome (lint/format)

## Layout

- `src/` — React frontend. Entry: `src/main.tsx` → `src/App.tsx`. A `NavRail` switches between tools: Workbench, Creature Editor, and Data Tables (`src/pages/`).
  - `src/pages/data-tables/` — one config per entity (abilities, biograms, effects, items) built on the generic `EntityDataTable`.
  - `src/components/data-tables/` — `EntityDataTable`, `EntityEditDialog` (schema-driven edit form), `SpritePicker`, `TagsSelect`/`TagsInput`.
  - `src/components/Sprite.tsx` — renders a sprite by logical name via the `get_sprite` command (data URL).
- `src-tauri/` — Rust backend.
  - `src/lib.rs` — registers Tauri commands and manages the `Dal` app state
  - `commands/` — `#[tauri::command]` handlers, thin wrappers over the DAL
  - `dal/` — data access layer. `Dal` owns per-domain Moka caches and a `notify` watcher that invalidates them on external file edits. One file per domain (`abilities`, `biograms`, `charms`, `creatures`, `dlc`, `effects`, `items`) plus `assets` (asset manifest) and `sprites`.
  - `model/` — Rust structs (`Ability`, `Creature`, `AssetEntry`, …)
  - `config/` — loads/creates `editor.conf.json`; runtime-updatable via the `save_config` command
  - `editor.conf.json` — points at the game install path (`gameInstallPath`)

## Data flow

- The game's `assets.json` manifest maps logical names (e.g. `ability_bite.png`) to on-disk paths under the install dir. `dal::assets` resolves them; `dal::sprites` reads + base64-encodes them.
- Domain reads are cached; saves re-read from disk, upsert, sort by `id`, and write atomically (temp file + rename) so diffs stay minimal. The watcher invalidates caches when files change outside the app.

## Tauri commands (frontend ↔ Rust bridge)

Defined in `src-tauri/src/lib.rs`. Per domain: `get_<domain>` / `save_<singular>` for abilities, biograms, charms, creatures, dlc, effects, items. Plus `get_config`/`save_config`, `get_sprite`/`list_sprites`, and `get_game_objects` (unified view across entities).

To add a new command: implement on `Dal` in `dal/`, add a thin wrapper in `commands/`, then register it in `invoke_handler![...]` in `lib.rs`.

## Scripts

- `bun dev` — Vite dev server (frontend only)
- `bun tauri dev` — full Tauri app (frontend + Rust)
- `bun build` — `tsc && vite build`
- `bun lint` / `bun format` — Biome

## State

Early development (v0.1.0). Data Tables (abilities, biograms, effects, items) browse + edit end-to-end. Charms (stats map) and the Creature Editor are not yet built out.
