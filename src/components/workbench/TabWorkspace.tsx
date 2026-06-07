import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SaveBusProvider, useSaveBus, useSaveTarget } from "./saveBus";
import type { WorkbenchTab } from "./tabs";

export interface TabWorkspaceProps {
  tab: WorkbenchTab;
  /** Hidden tabs stay MOUNTED (display:none) to preserve their draft state. */
  hidden: boolean;
}

/**
 * The workspace for ONE open tab: a collapsible 3-pane layout (DATA left, SCRIPT
 * center, API right) defaulting to SCRIPT-ONLY. Owns its own save bus so panes
 * register against this tab instance and nothing leaks across tabs.
 *
 * Panes are PLACEHOLDER SLOTS in this task. The real DATA/SCRIPT/API panes plug
 * into the bus via later tasks. One placeholder registers a dummy save target so
 * the bus is demonstrably wired end-to-end.
 */
export function TabWorkspace({ tab, hidden }: TabWorkspaceProps) {
  // Default SCRIPT-ONLY: both flanks collapsed.
  const [dataOpen, setDataOpen] = useState(false);
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
            <Pane label="Data" side="left" className="w-72 shrink-0 border-r">
              <DataPanePlaceholder tab={tab} />
            </Pane>
          )}

          <Pane label="Script" side="center" className="min-w-0 flex-1">
            <ScriptPanePlaceholder tab={tab} />
          </Pane>

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
// Placeholder panes. Real panes land in later tasks (423/424/425/etc).
// ---------------------------------------------------------------------------

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-center text-muted-foreground text-sm">
      <span>{children}</span>
    </div>
  );
}

function DataPanePlaceholder({ tab }: { tab: WorkbenchTab }) {
  // PLACEHOLDER: registers a dummy DATA save target to prove the bus is wired.
  // The real data pane (later task) replaces this with actual edit state.
  const [dirty, setDirty] = useState(false);
  useSaveTarget({
    id: "data",
    order: 0, // DATA / pointer saves run BEFORE the script.
    dirty,
    save: async () => {
      // Placeholder save: no-op. Real persistence arrives with the data pane.
      setDirty(false);
    },
  });

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground text-sm">
      <span>Data pane</span>
      <span className="text-muted-foreground/60 text-xs">
        Editing {tab.objectType} “{tab.id}”
      </span>
      <Button
        variant="outline"
        size="xs"
        onClick={() => setDirty((v) => !v)}
        className="not-sr-only"
      >
        {dirty ? "Mark clean (placeholder)" : "Mark dirty (placeholder)"}
      </Button>
    </div>
  );
}

function ScriptPanePlaceholder({ tab }: { tab: WorkbenchTab }) {
  return (
    <Placeholder>
      {tab.scriptName
        ? `Script editor — ${tab.scriptName}`
        : "Script editor (no script for this object)"}
    </Placeholder>
  );
}

function ApiPanePlaceholder() {
  return <Placeholder>API reference</Placeholder>;
}

export default TabWorkspace;
