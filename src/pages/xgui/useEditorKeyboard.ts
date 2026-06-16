/**
 * useEditorKeyboard — the XGUI editor's global keyboard commands (task 470):
 * Cmd/Ctrl+S to Save, and Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z (and Ctrl+Y) to undo/redo
 * the open component's document. Bound at the window so they fire from ANY focus
 * inside the editor (the structure column, the property fields, the preview), not
 * only when a particular element has focus.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY GATED ON `active`
 * ─────────────────────────────────────────────────────────────────────────────
 * The XGUI page stays MOUNTED across tool switches (see {@link import("../../App").default}),
 * so this hook is live even when the user is in the Workbench or Data Tables. The
 * `active` flag (the XGUI tool is the foreground tool) gates every command so a
 * Cmd+S / Cmd+Z meant for another tool's editor is never stolen here — exactly the
 * no-op-when-XGUI-not-active contract. Each command is ALSO a no-op when nothing is
 * open, and Save additionally no-ops when the component is clean.
 *
 * preventDefault on every handled combo so the browser/OS Save dialog and the
 * webview's native undo never fire. Capture phase mirrors {@link import("../../App").default}'s
 * Ctrl+W swallow so the combo is intercepted before any inner editor sees it
 * (Monaco owns its own undo on the Controller tab, but the document-level Cmd+Z is
 * the editor's, taken first — Monaco's text undo is reachable while typing because
 * we only handle Z when the editor is active AND a component is open, and the
 * controller's own coalesced history is the document's, so one stack, no conflict).
 *
 * @see editorState.tsx — the `undo`/`redo` reducer actions this drives.
 * @see useComponentSave.ts — the Save flow Cmd+S triggers.
 */

import { useEffect } from "react";
import { useEditorStore } from "./editorState";

export type EditorKeyboardOpts = {
  /** The XGUI tool is the foreground tool. When false every command is a no-op. */
  active: boolean;
  /** Trigger the existing F11 Save (the same path the Save button uses). */
  onSave: () => void;
};

/**
 * The minimal slice of a keyboard event the command decision reads. Kept as a
 * plain shape so {@link decideKeyCommand} is testable in a DOM-free node env.
 */
export type KeyChord = {
  /** `event.key` (any case — the decision lower-cases it). */
  key: string;
  /** ⌘ on macOS. */
  metaKey: boolean;
  /** Ctrl on Windows/Linux (and ⌃ on mac). */
  ctrlKey: boolean;
  shiftKey: boolean;
};

/** Editor state the command decision needs. */
export type EditorKeyContext = {
  /** The XGUI tool is foreground. When false, NO command is produced. */
  active: boolean;
  /** A component is open. */
  hasOpen: boolean;
  /** The open component has unsaved edits. */
  dirty: boolean;
  /** There is an undo step available. */
  canUndo: boolean;
  /** There is a redo step available. */
  canRedo: boolean;
};

/**
 * What a key chord resolves to inside the editor. `null` = not ours (let it pass
 * through untouched). The other variants ALL imply the chord is the editor's, so
 * the caller preventDefaults — including `"swallow"`, which is the editor claiming
 * the combo (so the browser/OS dialog never fires) while having nothing to do
 * (e.g. Cmd+S with no unsaved changes, or Cmd+Z with an empty undo stack).
 */
export type KeyCommand = "save" | "undo" | "redo" | "swallow" | null;

/** True for "the platform's primary modifier is held" (⌘ on mac, Ctrl elsewhere). */
function hasPrimaryModifier(chord: KeyChord): boolean {
  return chord.metaKey || chord.ctrlKey;
}

/**
 * Pure decision: map a key chord + editor context to the command to run (task
 * 470). Encapsulates every gate so the hook stays a thin event-binding shell and
 * the no-op conditions are unit-tested without a DOM.
 *
 * - Inactive editor, or no primary modifier → `null` (pass through).
 * - Cmd/Ctrl+S → `"save"` when open AND dirty, else `"swallow"` (preventDefault so
 *   the OS save dialog never shows, but do nothing).
 * - Cmd/Ctrl+Shift+Z or Ctrl/Cmd+Y → `"redo"` when redo available, else `"swallow"`.
 * - Cmd/Ctrl+Z → `"undo"` when undo available, else `"swallow"`.
 *   (Undo/redo require a component open; with none open they pass through as `null`
 *    so they don't get swallowed away from any other handler.)
 */
export function decideKeyCommand(chord: KeyChord, ctx: EditorKeyContext): KeyCommand {
  if (!ctx.active) return null;
  if (!hasPrimaryModifier(chord)) return null;
  const key = chord.key.toLowerCase();

  if (key === "s") {
    // Always claim Cmd+S in the editor so the browser dialog never appears.
    return ctx.hasOpen && ctx.dirty ? "save" : "swallow";
  }

  // Undo/redo are meaningless without an open document — let them pass through.
  if (!ctx.hasOpen) return null;

  if ((key === "z" && chord.shiftKey) || key === "y") {
    return ctx.canRedo ? "redo" : "swallow";
  }
  if (key === "z") {
    return ctx.canUndo ? "undo" : "swallow";
  }
  return null;
}

export function useEditorKeyboard({ active, onSave }: EditorKeyboardOpts): void {
  const { state, dispatch } = useEditorStore();
  const hasOpen = state.open != null;
  const dirty = state.dirty;
  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  useEffect(() => {
    if (!active) return; // Only the foreground XGUI tool owns these combos.

    const onKeyDown = (e: KeyboardEvent) => {
      const command = decideKeyCommand(e, { active, hasOpen, dirty, canUndo, canRedo });
      if (command === null) return;
      // Every non-null command is the editor claiming the combo: preventDefault so
      // the browser/OS shortcut never fires, and stopPropagation (capture) so no
      // inner editor (e.g. Monaco) also acts on it.
      e.preventDefault();
      e.stopPropagation();
      if (command === "save") onSave();
      else if (command === "undo") dispatch({ type: "undo" });
      else if (command === "redo") dispatch({ type: "redo" });
      // "swallow" → nothing to do beyond the preventDefault above.
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [active, hasOpen, dirty, canUndo, canRedo, dispatch, onSave]);
}
