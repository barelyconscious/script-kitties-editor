# script-kitties-editor

Tauri 2 desktop app — an editor/inspector for the `worlds-cpp` game's data files. The app reads/writes the game's JSON data (abilities, creatures, items, charms, …) from a configurable install directory. Product name: **Script Kitties Editor**.

## Stack

- **Frontend**: React 19 + TypeScript, Vite 6, Tailwind 4, shadcn/ui, Radix, Lucide icons, Recharts (charts)
- **Backend**: Rust (Tauri 2), Serde, Moka (in-memory cache), notify (filesystem watcher), base64
- **Tooling**: Bun (package manager + runner), Biome (lint/format)

## Layout

- `src/` — React frontend. Entry: `src/main.tsx` → `src/App.tsx`. A `NavRail` switches between three tools (`src/pages/`): **Workbench**, **Data Tables**, **Registry**.
  - `src/pages/data-tables/` — one config module per entity (abilities, biograms, charms, effects, items) built on the generic `EntityDataTable`. `DataTables.tsx` is the tab shell.
  - `src/pages/creature-editor/` — the creature editing surface, now hosted entirely inside the Workbench (the standalone tool was removed). `CreatureForm` leads with the **progression chart** (`ProgressionChart`), then the stat/growth grid (`StatGrowthTable`), base abilities, and per-level unlocks (`AbilitiesByLevelEditor`). Identity fields (name/sprite/script/description) live in `CreatureIdentityFields`. `AbilityPicker` is a searchable multi-select that shows ability names but stores ids.
  - `src/components/data-tables/` — `EntityDataTable` (browse/search/sticky-scroll table), `EntityEditDialog` (schema-driven edit form), `SpritePicker`, `TagsSelect`/`TagsInput`.
  - `src/components/Sprite.tsx` — renders a sprite by logical name via the `get_sprite` command (returns a data URL); module-level cache so a name is fetched once.
  - `src/components/IntegerInput.tsx` — number input locked to whole numbers (blocks `.`/`e`, truncates pastes). Reused anywhere a field must be integral.
  - `src/lib/` — `stats.ts` (shared `STAT_META`: icon/color/label per stat, used by charms + creatures), `creature.ts` (Creature types, load/save, and the **projection math**), `utils.ts` (`cn`).
  - `src/components/ui/` — vendored shadcn components. Treat as generated; lint/format is scoped to hand-written files, not these.
- `src-tauri/` — Rust backend.
  - `src/lib.rs` — registers Tauri commands (`invoke_handler!`) and manages the `Dal` app state.
  - `commands/` — `#[tauri::command]` handlers, thin wrappers over the DAL.
  - `dal/` — data access layer. `Dal` owns per-domain Moka caches and a `notify` watcher that invalidates them on external file edits. One file per domain (`abilities`, `biograms`, `charms`, `creatures`, `dlc`, `effects`, `items`, `item_drops`) plus `assets` (asset manifest) and `sprites`. `dal::mod::data_dir()` = `<gameInstallPath>/Data`.
  - `model/` — Serde structs (`Ability`, `Creature`, `Charm`, `Item`, `ItemDrop`, `AssetEntry`, …), all `#[serde(rename_all = "camelCase")]`.
  - `config/` — loads/creates `./editor.conf.json` (holds `gameInstallPath`); runtime-updatable via `save_config`.

## Data flow

- Game data lives at `<gameInstallPath>/Data/*.json`; the `assets.json` manifest sits at the install root and maps logical names (e.g. `ability_bite.png`) to on-disk paths. `dal::assets` resolves a name through the manifest; `dal::sprites` reads + base64-encodes the file into a `data:` URL.
- **Sprite naming**: items/charms/abilities store the full filename *with* extension (`item_bandage.png`); **creatures store the bare stem** (`bitlynx`). `resolve_asset` falls back to `<name>.png` so both resolve. Empty/missing names return `None` → placeholder.
- Domain reads are cached; saves re-read from disk, upsert by `id`, sort, and write atomically (temp + rename) so diffs stay minimal. The watcher invalidates caches when files change outside the app.

## Patterns & conventions

- **Schema-driven tables**: a data-table page supplies `columns` + a `fields` schema (`EntityField`) + Tauri command names (or custom `load`/`onSave` hooks) to `EntityDataTable`; the dialog renders the form from the schema. To add an entity table, copy an existing `*DataTable.tsx`.
- **Joins**: `ItemsDataTable` joins `items.json` ⋈ `itemDropTable.json` by `id` (loot/economy/biome). Saving writes both records.
- **Stat projection** (`src/lib/creature.ts`): linear — `value(L) = base + gainPerLevel·(L−1)`. The chart compares a creature against the population's per-level average and max (population includes the live draft). `MAX_LEVEL = 25`.
- **Save normalization**: zero-valued entries are stripped from sparse maps before writing (charm `stats`, creature `statGainsPerLevel`) so untouched stats don't churn files; creature `baseStats` keeps its full ordered block.

## Tauri commands (frontend ↔ Rust bridge)

Registered in `src-tauri/src/lib.rs`. Per domain: `get_<domain>` / `save_<singular>` for abilities, biograms, charms, creatures, dlc, effects, items, item_drops. Plus `get_config`/`save_config`, `get_sprite`/`list_sprites`, and `get_game_objects` (unified view across entities).

To add a command: implement on `Dal` in `dal/`, add a thin wrapper in `commands/`, then register it in `invoke_handler![...]` in `lib.rs`. The frontend calls it via `invoke("name", { argKey: value })` — arg keys are camelCase and must match the Rust parameter name.

## Scripts

- `bun tauri dev` — full Tauri app (frontend + Rust); use this to run the editor
- `bun dev` — Vite dev server only (no backend; `invoke` calls will fail)
- `bun build` — `tsc && vite build`
- `bun lint` / `bun format` — Biome (`check` / `check --write`)
- Rust: `cargo build` / `cargo check` from `src-tauri/`

## Conventions for changes

- Verify with `bunx tsc --noEmit`, `bunx biome check` (scoped to touched files — the vendored `ui/` components carry pre-existing lint noise), and `cargo build` for Rust changes.
- This repo is **`script-kitties-editor`**; the game data repo is the separate `worlds-cpp` (default data path `worlds-cpp/worlds-cpp/Data`). Commit only here.

## State

Early development (v0.1.0). Data Tables (abilities, biograms, charms, effects, items) browse + edit end-to-end; items join their drop-table entry. The Workbench is the primary surface: a grouped object list opening per-object tabs, with bespoke editors for creatures (identity, base/growth stat grid, per-level ability unlocks, plus a Script/Stats toggle for the aiController script vs. the progression chart), bundles, and packs. The standalone Creature Editor tool was removed — its surface lives in the Workbench now.
