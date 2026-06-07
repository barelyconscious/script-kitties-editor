import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DataPane } from "./DataPane";
import { ScriptPane } from "./ScriptPane";
import { SaveBusProvider, useSaveBus } from "./saveBus";
import type { WorkbenchTab } from "./tabs";

export interface TabWorkspaceProps {
  tab: WorkbenchTab;
  /** Hidden tabs stay MOUNTED (display:none) to preserve their draft state. */
  hidden: boolean;
  /**
   * How many game objects point at this tab's script file. Threaded from the
   * shell (which already loaded the object list) so the script pane can surface
   * "shared by N" without re-fetching. 0/1 ⇒ not shared.
   */
  scriptReach: number;
}

/**
 * The workspace for ONE open tab: a collapsible 3-pane layout (DATA left, SCRIPT
 * center, API right) defaulting to SCRIPT-ONLY. Owns its own save bus so panes
 * register against this tab instance and nothing leaks across tabs.
 *
 * The DATA pane (left) and SCRIPT pane (center) are real and register with the
 * bus; the API pane (right) is still a placeholder slot for a later task.
 */
export function TabWorkspace({ tab, hidden, scriptReach }: TabWorkspaceProps) {
  // For CREATURES the data pane (the full creature form) is the primary editing
  // surface, so it opens wide by default — a creature tab that showed only the
  // aiController script with the form hidden would be a poor default. Flat types
  // stay SCRIPT-ONLY (both flanks collapsed).
  const isCreature = tab.objectType === "Creature";
  const [dataOpen, setDataOpen] = useState(isCreature);
  const [apiOpen, setApiOpen] = useState(false);

  const bus = useSaveBus();

  return (
    <SaveBusProvider value={bus.registry}>
      <div className={cn("flex h-full min-h-0 flex-col", hidden && "hidden")}>
        {/* Per-tab toolbar: flank toggles + dirty dot + save. ⌘S wiring is task 427. */}
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title={dataOpen ? "Hide data pane" : "Show data pane"}
            aria-pressed={dataOpen}
            onClick={() => setDataOpen((v) => !v)}
          >
            {dataOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <span className="ml-1 truncate font-medium text-sm">{tab.name}</span>
          {bus.dirty && (
            <span
              role="status"
              className="size-2 shrink-0 rounded-full bg-amber-500"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={!bus.dirty}
              onClick={() => {
                // Basic Save button. Full partial-failure UX is task 427.
                void bus.saveAll();
              }}
            >
              <Save />
              Save
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={apiOpen ? "Hide API reference" : "Show API reference"}
              aria-pressed={apiOpen}
              onClick={() => setApiOpen((v) => !v)}
            >
              {apiOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {dataOpen && (
            <Pane
              label="Data"
              side="left"
              // The creature form (stat grids, chart, unlocks) is much taller
              // and wider than the flat-type field grid, so give it more room.
              className={cn("shrink-0 border-r", isCreature ? "w-[28rem]" : "w-72")}
            >
              <DataPane objectType={tab.objectType} id={tab.id} />
            </Pane>
          )}

          {/* Script pane owns its own header (names the file + reach) and a
              full-bleed editor, so it bypasses the generic Pane chrome. */}
          <section className="flex min-w-0 flex-1 flex-col bg-background" aria-label="Script">
            <ScriptPane scriptName={tab.scriptName} reach={scriptReach} />
          </section>

          {apiOpen && (
            <Pane label="API Reference" side="right" className="w-80 shrink-0 border-l">
              <ApiPanePlaceholder />
            </Pane>
          )}
        </div>
      </div>
    </SaveBusProvider>
  );
}

function Pane({
  label,
  className,
  children,
}: {
  label: string;
  side: "left" | "center" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col bg-background", className)} aria-label={label}>
      <header className="border-b px-3 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Placeholder panes. The real DATA/SCRIPT panes are wired above; the API pane
// lands in a later task.
// ---------------------------------------------------------------------------

function ApiPanePlaceholder() {
  return (
    <div className="flex h-full items-center justify-center text-center text-muted-foreground text-sm">
      <span>API reference</span>
    </div>
  );
}

export default TabWorkspace;
