/**
 * scriptDiskSync — the frontend glue that keeps an OPEN Workbench script editor in
 * sync with EXTERNAL edits to its `.lua` file (e.g. saved from VS Code, a file move,
 * a git checkout).
 *
 * When a `Scripts/` `.lua` changes on disk the backend watcher invalidates its Rust
 * scripts cache and emits `scripts-changed` with the changed file's basename (see
 * `src-tauri/src/dal/mod.rs`, `SCRIPTS_CHANGED_EVENT`). A {@link ScriptPane} listens
 * via {@link onScriptsChanged}, and when the payload names ITS file, re-fetches the
 * fresh contents and applies the same trust model the sibling-tab sync uses: a clean
 * pane silently adopts, a dirty pane is warned before its edits are clobbered.
 *
 * This complements — it does not replace — the in-app `scriptSync` bus. That bus
 * fans a SAVE out to sibling tabs showing the same file (an in-editor event); this
 * module reacts to DISK. The editor's own saves would otherwise echo back through
 * the watcher as a phantom "external" change, so {@link noteScriptSaved} records what
 * the editor last wrote per file and {@link wasScriptSavedByApp} filters those echoes
 * out — the disk path then only ever surfaces edits the editor did NOT make.
 */

import { listen } from "@tauri-apps/api/event";

/**
 * The Tauri event name the backend emits after invalidating its scripts cache on an
 * external `Scripts/` `.lua` edit. MUST match the Rust `SCRIPTS_CHANGED_EVENT`
 * constant. Payload: the changed file's basename, or `null` if it couldn't be
 * derived (a `.lua` always has a name, so `null` is not expected in practice).
 */
export const SCRIPTS_CHANGED_EVENT = "scripts-changed";

/**
 * The bare filename of a script's logical name — strips any `Scripts/`-style path
 * prefix (forward OR backslash) so a comparison is basename-to-basename. Entity
 * script names are already bare filenames, but normalizing both sides is robust
 * against a name that carries a directory.
 */
export function scriptBasename(name: string): string {
  const trimmed = name.trim();
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

/**
 * Subscribe to the backend's `scripts-changed` event. `handler` receives the changed
 * file's basename (or `null`). Returns a synchronous cleanup that detaches the
 * listener — safe to return straight from a `useEffect`, and correct even if the
 * component unmounts before the async `listen()` resolves.
 */
export function onScriptsChanged(handler: (changedBasename: string | null) => void): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void listen<string | null>(SCRIPTS_CHANGED_EVENT, (event) => handler(event.payload ?? null)).then(
    (fn) => {
      // listen() resolves async; if we already unmounted, detach immediately.
      if (disposed) fn();
      else unlisten = fn;
    },
  );
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/**
 * The last contents the editor itself wrote to each script file, keyed by basename.
 * Used to recognize (and ignore) the watcher echo of our OWN save, so the disk-sync
 * path only reacts to genuine external edits. A single string per file — the newest
 * write wins, which is all the echo check needs.
 */
const lastAppWrite = new Map<string, string>();

/** Record that the editor just wrote `contents` to the script named `name`. */
export function noteScriptSaved(name: string, contents: string): void {
  lastAppWrite.set(scriptBasename(name), contents);
}

/**
 * Whether `contents` re-read for `name` from disk matches what the editor last wrote
 * there — i.e. the change is the editor's own save echoing back through the watcher,
 * not an external edit. Kept (not consumed) so a later external edit that coincides
 * with our last write is still correctly a no-op (disk already equals what we have).
 */
export function wasScriptSavedByApp(name: string, contents: string): boolean {
  return lastAppWrite.get(scriptBasename(name)) === contents;
}
