import { invoke } from "@tauri-apps/api/core";
import { FileWarning, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScriptEditor } from "@/components/ScriptEditor";
import { useRequestSave, useSaveTarget } from "./saveBus";

/**
 * The SCRIPT pane for one Workbench tab: loads the tab's script by name and
 * plugs the controlled {@link ScriptEditor} into the per-tab save bus.
 *
 * The backend's `get_script` is a THREE-STATE contract and this pane mirrors it
 * onto the editor's `placeholder` vs. live-editor surfaces:
 *  - (a) script-less   — `scriptName` empty, or `get_script` returns `null` →
 *        a clear "no script yet" placeholder (NOT an editable blank).
 *  - (b) broken install — `get_script` throws (manifest references a file that
 *        is missing on disk) → a legible error placeholder naming the file.
 *  - (c) contents      — a string comes back → the editable Monaco editor.
 * Plus a brief loading placeholder while the fetch is in flight.
 *
 * Dirty is meaningful only in state (c): `value !== loaded`. The save target is
 * registered at order 10 — strictly ABOVE the data pane's order 0 — so any
 * data/pointer write lands before the script write (a script save may depend on
 * the record existing).
 */
export interface ScriptPaneProps {
  /** The script FILE this tab points at — "" when the object is script-less. */
  scriptName: string;
  /** How many game objects point at `scriptName` (incl. this one). >1 ⇒ shared. */
  reach: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "scriptless" }
  | { kind: "error"; message: string }
  | { kind: "contents" };

export function ScriptPane({ scriptName, reach }: ScriptPaneProps) {
  const [load, setLoad] = useState<LoadState>(() =>
    scriptName.trim().length === 0 ? { kind: "scriptless" } : { kind: "loading" },
  );
  // The baseline contents from disk. `value` is the working draft. Both are only
  // meaningful in the "contents" state.
  const [loaded, setLoaded] = useState("");
  const [value, setValue] = useState("");

  const dirty = load.kind === "contents" && value !== loaded;

  // Fetch the script whenever the tab points at a different file. An empty name
  // short-circuits to script-less WITHOUT calling get_script.
  useEffect(() => {
    if (scriptName.trim().length === 0) {
      setLoad({ kind: "scriptless" });
      setLoaded("");
      setValue("");
      return;
    }

    let cancelled = false;
    setLoad({ kind: "loading" });
    invoke<string | null>("get_script", { name: scriptName })
      .then((contents) => {
        if (cancelled) return;
        if (contents == null) {
          // (a) registered-but-script-less: backend says no script for this name.
          setLoad({ kind: "scriptless" });
          setLoaded("");
          setValue("");
          return;
        }
        // (c) contents.
        setLoaded(contents);
        setValue(contents);
        setLoad({ kind: "contents" });
      })
      .catch((err) => {
        if (cancelled) return;
        // (b) broken install (manifest-present, file-missing) or other error.
        setLoad({ kind: "error", message: errorMessage(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [scriptName]);

  // Refs so the bus `save` closure can read the latest draft / name without
  // being recreated on every keystroke. The bus re-registers a target whenever
  // its `save` identity changes (see useSaveTarget deps), so a stable `save`
  // keeps re-registration scoped to dirty toggling.
  const valueRef = useRef(value);
  valueRef.current = value;
  const scriptNameRef = useRef(scriptName);
  scriptNameRef.current = scriptName;

  const save = useCallback(async () => {
    const name = scriptNameRef.current;
    const draft = valueRef.current;
    if (name.trim().length === 0) return; // nothing to persist for a script-less tab
    await invoke("save_script", { name, contents: draft });
    // Persist succeeded → the draft is the new baseline; clears dirty.
    setLoaded(draft);
  }, []);

  useSaveTarget({
    id: "script",
    order: 10, // ABOVE the data pane (order 0): data/pointer saves run first.
    dirty,
    save,
  });

  // ⌘S inside Monaco triggers the tab's UNIFIED save (data before script, all
  // dirty targets) — the same path as the toolbar Save — so an in-editor save
  // can never persist the script while leaving a dirty data record behind.
  const requestSave = useRequestSave();
  const handleEditorSave = useCallback(() => {
    requestSave();
  }, [requestSave]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScriptHeader scriptName={scriptName} reach={reach} />
      <div className="min-h-0 flex-1">
        {load.kind === "contents" ? (
          <ScriptEditor value={value} onChange={setValue} onSave={handleEditorSave} />
        ) : (
          <ScriptEditor
            value=""
            onChange={noop}
            placeholder={<PaneStatus load={load} scriptName={scriptName} />}
          />
        )}
      </div>
    </div>
  );
}

function ScriptHeader({ scriptName, reach }: { scriptName: string; reach: number }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-1.5">
      <span className="truncate font-mono text-sm" title={scriptName || undefined}>
        {scriptName || "No script"}
      </span>
      {reach > 1 && (
        <span
          className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs"
          title={`This script is shared by ${reach} game objects — edits affect all of them.`}
        >
          shared by {reach} objects
        </span>
      )}
    </div>
  );
}

function PaneStatus({ load, scriptName }: { load: LoadState; scriptName: string }) {
  if (load.kind === "loading") {
    return (
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" />
        Loading {scriptName}…
      </span>
    );
  }
  if (load.kind === "error") {
    return (
      <span className="flex max-w-md flex-col items-center gap-2">
        <FileWarning className="size-5 text-amber-500" />
        <span className="font-medium text-foreground">
          Script {scriptName} is registered but missing on disk.
        </span>
        <span className="text-xs">{load.message}</span>
      </span>
    );
  }
  // scriptless
  return <span>This object has no script yet.</span>;
}

function noop() {}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
