import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiReferencePane } from "@/components/workbench/ApiReferencePane";
import { anyTabDirty, removeTab, setTabDirty } from "@/components/workbench/dirtyMap";
import type { GameObject } from "@/components/workbench/gameObjects";
import { scriptReach } from "@/components/workbench/gameObjects";
import { ObjectList } from "@/components/workbench/ObjectList";
import {
  openScriptCounts,
  ScriptSyncProvider,
  useScriptSyncRegistry,
} from "@/components/workbench/scriptSync";
import { TabBar } from "@/components/workbench/TabBar";
import { TabWorkspace } from "@/components/workbench/TabWorkspace";
import { closeTab, openTab, tabKey, type WorkbenchTab } from "@/components/workbench/tabs";

export interface WorkbenchProps {
  /**
   * Report whether ANY open tab has unsaved changes. The shell ({@link App})
   * uses this to guard leaving the Workbench tool — Workbench UNMOUNTS on a tool
   * switch, so the guard must live above it.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The Workbench: a code-and-data workspace over game objects.
 *
 * Left: a grouped, searchable object list. Center: a stack of OPEN TABS (tabs
 * ARE objects). Each open tab is rendered as a {@link TabWorkspace}; all open
 * tabs stay MOUNTED and inactive ones are HIDDEN via CSS so their dirty/draft
 * state survives tab switches (and, later, cross-tab shared-script refresh).
 * Right: a SINGLE {@link ApiReferencePane} spanning all tabs — GAME_API is
 * static and identical for every tab, so it lives here (one shared collapse
 * toggle) rather than inside each tab. It holds no save-bus state.
 *
 * The shell tracks per-tab dirtiness (reported up by each TabWorkspace) to gate
 * three unsaved-changes guards: closing a dirty tab, leaving the Workbench tool
 * (handled in {@link App} via `onDirtyChange`), and closing/reloading the app.
 */
export default function Workbench({ onDirtyChange }: WorkbenchProps) {
  const [objects, setObjects] = useState<GameObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tabs, setTabs] = useState<WorkbenchTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Per-tab dirtiness, reported up by each TabWorkspace and keyed by tabKey.
  const [dirtyByTab, setDirtyByTab] = useState<Record<string, boolean>>({});
  const anyDirty = anyTabDirty(dirtyByTab);

  const handleTabDirtyChange = useCallback((key: string, dirty: boolean) => {
    setDirtyByTab((prev) => setTabDirty(prev, key, dirty));
  }, []);

  // Surface aggregate dirtiness to the shell (leave-the-tool guard lives there).
  useEffect(() => {
    onDirtyChange?.(anyDirty);
  }, [anyDirty, onDirtyChange]);

  // Warn on app close / reload while any tab is dirty. Registered only while
  // dirty so a clean Workbench never blocks an intentional reload.
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  // Reach per script file, derived once from the already-loaded object list so
  // each tab's script pane can show "shared by N" without re-fetching. Computed
  // via the shared `scriptReach` helper to keep the empty-name / exact-match
  // semantics identical to the rest of the app.
  const reachByScript = useMemo(() => {
    const map = new Map<string, number>();
    for (const obj of objects) {
      if (obj.script.trim().length === 0 || map.has(obj.script)) continue;
      map.set(obj.script, scriptReach(objects, obj.script));
    }
    return map;
  }, [objects]);

  // The ONE script-sync registry for this Workbench, shared by every tab's
  // script pane so a save in one tab can fan out to its siblings.
  const scriptSync = useScriptSyncRegistry();

  // How many OPEN tabs reference each script file (dynamic, unlike reachByScript
  // which counts game objects). A count > 1 means the file is "also open in
  // another tab" for each of those tabs.
  const openCounts = useMemo(() => openScriptCounts(tabs), [tabs]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<GameObject[]>("get_game_objects")
      .then((result) => {
        if (!cancelled) setObjects(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load game objects.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpen = useCallback((obj: GameObject) => {
    setTabs((prev) => {
      const result = openTab(prev, obj);
      setActiveKey(result.activeKey);
      return result.tabs;
    });
  }, []);

  const handleClose = useCallback(
    (key: string) => {
      // Guard: a dirty tab prompts before discarding its unsaved drafts.
      if (dirtyByTab[key] && !window.confirm("This tab has unsaved changes. Close it anyway?")) {
        return;
      }
      setTabs((prev) => {
        const result = closeTab(prev, key, activeKey);
        setActiveKey(result.activeKey);
        return result.tabs;
      });
      // Drop the closed tab's dirty entry so it can't keep anyDirty pinned true.
      setDirtyByTab((prev) => removeTab(prev, key));
    },
    [activeKey, dirtyByTab],
  );

  return (
    <div className="flex h-full min-h-0">
      <ObjectList
        objects={objects}
        loading={loading}
        error={error}
        activeKey={activeKey}
        onOpen={handleOpen}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tabs.length > 0 && (
          <TabBar tabs={tabs} activeKey={activeKey} onSelect={setActiveKey} onClose={handleClose} />
        )}

        <div className="relative min-h-0 flex-1">
          {tabs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              Select an object to open it.
            </div>
          ) : (
            <ScriptSyncProvider value={scriptSync}>
              {tabs.map((tab) => {
                const key = tabKey(tab);
                return (
                  <div key={key} className="absolute inset-0">
                    <TabWorkspace
                      tab={tab}
                      hidden={key !== activeKey}
                      scriptReach={reachByScript.get(tab.scriptName) ?? 0}
                      alsoOpenElsewhere={(openCounts.get(tab.scriptName) ?? 0) > 1}
                      onDirtyChange={(dirty) => handleTabDirtyChange(key, dirty)}
                    />
                  </div>
                );
              })}
            </ScriptSyncProvider>
          )}
        </div>
      </div>

      {/* ONE shared API reference for the whole Workbench. GAME_API is static and
          identical for every tab, so it lives at the shell level (its native
          collapsible rail is the single global toggle) rather than per-tab. It
          touches no save-bus state. h-full bounds its internal scroll. */}
      <div className="h-full min-h-0 shrink-0">
        <ApiReferencePane defaultCollapsed />
      </div>
    </div>
  );
}
