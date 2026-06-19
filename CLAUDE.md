# script-kitties-editor

Tauri 2 desktop app — an editor/inspector for the `worlds-cpp` game's data files. The app reads/writes the game's JSON data (abilities, creatures, items, charms, …) from a configurable install directory. Product name: **Script Kitties Editor**.

## Stack

- **Frontend**: React 19 + TypeScript, Vite 6, Tailwind 4, shadcn/ui, Radix, Lucide icons, Recharts (charts)
- **Backend**: Rust (Tauri 2), Serde, Moka (in-memory cache), notify (filesystem watcher), base64
- **Tooling**: Bun (package manager + runner), Biome (lint/format)

## Layout

- `src/` — React frontend. Entry: `src/main.tsx` → `src/App.tsx`. A `NavRail` switches between four tools (`src/pages/`): **Workbench**, **GUI Editor**, **Data Tables**, **Registry**.
  - `src/pages/data-tables/` — one config module per entity (abilities, biograms, charms, effects, items) built on the generic `EntityDataTable`. `DataTables.tsx` is the tab shell.
  - `src/pages/creature-editor/` — the creature editing surface, now hosted entirely inside the Workbench (the standalone tool was removed). `CreatureForm` leads with the **progression chart** (`ProgressionChart`), then the stat/growth grid (`StatGrowthTable`), base abilities, and per-level unlocks (`AbilitiesByLevelEditor`). Identity fields (name/sprite/script/description) live in `CreatureIdentityFields`. `AbilityPicker` is a searchable multi-select that shows ability names but stores ids.
  - `src/pages/xgui/` — the **GUI Editor** (aka **XGUI**): a visual editor for the game's GUI *components* (XML layouts + optional Lua controllers) sourced from `<gameInstallPath>/gui/`. `Xgui.tsx` is the page shell — collapsible component list · structure column (tree + properties) · main content with a segmented **View / Controller / XML** tab toggle and an always-visible **Data Model** panel. Surfaces: `ComponentList.tsx` (folder-tree browser, per-folder create; no file-delete), `StructureTree.tsx` (element hierarchy — add/delete elements, component picker), `PropertiesPanel.tsx` (schema-driven fields incl. four-input UDim2 `position`/`size`, palette swatches, freeform `<Component>` overrides), `GuiPreview.tsx`/`GuiPreviewHost.tsx` (live preview on a blueprint canvas with zoom/pan + drag-to-move), `ControllerTab.tsx` (Lua Monaco), `XmlView.tsx` (read-only live XML), `DataModelPanel.tsx` (Monaco JSON). `editorState.tsx` is the reducer store for the open component (GuiNode tree, single `selectedNodeId`, dirty, undo/redo history, active tab). Full design + decisions: **`design/xgui_ta.md`**.
  - `src/lib/gui*.ts` — the framework-agnostic GUI **engine** (pure, heavily unit-tested): `guiNode.ts` (the `GuiNode` model + lossless XML parse/serialize), `guiBinding.ts`/`guiScope.ts`/`guiForEach.ts` (`{token}` resolution, the forEach scope stack, repetition), `guiGeometry.ts` (rel/abs UDim2→CSS, integer drag math, fit/zoom/clamp), `guiZOrder.ts` (nested per-sibling `layer` z-order), `guiSelection.ts` (`data-node-id` back-ref + nearest-node), `guiComponentMount.ts`/`guiComponentCache.ts` (nested `<Component>` mount, missing/recursive placeholders), `guiPalette.ts`/`guiPaletteEdit.ts` (named colors), `guiModelScaffold.ts` (auto-build the data model from a layout's tokens).
  - `src/components/data-tables/` — `EntityDataTable` (browse/search/sticky-scroll table), `EntityEditDialog` (schema-driven edit form), `SpritePicker`, `TagsSelect`/`TagsInput`.
  - `src/components/Sprite.tsx` — renders a sprite by logical name via the `get_sprite` command (returns a data URL); module-level cache so a name is fetched once.
  - `src/components/IntegerInput.tsx` — number input locked to whole numbers (blocks `.`/`e`, truncates pastes). Reused anywhere a field must be integral.
  - `src/lib/` — `stats.ts` (shared `STAT_META`: icon/color/label per stat, used by charms + creatures), `creature.ts` (Creature types, load/save, and the **projection math**), `utils.ts` (`cn`).
  - `src/components/ui/` — vendored shadcn components. Treat as generated; lint/format is scoped to hand-written files, not these.
- `src-tauri/` — Rust backend.
  - `src/lib.rs` — registers Tauri commands (`invoke_handler!`) and manages the `Dal` app state.
  - `commands/` — `#[tauri::command]` handlers, thin wrappers over the DAL.
  - `dal/` — data access layer. `Dal` owns per-domain Moka caches and a `notify` watcher that invalidates them on external file edits. One file per domain (`abilities`, `biograms`, `charms`, `creatures`, `dlc`, `effects`, `items`, `item_drops`) plus `assets` (asset manifest), `sprites`, `scripts`, **`gui`** (the GUI Editor's component tree/read/create/save), and **`palette`** (the GUI color palette, `Data/gui_palette.json`). `dal::mod::data_dir()` = `<gameInstallPath>/Data`. The `gui/` folder uses the app's one **recursive** watch; it emits a `gui-changed` Tauri event the GUI Editor live-reloads from.
  - `model/` — Serde structs (`Ability`, `Creature`, `Charm`, `Item`, `ItemDrop`, `AssetEntry`, …), all `#[serde(rename_all = "camelCase")]`.
  - `config/` — loads/creates `./editor.conf.json` (holds `gameInstallPath`); runtime-updatable via `save_config`.

## Data flow

- Game data lives at `<gameInstallPath>/Data/*.json`; the `assets.json` manifest sits at the install root and maps logical names (e.g. `ability_bite.png`) to on-disk paths. `dal::assets` resolves a name through the manifest; `dal::sprites` reads + base64-encodes the file into a `data:` URL.
- **Sprite naming**: items/charms/abilities store the full filename *with* extension (`item_bandage.png`); **creatures store the bare stem** (`bitlynx`). `resolve_asset` falls back to `<name>.png` so both resolve. Empty/missing names return `None` → placeholder.
- Domain reads are cached; saves re-read from disk, upsert by `id`, sort, and write atomically (temp + rename) so diffs stay minimal. The watcher invalidates caches when files change outside the app.

## GUI Editor (XGUI)

A visual editor for the game's GUI **components** — XML layouts (`<View>`/`<Panel>`/`<Text>`/`<Component>`/`<Event>`, with phase-2 layout elements reserved) plus an optional `{name}_controller.lua`. Components live under `<gameInstallPath>/gui/` (with subfolders the editor mirrors). Design source of truth: **`design/xgui_ta.md`**. Load-bearing facts for working here:

- **The editor authors structure; it stays thin about runtime semantics.** Events are stored as `name → handler` strings (no validation/indexing/bus modeling); `<Component>` override props are freeform; the editor never models what the game does with any of it. It is **visual-only** — there is no raw-XML *editing* surface (the XML tab is a read-only live view).
- **The XML GUI runtime engine does not exist in `worlds-cpp` yet.** The editor writes files a *future* C++ engine will consume; some choices are contracts the runtime must honor. **All work here is editor-only — no C++/`worlds-cpp` engine changes.** The one cross-boundary write is the color palette JSON into `<gameInstallPath>/Data/gui_palette.json` (data, not code).
- **Disk vs. manifest.** The editor **reads components by their on-disk gui-tree path** (the filesystem is the gate, not the manifest), and **create/save register them in `assets.json` ("register-on-save")** — inserting each new entry in **alphabetical position** — so a component is catalogued immediately without waiting on a full rescan. The asset-manifest **rescan** (`update_asset_manifest`) globs `.lua`/`.png`/`.json`/**`.xml`** (xml was added so gui components are catalogued and register-on-saved `.xml` entries survive a rescan instead of being dropped) and **writes the whole manifest in alphabetical key order** (matching register-on-save's placement, so new files sort into place rather than landing at the bottom). **Component basenames are unique tree-wide** (folders organize for humans but don't namespace; `<Component src="x.xml">` resolves by basename anywhere in the tree).
- **Data binding.** Any *presentational* property may be a literal, a `{token}` (whole-value for typed props; interpolation for `text`/`texture`; per-field for compound `position`/`size`), or — for colors — a palette name. Structural props (`id`, `src`, `controller`, handler names) are literal-only. `forEach="{collection}"` repeats an element per item with a scoped item context (`$.x` reaches root). `layer` is a **nested per-sibling** z-order (an element's layer orders it among its siblings and lifts its whole subtree — *not* a global flat ranking).
- **The Data Model panel** auto-scaffolds from the layout's tokens (default value = the token name as a string), merges new tokens additively, and **persists per component in localStorage** (`xgui.dataModels`) so it survives switching/restarts. It drives the preview's binding resolution.
- **Live reload + save.** Nothing auto-saves; manual **Save** (Cmd/Ctrl+S) persists XML + controller, with **warn-on-switch** on unsaved edits. The `gui-changed` watcher event (`useGuiLiveReload.ts`) refreshes the list, reloads a clean open component, and invalidates the frontend component-mount cache so components that *include* a changed one re-render.
- **Tests:** the GUI engine is mostly pure modules with thorough vitest coverage. **Run tests with `bun run test` / `bunx vitest run`, never bare `bun test`** — Bun's built-in runner doesn't honor the `@/` path alias and produces ~11 false failures in `newObject.test.ts`.

## Patterns & conventions

- **Schema-driven tables**: a data-table page supplies `columns` + a `fields` schema (`EntityField`) + Tauri command names (or custom `load`/`onSave` hooks) to `EntityDataTable`; the dialog renders the form from the schema. To add an entity table, copy an existing `*DataTable.tsx`.
- **Joins**: `ItemsDataTable` joins `items.json` ⋈ `itemDropTable.json` by `id` (loot/economy/biome). Saving writes both records.
- **Stat projection** (`src/lib/creature.ts`): linear — `value(L) = base + gainPerLevel·(L−1)`. The chart compares a creature against the population's per-level average and max (population includes the live draft). `MAX_LEVEL = 25`.
- **Save normalization**: zero-valued entries are stripped from sparse maps before writing (charm `stats`, creature `statGainsPerLevel`) so untouched stats don't churn files; creature `baseStats` keeps its full ordered block.

## Tauri commands (frontend ↔ Rust bridge)

Registered in `src-tauri/src/lib.rs`. Per domain: `get_<domain>` / `save_<singular>` for abilities, biograms, charms, creatures, dlc, effects, items, item_drops. Plus `get_config`/`save_config`, `get_sprite`/`list_sprites`, and `get_game_objects` (unified view across entities). Scripts: `get_script`/`save_script`/`create_script` (Lua, incl. GUI controllers). GUI Editor: `get_gui_tree` (recursive `gui/` folder tree), `get_component`/`save_component`/`create_component`/`create_folder`, and `get_palette`/`save_palette`. The `gui/` watcher emits the `gui-changed` event (no command).

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

Early development (v0.1.0). Data Tables (abilities, biograms, charms, effects, items) browse + edit end-to-end; items join their drop-table entry. The Workbench is the primary surface: a grouped object list opening per-object tabs, with bespoke editors for creatures (identity, base/growth stat grid, per-level ability unlocks, plus a Script/Stats toggle for the aiController script vs. the progression chart), bundles, and packs. The standalone Creature Editor tool was removed — its surface lives in the Workbench now. The **GUI Editor** (XGUI) is a full visual editor for the game's GUI components — browse/create components (rename/move/delete deferred), edit the element tree + properties (add/delete elements, undo/redo), live preview on a blueprint canvas with zoom/pan + drag-to-move, bind a data model, edit a Lua controller, and live-reload on external edits — shipped editor-side (the consuming C++ runtime is not built yet; see the GUI Editor section + `design/xgui_ta.md`).
