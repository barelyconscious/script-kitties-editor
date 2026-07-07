/**
 * saveComponent — the pure save-flow core (F11). Turns the in-memory
 * {@link OpenComponent} into a `save_component` (B4/B6) invocation: serialize the
 * `GuiNode` tree back to XML (F1) and pair it with the controller working draft.
 * Kept free of React so the serialize + argument-shaping logic is unit-testable
 * without rendering — the component-switch guard and the Save button both call
 * this single function so they cannot drift.
 *
 * The dirty discipline lives in the store, not here: the caller dispatches
 * `markSaved` only on a resolved promise; a rejection is rethrown so the caller
 * KEEPS the dirty indicator set and surfaces the error (design risk #5 — a
 * failed two-file save must look unsaved, never silently land).
 *
 * @see design/xgui_ta.md — section 7 "Saving" + structural risk #5.
 */

import { invoke } from "@tauri-apps/api/core";
import { serializeGui } from "../../lib/guiNode";
import type { OpenComponent } from "./editorState";

/**
 * Echo suppression for the `gui/` filesystem watcher. The watcher fires
 * `gui-changed` for EVERY write under `gui/`, including the editor's OWN saves —
 * it can't tell our write from an external edit. That echo can reach the
 * live-reload listener before {@link useComponentSave} clears the dirty flag,
 * which used to raise a bogus "changed on disk but you have unsaved edits" notice
 * on every save.
 *
 * We remember the exact XML we last wrote per component path (the bytes are the
 * authoritative "this is ours" signal — independent of timing and of any
 * subsequent in-memory edits). The live-reload listener re-reads the changed file
 * and, if its normalized content matches what we recorded, treats it as our own
 * echo and ignores it. A module-level map (one short string per opened+saved
 * component) mirrors the app's other module-level caches.
 */
const lastSavedXmlByPath = new Map<string, string>();

/**
 * The controller sibling of {@link lastSavedXmlByPath}: the exact `.lua` text the
 * editor last wrote per component path. A controller `.lua` change fires its own
 * `gui-changed` echo, so the live-reload listener re-reads the `.lua` and compares
 * it here to recognize (and ignore) our own save.
 */
const lastSavedControllerByPath = new Map<string, string>();

/** Record the XML the editor just persisted to `path` (for echo suppression). */
export function recordSavedComponentXml(path: string, xml: string): void {
  lastSavedXmlByPath.set(path, xml);
}

/**
 * Record the controller `.lua` text the editor just persisted to `path` (for echo
 * suppression). A `null` `text` means the save wrote NO controller — clear any
 * prior record so a stale entry can't suppress a later external controller edit.
 */
export function recordSavedController(path: string, text: string | null): void {
  if (text == null) lastSavedControllerByPath.delete(path);
  else lastSavedControllerByPath.set(path, text);
}

/**
 * True when `xml` is exactly what the editor last wrote to `path` — i.e. a
 * `gui-changed` event for `path` carrying this content is our own save echoing
 * back through the watcher, not an external edit.
 */
export function isOwnSaveEcho(path: string, xml: string): boolean {
  return lastSavedXmlByPath.get(path) === xml;
}

/**
 * True when `text` is exactly the controller `.lua` the editor last wrote for
 * `path` — the controller sibling of {@link isOwnSaveEcho}, so our own `.lua`
 * write echoing back through the watcher doesn't raise a spurious notice.
 */
export function isOwnControllerSaveEcho(path: string, text: string): boolean {
  return lastSavedControllerByPath.get(path) === text;
}

/**
 * The exact `save_component` argument bundle, derived purely from an open
 * component. Exposed (and exported) so a test can assert the serialize + pairing
 * without spying on `invoke`, and so the React layer shares one shaping path.
 *
 * `controller` mirrors the Rust `Option<(String, String)>`: a `[fileName, text]`
 * pair when the component has a controller working draft (`controllerText` is a
 * string — INCLUDING the empty string, the Add-script case where Save creates the
 * `.lua`), or `null` when there is no controller buffer to persist. A `null`
 * `controllerText` means "not yet loaded / no controller" — nothing to write.
 */
export type SaveComponentArgs = {
  name: string;
  xml: string;
  controller: [string, string] | null;
};

/**
 * Shape the `save_component` arguments from an open component: serialize the tree
 * to XML and pair the controller buffer when present. Pure — no I/O.
 *
 * The controller is paired only when BOTH a filename and a (possibly empty) text
 * buffer exist. `controllerText === ""` is a real, persistable value (Add-script
 * seeds an empty buffer that Save must turn into a file), so the guard is an
 * explicit `!= null`, never a truthiness check.
 */
export function buildSaveArgs(open: OpenComponent): SaveComponentArgs {
  const xml = serializeGui(open.root);
  const controller: [string, string] | null =
    open.controllerFileName != null && open.controllerText != null
      ? [open.controllerFileName, open.controllerText]
      : null;
  return { name: open.name, xml, controller };
}

/**
 * Persist an open component (XML + controller together) via `save_component`.
 *
 * Resolves on a successful two-file save — the caller then dispatches `markSaved`.
 * REJECTS (rethrows the backend error) if either write fails, so the caller keeps
 * the component dirty and shows the error; nothing here clears dirty. The backend
 * registers an unregistered component / creates a brand-new controller on save
 * (B6), so this works for existing-but-unregistered files and Add-script drafts.
 */
export async function saveOpenComponent(open: OpenComponent): Promise<void> {
  const { name, xml, controller } = buildSaveArgs(open);
  // Record BEFORE the write: the watcher can deliver our own `gui-changed` echo
  // before this invoke resolves, so the suppression record must already be in
  // place when the live-reload listener re-reads the file. A failed write leaves
  // a harmless stale record — disk won't match it, so nothing is suppressed.
  recordSavedComponentXml(open.path, xml);
  recordSavedController(open.path, controller ? controller[1] : null);
  await invoke("save_component", { name, xml, controller });
}
