import { invoke } from "@tauri-apps/api/core";
import { FilePlus2, FileWarning, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ScriptEditor } from "@/components/ScriptEditor";
import { Button } from "@/components/ui/button";
import { fetchScriptMtimeSig } from "@/lib/entities/diskMtime";
import { attachScript, canAttachScript } from "./attachScript";
import { useConflictPrompt } from "./ConflictDialog";
import { guardedWrite, SaveCancelled } from "./diskGuard";
import type { GameObjectType } from "./gameObjects";
import { useRequestSave, useSaveTarget } from "./saveBus";
import { noteScriptSaved, onScriptsChanged, scriptBasename, wasScriptSavedByApp } from "./scriptDiskSync";
import { useScriptSync } from "./scriptSync";

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
  /** The tab's object type — drives the starter template when adding a script. */
  objectType: GameObjectType;
  /** The tab's object id — the record pointed at a newly-attached script. */
  objectId: string;
  /**
   * Called after a script is attached to a previously script-less object, with
   * the new file name, so the shell can update the tab's `scriptName` — which
   * re-loads this pane into the editor.
   */
  onScriptAttached: (scriptName: string) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "scriptless" }
  | { kind: "error"; message: string }
  | { kind: "contents" };

export function ScriptPane({
  scriptName,
  objectType,
  objectId,
  onScriptAttached,
}: ScriptPaneProps) {
  // A stable identity for THIS pane instance, used as the publish `originId` so a
  // pane can skip reacting to its own save.
  const originId = useId();
  const sync = useScriptSync();

  const [load, setLoad] = useState<LoadState>(() =>
    scriptName.trim().length === 0 ? { kind: "scriptless" } : { kind: "loading" },
  );
  // The baseline contents from disk. `value` is the working draft. Both are only
  // meaningful in the "contents" state.
  const [loaded, setLoaded] = useState("");
  const [value, setValue] = useState("");

  const dirty = load.kind === "contents" && value !== loaded;

  // The mtime signature of the script `.lua` as of the last disk read (load,
  // save, or clean adopt). The save guard compares the current on-disk signature
  // to this to detect an external edit before clobbering (see diskGuard).
  const mtimeSigRef = useRef<string | null>(null);

  // Fetch the script whenever the tab points at a different file. An empty name
  // short-circuits to script-less WITHOUT calling get_script.
  useEffect(() => {
    if (scriptName.trim().length === 0) {
      setLoad({ kind: "scriptless" });
      setLoaded("");
      setValue("");
      mtimeSigRef.current = null;
      return;
    }

    let cancelled = false;
    setLoad({ kind: "loading" });
    Promise.all([
      invoke<string | null>("get_script", { name: scriptName }),
      fetchScriptMtimeSig(scriptName),
    ])
      .then(([contents, sig]) => {
        if (cancelled) return;
        mtimeSigRef.current = sig;
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
  // The on-disk baseline, read by the disk-sync listener to detect (a) whether a
  // re-read actually differs from what we have and (b) our own save echoing back.
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const scriptNameRef = useRef(scriptName);
  scriptNameRef.current = scriptName;

  const confirmConflict = useConflictPrompt();
  const save = useCallback(async () => {
    const name = scriptNameRef.current;
    if (name.trim().length === 0) return; // nothing to persist for a script-less tab
    const outcome = await guardedWrite({
      capturedSig: mtimeSigRef.current,
      fetchSig: () => fetchScriptMtimeSig(name),
      confirmConflict: () => confirmConflict(name),
      reload: async () => {
        const [contents, sig] = await Promise.all([
          invoke<string | null>("get_script", { name }),
          fetchScriptMtimeSig(name),
        ]);
        mtimeSigRef.current = sig;
        if (contents == null) return; // vanished / script-less — keep the buffer
        setLoaded(contents);
        setValue(contents);
      },
      write: async () => {
        const draft = valueRef.current;
        await invoke("save_script", { name, contents: draft });
        // Record what we just wrote so the disk-sync listener recognizes (and
        // ignores) this save echoing back through the watcher (see scriptDiskSync).
        noteScriptSaved(name, draft);
        setLoaded(draft); // draft is the new baseline; clears dirty
        // Fan out to any SIBLING tab showing the same file so it refreshes to the
        // just-saved contents (no re-fetch — the draft IS the new disk state).
        sync.publish(name, draft, originId);
      },
    });
    if (outcome.kind === "written") mtimeSigRef.current = outcome.sig;
    else if (outcome.kind === "cancelled") throw new SaveCancelled();
  }, [sync, originId, confirmConflict]);

  // Subscribe to sibling saves of THIS file. The listener reads live state via
  // refs so it never needs to re-subscribe per keystroke — only when the file
  // (scriptName) or the bus/origin identity changes.
  useEffect(() => {
    if (scriptName.trim().length === 0) return; // script-less: nothing to sync
    const unsubscribe = sync.subscribe(scriptName, (contents, sourceId) => {
      if (sourceId === originId) return; // our own save — already applied locally
      if (contents === valueRef.current) return; // already in sync — no-op
      // Dirty pane: keep the user's edits; the save guard surfaces the conflict on
      // Save. Clean pane: silently adopt the sibling's saved contents and refresh
      // the mtime baseline so a later save doesn't false-conflict on this write.
      if (dirtyRef.current) return;
      setLoaded(contents);
      setValue(contents);
      void fetchScriptMtimeSig(scriptName).then((s) => {
        mtimeSigRef.current = s;
      });
    });
    return unsubscribe;
  }, [scriptName, sync, originId]);

  // Subscribe to EXTERNAL (on-disk) edits of THIS file — e.g. saved from VS Code via
  // the "Open in VS Code" button, a file move, a git checkout. The backend watcher
  // emits `scripts-changed` with the changed basename; when it names our file we
  // re-fetch the fresh contents (the cache was invalidated before the event) and
  // apply the same trust model as the sibling sync above. Reads live state via refs
  // so it never re-subscribes per keystroke — only when the file (scriptName) changes.
  useEffect(() => {
    if (scriptName.trim().length === 0) return; // script-less: nothing to sync
    const mine = scriptBasename(scriptName);
    return onScriptsChanged((changed) => {
      // A null payload can't be attributed to a file; ignore rather than re-fetch
      // every open pane. A named change that isn't ours is not our concern.
      if (changed == null || scriptBasename(changed) !== mine) return;
      void invoke<string | null>("get_script", { name: scriptNameRef.current })
        .then((contents) => {
          // A vanished file (null / read error) must never blank a live editor —
          // keep what the user has rather than destroying it on an external delete.
          if (contents == null) return;
          // Our own save echoing back through the watcher, or disk already matches
          // our baseline: nothing changed externally.
          if (wasScriptSavedByApp(scriptNameRef.current, contents)) return;
          if (contents === loadedRef.current) return;
          // Dirty pane: keep the user's edits; the save guard surfaces the conflict
          // on Save. Clean pane: adopt the external contents and refresh the mtime
          // baseline so a later save doesn't false-conflict on this same edit.
          if (dirtyRef.current) return;
          setLoaded(contents);
          setValue(contents);
          void fetchScriptMtimeSig(scriptNameRef.current).then((s) => {
            mtimeSigRef.current = s;
          });
        })
        .catch(() => {
          // Read failed (e.g. broken install mid-edit) — keep the current buffer.
        });
    });
  }, [scriptName]);

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

  // The script file name + share badges that used to head this pane now live in
  // the tab toolbar (folded up with the Data header), so the pane is just the
  // full-bleed editor.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {load.kind === "contents" ? (
          <ScriptEditor value={value} onChange={setValue} onSave={handleEditorSave} />
        ) : (
          <ScriptEditor
            value=""
            onChange={noop}
            placeholder={
              <PaneStatus
                load={load}
                scriptName={scriptName}
                objectType={objectType}
                objectId={objectId}
                onScriptAttached={onScriptAttached}
              />
            }
          />
        )}
      </div>
    </div>
  );
}

function PaneStatus({
  load,
  scriptName,
  objectType,
  objectId,
  onScriptAttached,
}: {
  load: LoadState;
  scriptName: string;
  objectType: GameObjectType;
  objectId: string;
  onScriptAttached: (scriptName: string) => void;
}) {
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
  // scriptless — offer to attach one (types that can't take a script just say so).
  return (
    <ScriptlessPane
      objectType={objectType}
      objectId={objectId}
      onScriptAttached={onScriptAttached}
    />
  );
}

/**
 * The script-less state: a message plus an "Add script" button that mints a
 * starter script for this object and points the record at it (see
 * {@link attachScript}). On success the tab's `scriptName` flips to the new file
 * and this pane re-loads into the editor, so this component is torn down — hence
 * `busy` stays set through success (no spinner flip-back before unmount).
 */
function ScriptlessPane({
  objectType,
  objectId,
  onScriptAttached,
}: {
  objectType: GameObjectType;
  objectId: string;
  onScriptAttached: (scriptName: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canAttachScript(objectType)) {
    return <span>This object has no script.</span>;
  }

  async function handleAdd() {
    setBusy(true);
    setError(null);
    const result = await attachScript(objectType, objectId);
    if (result.ok) {
      onScriptAttached(result.script);
      return; // pane is about to unmount as the tab flips to the new script
    }
    setBusy(false);
    setError(result.message);
  }

  return (
    <div className="flex max-w-sm flex-col items-center gap-3">
      <p className="font-medium text-foreground text-sm">No script yet</p>
      <p className="text-muted-foreground text-xs">
        Attach a Lua script to this {objectType.toLowerCase()}. It creates a starter script and
        points this object at it.
      </p>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button type="button" disabled={busy} onClick={() => void handleAdd()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
        Add script
      </Button>
    </div>
  );
}

function noop() {}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
