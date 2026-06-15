# Architecture

High-level map of **Script Kitties Editor** — a Tauri 2 desktop app for editing the
`worlds-cpp` game's JSON data. Read this first; see [`frontend.md`](./frontend.md) and
[`backend.md`](./backend.md) for detail. The goal here is shared *terminology*, not an
exhaustive file listing.

## The shape of the app

- **Frontend** (React 19 + TypeScript, Vite, Tailwind 4, shadcn/ui) lives in `src/`.
- **Backend** (Rust, Tauri 2) lives in `src-tauri/`.
- They talk over Tauri's `invoke()` bridge: the frontend calls a named **command**, the
  Rust side runs it against the **DAL**, which reads/writes a JSON file under
  `<gameInstallPath>/Data/`.

```
React UI ──invoke("get_creatures")──▶ command ──▶ DAL ──▶ creatures.json
        ◀──────── JSON ──────────────┘   (Moka cache + file watcher)
```

## Tools (the top-level UI)

A left **NavRail** switches between four **tools** (one React page each):

| Tool | What it is |
|------|-----------|
| **Workbench** | Code-and-data workspace over all game objects. The flagship surface — see [`frontend.md`](./frontend.md). |
| **Creature Editor** | Focused editor for one creature: stat/growth grid + progression chart + ability unlocks. |
| **Data Tables** | Browse/search/edit grids for the flat entities (abilities, biograms, charms, effects, items). |
| **Registry** | Edits the tweakable **enums** (tags, rarities, biomes, …) that populate every dropdown. |

## Core vocabulary

- **Entity** — a domain type with its own JSON file in `Data/` (ability, biogram, charm,
  effect, item, creature, bundle, pack). The TS type + load/save + field schema for each
  lives in `src/lib/entities/` (or `src/lib/creature.ts`).
- **GameObject** — a *lossy unified projection* (`id`, `name`, `sprite`, `script`,
  `description`, `objectType`) across entities, produced by the `get_game_objects` command.
  It's what the Workbench's object list is built from.
- **Field schema (`EntityField[]`)** — a declarative description of an entity's editable
  fields. One schema is the **single source of truth** rendered by both the Data Tables
  edit dialog and the Workbench data pane, so validation/normalization never diverge.
- **Registry / enum** — editor-owned, user-tweakable value lists (e.g. `rarities`,
  `creatureRarities`, `combatTags`). A field references one via `optionsFrom`, and reads it
  live with `useEnumValues(key)`. Persisted in `editor.registry.json`.
- **DAL (Data Access Layer)** — the Rust struct that owns the JSON reads/writes, an
  in-memory cache per entity, and a filesystem watcher.
- **Command** — a `#[tauri::command]` function (thin wrapper over the DAL) callable from
  the frontend by name.

## Conventions worth knowing

- **Sprite naming**: items/charms/abilities store the full filename (`item_bandage.png`);
  creatures store the bare stem (`bitlynx`). `Sprite`/`SpritePicker` resolve both.
- **Save normalization**: zero/empty entries are stripped from sparse maps before writing,
  so untouched fields don't churn the JSON diff.
- **Writes are atomic** (temp + rename), records are upserted by `id` and sorted, and the
  watcher invalidates caches when a file changes outside the app.
