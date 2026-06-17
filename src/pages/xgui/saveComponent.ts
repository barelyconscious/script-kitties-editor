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
  await invoke("save_component", { name, xml, controller });
}
