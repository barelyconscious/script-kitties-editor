/**
 * ControllerTab — the Controller tab of the XGUI main content (F10, design
 * section 4). A Lua Monaco editor for the open component's controller script,
 * plus the Add-script flow for a controller-less component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE STATES (mirroring the open component's controller situation)
 * ─────────────────────────────────────────────────────────────────────────────
 *  - (a) controller-less — `open.controllerFileName == null`: the component has
 *        no controller yet, so the tab shows an "Add script" affordance (an
 *        editable default name + a button). Clicking it does NOT touch disk — it
 *        dispatches `addController`, which sets `<View controller="…">`, seeds the
 *        controller starter template, and flips to the editor. The `.lua` FILE is created later
 *        by Save (F11), consistent with the editor's manual-save model where
 *        nothing persists until Save.
 *  - (b) loading — `controllerFileName` is set but `controllerText` is still
 *        `null`: read the file once via `get_script` and seat it through
 *        `loadControllerText` (which does NOT dirty — it is the on-disk state).
 *        A read that throws (manifest-present, file-missing) surfaces a legible
 *        error; a `null` return (just-added, not-yet-saved controller) is treated
 *        as an empty editable buffer, not an error.
 *  - (c) contents — `controllerText` is a string: the editable Monaco editor.
 *        Every edit dispatches `setControllerText`, which marks the component
 *        dirty so F11's Save persists the controller alongside the XML.
 *
 * Monaco itself is reused as-is from {@link ScriptEditor} (the creature
 * aiController editor) — this tab does not reconfigure Monaco; it only owns the
 * controller-specific load/add wiring.
 *
 * @see design/xgui_ta.md — section 4 "Main content — tabbed (View / Controller)".
 */

import { invoke } from "@tauri-apps/api/core";
import { FilePlus2, FileWarning, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ScriptEditor } from "@/components/ScriptEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultControllerFileName, normalizeControllerFileName } from "./controllerScript";
import { useEditorStore } from "./editorState";

/** Tracks the lazy disk read of an EXISTING controller. */
type ReadState = { kind: "idle" } | { kind: "error"; message: string };

export function ControllerTab() {
  const { state, dispatch } = useEditorStore();
  const open = state.open;

  const [read, setRead] = useState<ReadState>({ kind: "idle" });

  const fileName = open?.controllerFileName ?? null;
  const text = open?.controllerText ?? null;
  // Only fetch when a controller is attached but its buffer is not yet seeded.
  const needsLoad = fileName != null && text == null;

  // Lazy-read the existing controller's contents the first time the tab needs
  // them. The buffer is seeded WITHOUT dirtying (it is the on-disk state).
  useEffect(() => {
    if (!needsLoad || fileName == null) return;
    let cancelled = false;
    setRead({ kind: "idle" });
    invoke<string | null>("get_script", { name: fileName })
      .then((contents) => {
        if (cancelled) return;
        // A null return means the controller is referenced but has no contents
        // on disk yet (e.g. just added, not yet saved) — start an empty buffer
        // rather than erroring; the user can write it and Save creates the file.
        dispatch({ type: "loadControllerText", text: contents ?? "" });
      })
      .catch((err) => {
        if (cancelled) return;
        setRead({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [needsLoad, fileName, dispatch]);

  if (!open) {
    // The tab bar only offers Controller when a component is open, but guard so
    // this is never a blank panel if reached.
    return (
      <PlaceholderPane>
        <span>Open a component to edit its controller.</span>
      </PlaceholderPane>
    );
  }

  // (a) Controller-less → Add-script flow.
  if (fileName == null) {
    return (
      <AddScriptPane
        componentName={open.name}
        onAdd={(name) => dispatch({ type: "addController", fileName: name })}
      />
    );
  }

  // (b) Loading / read error.
  if (text == null) {
    if (read.kind === "error") {
      return (
        <PlaceholderPane>
          <span className="flex max-w-md flex-col items-center gap-2">
            <FileWarning className="size-5 text-amber-500" />
            <span className="font-medium text-foreground">
              Controller {fileName} is registered but could not be read.
            </span>
            <span className="text-xs">{read.message}</span>
          </span>
        </PlaceholderPane>
      );
    }
    return (
      <PlaceholderPane>
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Loading {fileName}…
        </span>
      </PlaceholderPane>
    );
  }

  // (c) Editable contents.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="truncate font-mono text-sm" title={fileName}>
          {fileName}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ScriptEditor
          value={text}
          // Controller edits mark the component dirty (so Save persists the Lua)
          // but create NO document-history step (task 472): Monaco owns this
          // buffer's fine-grained undo/redo natively, reachable because the
          // window-level Cmd+Z handler steps aside while Monaco is focused.
          onChange={(value) => dispatch({ type: "setControllerText", text: value })}
        />
      </div>
    </div>
  );
}

/**
 * The Add-script affordance for a controller-less component: an editable default
 * filename and a button that attaches the controller (in editor state only —
 * Save creates the file). The name is normalized to end in `.lua` on add.
 */
function AddScriptPane({
  componentName,
  onAdd,
}: {
  componentName: string;
  onAdd: (fileName: string) => void;
}) {
  const [name, setName] = useState(() => defaultControllerFileName(componentName));
  const normalized = normalizeControllerFileName(name);
  // Valid only if there is an actual stem before the `.lua` suffix.
  const valid = normalized.length > ".lua".length;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <FilePlus2 className="size-6 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-foreground text-sm">No controller yet</p>
          <p className="text-muted-foreground text-xs">
            Attach a Lua controller to this component. The file is created when you save.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            spellCheck={false}
            aria-label="Controller filename"
            className="font-mono text-sm"
          />
          <Button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (valid) onAdd(normalized);
            }}
          >
            Add script
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlaceholderPane({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
