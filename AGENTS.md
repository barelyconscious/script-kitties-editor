# Agent guide

Start here, then read the docs below before changing code.

## Orient first

- **[`architecture/README.md`](./architecture/README.md)** — high-level map of the app,
  the data flow, and the shared **terminology** (Entity, GameObject, Registry, DAL, …).
  Read this first.
- **[`architecture/frontend.md`](./architecture/frontend.md)** — how each tool (Workbench,
  Creature Editor, Data Tables, Registry) is composed, and the names we use for its parts.
- **[`architecture/backend.md`](./architecture/backend.md)** — the Rust layers
  (`model` → `dal` → `commands` → `lib.rs`) and how to add a command.
- **[`CLAUDE.md`](./CLAUDE.md)** — detailed conventions, scripts, and current project state.

## Before you finish

Verify what you touched:

- Frontend: `bunx tsc --noEmit` and `bunx biome check` (scope to changed files — vendored
  `src/components/ui/` carries pre-existing lint noise).
- Rust: `cargo check` / `cargo build` from `src-tauri/`.

Keep the `architecture/` docs accurate when you change how things are organized or named.
