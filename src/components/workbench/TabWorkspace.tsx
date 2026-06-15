import { PanelLeftClose, PanelLeftOpen, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BundleEditorPane } from "./BundleEditorPane";
import { DataPane } from "./DataPane";
import { PackEditorPane } from "./PackEditorPane";
import { ScriptPane } from "./ScriptPane";
import {
  RequestSaveProvider,
  SaveBusProvider,
  type SaveSummary,
  summarizeOutcomes,
  useSaveBus,
} from "./saveBus";
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
  /**
   * Whether another currently-OPEN tab shows the same script file. Distinct from
   * `scriptReach` (a static game-object count): this drives the dynamic "also
   * open in another tab" header signal. Derived in the shell from the open tabs.
   */
  alsoOpenElsewhere: boolean;
  /**
   * Report this tab's aggregate dirtiness UP to the shell so it can derive
   * "any tab dirty" for the leave-the-tool / before-unload guards and gate the
   * close-tab guard. Fires whenever the flag flips.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Fired after a successful save of this tab so the shell can refresh the object
   * list — an edited name/sprite must surface in the panel (and re-sort) without
   * a manual reload.
   */
  onSaved?: () => void;
}

/** How long a "Saved" confirmation lingers before auto-clearing. */
const SAVED_CLEAR_MS = 2500;

/**
 * The workspace for ONE open tab: a collapsible 2-pane layout (DATA left, SCRIPT
 * center) defaulting to SCRIPT-ONLY. Owns its own save bus so panes register
 * against this tab instance and nothing leaks across tabs.
 *
 * The DATA pane (left) and SCRIPT pane (center) both register with the bus. The
 * API reference is NOT here — it is a single static pane lifted to the Workbench
 * shell (one shared toggle across all tabs), since GAME_API is identical for
 * every tab and holds no bus state.
 *
 * SAVE TRUST MODEL (task 427): one Save action — the toolbar button, the
 * window-level ⌘S (active tab only), or Monaco's in-editor ⌘S — persists every
 * DIRTY target of THIS tab in order (data before script), then surfaces a single
 * summary. A partial failure NEVER reads as success.
 */
export function TabWorkspace({
  tab,
  hidden,
  scriptReach,
  alsoOpenElsewhere,
  onDirtyChange,
  onSaved,
}: TabWorkspaceProps) {
  // Every type opens with the DATA pane visible by default so an object's fields
  // are immediately editable. Creatures additionally get a wider pane (the full
  // creature form is much larger than the flat-type field grid).
  const isCreature = tab.objectType === "Creature";
  // Bundles & packs are script-less and get a BESPOKE, full-width editor pane:
  // no Data/Script split, no data-toggle. They still register one save target
  // with this tab's bus, so the shared Save button / ⌘S work unchanged.
  const isBespoke = tab.objectType === "Bundle" || tab.objectType === "Pack";
  const [dataOpen, setDataOpen] = useState(true);

  const bus = useSaveBus();

  // Inline save status: a quiet "Saved" on success (auto-clears) or a legible,
  // persistent error on failure (cleared on the next edit/save).
  const [status, setStatus] = useState<SaveSummary | null>(null);

  // Report dirtiness up. Fire only on transitions to avoid redundant parent
  // setState churn.
  const lastDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastDirtyRef.current === bus.dirty) return;
    lastDirtyRef.current = bus.dirty;
    onDirtyChange?.(bus.dirty);
  }, [bus.dirty, onDirtyChange]);

  // A fresh edit invalidates any lingering status (esp. a stale error).
  useEffect(() => {
    if (bus.dirty) setStatus(null);
  }, [bus.dirty]);

  // Auto-clear a success confirmation after a couple seconds. Errors persist.
  useEffect(() => {
    if (!status?.ok || status.message.length === 0) return;
    const timer = setTimeout(() => setStatus(null), SAVED_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // The single unified save. Runs the bus (dirty targets, in order), then maps
  // the outcomes to one summary. Empty (nothing dirty) is a true no-op: don't
  // flash "Saved".
  const saveAllRef = useRef(bus.saveAll);
  saveAllRef.current = bus.saveAll;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const handleSave = useCallback(async () => {
    const outcomes = await saveAllRef.current();
    const summary = summarizeOutcomes(outcomes);
    if (summary.message.length === 0) return; // no-op (nothing was dirty)
    setStatus(summary);
    // A real save landed — let the shell refresh the object list so an edited
    // name/sprite shows up in the panel. Skip on failure (nothing persisted).
    if (summary.ok) onSavedRef.current?.();
  }, []);

  // Window-level ⌘S / Ctrl+S — but ONLY for the active (non-hidden) tab. Every
  // open tab is mounted, so without this guard every tab's listener would fire.
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.key === "s" || e.key === "S")) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (hiddenRef.current) return; // inactive tab: let the active one handle it
      e.preventDefault();
      void handleSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  return (
    <SaveBusProvider value={bus.registry}>
      <RequestSaveProvider value={handleSave}>
        <div className={cn("flex h-full min-h-0 flex-col", hidden && "hidden")}>
          {/* Per-tab toolbar: flank toggles + dirty dot + save + status. */}
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            {/* No Data/Script split for bespoke (script-less) editors, so the
                data-pane toggle is hidden for them. */}
            {!isBespoke && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={dataOpen ? "Hide data pane" : "Show data pane"}
                aria-pressed={dataOpen}
                onClick={() => setDataOpen((v) => !v)}
              >
                {dataOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
              </Button>
            )}
            {/* Bespoke editors (bundle/pack) already show the name in the tab and
                in their own Details section, so the toolbar omits it to avoid a
                third copy. */}
            {!isBespoke && <span className="ml-1 truncate font-medium text-sm">{tab.name}</span>}
            {bus.dirty && (
              <span
                role="status"
                className="size-2 shrink-0 rounded-full bg-amber-500"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              />
            )}
            {status && status.message.length > 0 && (
              <span
                role="status"
                className={cn(
                  "ml-2 truncate text-xs",
                  status.ok ? "text-muted-foreground" : "font-medium text-destructive",
                )}
                title={status.message}
              >
                {status.message}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!bus.dirty}
                onClick={() => void handleSave()}
              >
                <Save />
                Save
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {isBespoke ? (
              // Bespoke full-width editor: owns its own scroll/padding region, no
              // Data/Script split. Registers its save target with this tab's bus.
              // `scrollbar-gutter: stable` always reserves the scrollbar's width so
              // a card grid inside doesn't lose a column the moment the vertical
              // scrollbar appears — it only reflows when the window truly shrinks.
              <section
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-background p-4 [scrollbar-gutter:stable]"
                aria-label="Data"
              >
                {tab.objectType === "Bundle" ? (
                  <BundleEditorPane id={tab.id} />
                ) : (
                  <PackEditorPane id={tab.id} />
                )}
              </section>
            ) : (
              <>
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
                    full-bleed editor, so it bypasses the generic Pane chrome.
                    min-h-0 + overflow-hidden BOUND this flex item so a tall Monaco
                    document scrolls INSIDE the editor instead of growing the section
                    (flex items default to min-height:auto). */}
                <section
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
                  aria-label="Script"
                >
                  <ScriptPane
                    scriptName={tab.scriptName}
                    reach={scriptReach}
                    alsoOpenElsewhere={alsoOpenElsewhere}
                  />
                </section>
              </>
            )}
          </div>
        </div>
      </RequestSaveProvider>
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

export default TabWorkspace;
