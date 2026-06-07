---
name: workbench-script-model
description: Load-bearing data facts for the Workbench's script editing — where .lua files live, how they resolve, and that scripts are shared not 1:1
metadata:
  type: project
---

The Workbench (third editor tool) edits game-object scripts. The structural facts that govern its backend, verified against real `worlds-cpp` game data on 2026-06-06:

- The `script` field (and creatures' `aiController`) holds a **bare filename**, e.g. `ability_bite.lua`, `ai_default.lua` — NOT a typed-subdirectory path. The predecessor `bcgeditor`'s `scriptUtils.validateScriptPath` assumed `abilities/{id}.lua`; that convention does NOT match this game. Do not port it.
- The `.lua` files live at `<gameInstallPath>/Scripts/<name>.lua` — a **sibling of `Data/`, not under it.**
- These scripts are **already in `assets.json`** (134 gameplay scripts; `ability_bite.lua` → `Scripts\ability_bite.lua`). So `dal::assets::resolve_asset` already resolves a bare script name to an absolute path — same machinery as `get_sprite`. A `get_script`/`save_script` pair should resolve-through-manifest then do I/O, mirroring `dal::sprites`.
- Scripts are **shared, not 1:1 with objects**: `ai_default.lua` is the `aiController` for many creatures. Editing the script from one creature's workspace changes every object pointing at that file. The save UX must name the *file*, not imply the script belongs to the one selected object.
- The filesystem watcher does two non-recursive watches (`Data/` and game root). It does NOT watch `Scripts/` — external `.lua` edits (e.g. "Open in VS Code") won't invalidate a script cache unless a `Scripts/` watch is added.

**Why:** the draft proposal stated the wrong path model ("relative to data dir") and missed that resolution already exists. These facts redirect the backend gap to something smaller and conventional.
**How to apply:** when planning/reviewing Workbench backend work, hold the engineer to resolve-via-manifest (not invented path rules) and to the shared-script coupling. See [[workbench-api-data-duplication]].
