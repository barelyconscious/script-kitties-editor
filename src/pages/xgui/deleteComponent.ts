/**
 * deleteComponent — the pure decisions behind deleting a component from the left
 * component list. Deleting is destructive (it unlinks the `.xml` and its
 * controller `.lua` and drops their manifest entries), so the small judgments
 * around it — what args the backend gets, and whether the open editor must close
 * — are isolated here and unit-tested off-React. The component list shell only
 * confirms the action, calls the backend, and applies these decisions.
 *
 * @see design/xgui_ta.md — "Component list (leftmost, collapsible)".
 */

import type { GuiComponentRef } from "./guiTree";

/** The args the `delete_component` backend command expects (camelCase bridge keys). */
export type DeleteComponentArgs = {
  /** Bare basename of the component to delete. */
  name: string;
  /**
   * The controller hint the backend deletes alongside the `.xml`. The component's
   * tree ref carries it (or `null`); the backend falls back to the
   * `{name}_controller.lua` sibling convention when this is `null`, so a missing
   * hint never strands a controller on disk.
   */
  controllerFileName: string | null;
};

/**
 * Build the `delete_component` invoke args from a component's tree ref. Passes the
 * controller hint straight through (normalizing `undefined` to `null`) so the
 * backend can remove the sibling `.lua`.
 */
export function deleteComponentArgs(component: GuiComponentRef): DeleteComponentArgs {
  return {
    name: component.name,
    controllerFileName: component.controllerFileName ?? null,
  };
}

/**
 * Whether deleting `deletedName` must close the open editor. True only when the
 * component being deleted is the one currently open — otherwise the editor is
 * pointing at an unrelated (still-valid) component and must be left alone. A
 * `null` open name (nothing open) never closes.
 */
export function shouldCloseOpen(openName: string | null, deletedName: string): boolean {
  return openName != null && openName === deletedName;
}
