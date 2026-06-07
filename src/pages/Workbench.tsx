import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { GameObject } from "@/components/workbench/gameObjects";
import { ObjectList } from "@/components/workbench/ObjectList";
import { TabBar } from "@/components/workbench/TabBar";
import { TabWorkspace } from "@/components/workbench/TabWorkspace";
import { closeTab, openTab, tabKey, type WorkbenchTab } from "@/components/workbench/tabs";

/**
 * The Workbench: a code-and-data workspace over game objects.
 *
 * Left: a grouped, searchable object list. Center: a stack of OPEN TABS (tabs
 * ARE objects). Each open tab is rendered as a {@link TabWorkspace}; all open
 * tabs stay MOUNTED and inactive ones are HIDDEN via CSS so their dirty/draft
 * state survives tab switches (and, later, cross-tab shared-script refresh).
 *
 * Panes within a tab are placeholder slots today; the real DATA/SCRIPT/API panes
 * plug into the per-tab save bus in later tasks.
 */
export default function Workbench() {
  const [objects, setObjects] = useState<GameObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tabs, setTabs] = useState<WorkbenchTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

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
      setTabs((prev) => {
        const result = closeTab(prev, key, activeKey);
        setActiveKey(result.activeKey);
        return result.tabs;
      });
    },
    [activeKey],
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
            tabs.map((tab) => {
              const key = tabKey(tab);
              return (
                <div key={key} className="absolute inset-0">
                  <TabWorkspace tab={tab} hidden={key !== activeKey} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
