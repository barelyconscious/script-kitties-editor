/**
 * guiEvents — the frontend↔backend Tauri event-name constants for the XGUI
 * editor. Kept in one place so the listener and any future emitter agree on the
 * exact string the Rust side emits.
 */

/**
 * Emitted by the backend's `gui/` filesystem watcher (see `src-tauri/src/dal/mod.rs`,
 * `GUI_CHANGED_EVENT`) AFTER it invalidates the gui-tree + component caches, so a
 * subsequent `get_gui_tree` / `get_component` re-fetch reads fresh data. The
 * payload is the changed file's gui-relative path (e.g. `"widgets/bag.xml"`), or
 * `null` when the path couldn't be derived (a coarse "something under gui/
 * changed" signal). MUST match the Rust constant exactly.
 */
export const GUI_CHANGED_EVENT = "gui-changed";
