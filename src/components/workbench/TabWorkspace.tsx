import {
  CircleAlert,
  FileCode2,
  LineChart,
  Loader2,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type AutoSaveController,
  AutoSaveControllerProvider,
  type AutoSaveStatus,
} from "./autoSave";
import { BundleEditorPane } from "./BundleEditorPane";
import { CreatureChartPane } from "./CreatureChartPane";
import { CreatureDataPane } from "./CreatureDataPane";
import { CreatureTabProvider } from "./creatureTab";
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
import { UndoRegistryProvider, type UndoTarget } from "./undo";

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

/** Debounce from the last data edit before an auto-save fires. */
const DATA_AUTOSAVE_MS = 700;

/**
 * The workspace for ONE open tab: a collapsible 2-pane layout (DATA left, SCRIPT
 * center). Owns its own save bus so panes register against this tab instance and
 * nothing leaks across tabs.
 *
 * SAVE MODEL: DATA persists itself — data targets auto-save (debounced) and show
 * a quiet "Saving…/Saved" indicator. SCRIPTS are manual: the "Save Script"
 * button, the window-level ⌘S (active tab only), or Monaco's in-editor ⌘S
 * persist the script — and flush any pending data write first so a forced save
 * never races the debounce. The unsaved dot + leave/close guards track the
 * SCRIPT (the only thing needing a conscious save). The API reference is a single
 * static pane lifted to the shell, not here.
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
  // Creatures can flip the center region between the aiController SCRIPT (the
  // default, editable) and a read-only STATS graph. Per-tab state, defaults to
  // the script so the tab opens as a code lens.
  const [creatureView, setCreatureView] = useState<"script" | "chart">("script");

  const bus = useSaveBus();

  // The active data editor's undo handlers (creatures/flat/bundle/pack register
  // exactly one). Drives the toolbar undo/redo buttons + Ctrl+Z keybinding.
  const [undoTarget, setUndoTarget] = useState<UndoTarget | null>(null);
  const undoTargetRef = useRef(undoTarget);
  undoTargetRef.current = undoTarget;
  const undoRegistry = useMemo(() => ({ set: setUndoTarget }), []);
  const commitUndoStep = useCallback(() => undoTargetRef.current?.commit(), []);

  // The SCRIPT (manual) save summary: a quiet "Saved" on success (auto-clears)
  // or a persistent error (cleared on the next script edit/save).
  const [status, setStatus] = useState<SaveSummary | null>(null);
  // The DATA auto-save indicator — quiet "Saving…/Saved", persistent on error.
  const [autoStatus, setAutoStatus] = useState<AutoSaveStatus>({ kind: "idle" });

  // Report SCRIPT dirtiness up: the unsaved dot + close/leave/unload guards track
  // the script (data auto-saves, so it isn't unsaved work needing a conscious
  // Save). Fire only on transitions to avoid redundant parent setState churn.
  const lastDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastDirtyRef.current === bus.manualDirty) return;
    lastDirtyRef.current = bus.manualDirty;
    onDirtyChange?.(bus.manualDirty);
  }, [bus.manualDirty, onDirtyChange]);

  // A fresh SCRIPT edit invalidates any lingering script status (esp. an error).
  useEffect(() => {
    if (bus.manualDirty) setStatus(null);
  }, [bus.manualDirty]);

  // Auto-clear the script success confirmation after a couple seconds. Errors persist.
  useEffect(() => {
    if (!status?.ok || status.message.length === 0) return;
    const timer = setTimeout(() => setStatus(null), SAVED_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Auto-clear the data "Saved" tick; "saving"/"error" persist.
  useEffect(() => {
    if (autoStatus.kind !== "saved") return;
    const timer = setTimeout(() => setAutoStatus({ kind: "idle" }), SAVED_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [autoStatus]);

  // Shared with the data panes: debounce delay, the quiet status report, and the
  // post-save object-list refresh. Stable identity so consumers don't churn.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const refresh = useCallback(() => onSavedRef.current?.(), []);
  const autoSaveController = useMemo<AutoSaveController>(
    () => ({ delayMs: DATA_AUTOSAVE_MS, report: setAutoStatus, onSaved: refresh }),
    [refresh],
  );

  // "Save Script": flush any pending DATA write first (so a forced save never
  // races the debounce), then persist the manual (script) targets and summarize.
  const saveAutoRef = useRef(bus.saveAuto);
  saveAutoRef.current = bus.saveAuto;
  const saveManualRef = useRef(bus.saveManual);
  saveManualRef.current = bus.saveManual;
  const handleSaveScript = useCallback(async () => {
    await saveAutoRef.current();
    const outcomes = await saveManualRef.current();
    const summary = summarizeOutcomes(outcomes);
    if (summary.message.length === 0) return; // no-op (script wasn't dirty)
    setStatus(summary);
    if (summary.ok) onSavedRef.current?.();
  }, []);

  // Window-level shortcuts for the active (non-hidden) tab: ⌘S/Ctrl+S saves the
  // script (flushing pending data first); Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y)
  // undo/redo the DATA draft. Scripts undo inside Monaco, so we defer when it's
  // focused; elsewhere we override native input undo (app-level data undo).
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (hiddenRef.current) return; // inactive tab: let the active one handle it
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void handleSaveScript();
        return;
      }
      if (key === "z" || key === "y") {
        const el = e.target as HTMLElement | null;
        if (el?.closest?.(".monaco-editor")) return; // Monaco owns its own undo
        const target = undoTargetRef.current;
        if (!target) return;
        e.preventDefault(); // override native per-input undo
        const redo = key === "y" || (key === "z" && e.shiftKey);
        if (redo) {
          if (target.canRedo) target.redo();
        } else if (target.canUndo) {
          target.undo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveScript]);

  return (
    <SaveBusProvider value={bus.registry}>
      <AutoSaveControllerProvider value={autoSaveController}>
        <RequestSaveProvider value={handleSaveScript}>
          <UndoRegistryProvider value={undoRegistry}>
            {/* onBlur bubbles (focusout): leaving any data field closes the
                current undo step, so one Ctrl+Z reverts one field's change. */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: passive focusout boundary, not an interactive control */}
            <div
              className={cn("flex h-full min-h-0 flex-col", hidden && "hidden")}
              onBlur={commitUndoStep}
            >
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
                {/* Creatures get a segmented control to swap the center region between
                the aiController script and the stats graph. */}
                {isCreature && (
                  <div className="ml-1 flex items-center gap-0.5 rounded-md border p-0.5">
                    <ViewToggleButton
                      active={creatureView === "script"}
                      onClick={() => setCreatureView("script")}
                      Icon={FileCode2}
                      label="Script"
                    />
                    <ViewToggleButton
                      active={creatureView === "chart"}
                      onClick={() => setCreatureView("chart")}
                      Icon={LineChart}
                      label="Stats"
                    />
                  </div>
                )}
                {/* Undo/redo for the data draft (Ctrl+Z). Present whenever a data
                  editor is mounted; scripts undo inside Monaco, not here. */}
                {undoTarget && (
                  <div className="ml-1 flex items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Undo (Ctrl+Z)"
                      disabled={!undoTarget.canUndo}
                      onClick={() => undoTarget.undo()}
                    >
                      <Undo2 />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Redo (Ctrl+Shift+Z)"
                      disabled={!undoTarget.canRedo}
                      onClick={() => undoTarget.redo()}
                    >
                      <Redo2 />
                    </Button>
                  </div>
                )}
                {/* The object name is NOT repeated here: it already shows on the tab
                (TabBar) and in the Data pane's Details/Name field, so a toolbar copy
                was a redundant third instance. The unsaved-changes dot likewise lives
                on the tab, so the toolbar doesn't repeat it either. */}
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
                <div className="ml-auto flex items-center gap-2">
                  <AutoSaveIndicator status={autoStatus} />
                  {/* Scripts save manually; bundles/packs are script-less, so the
                  button only appears when the tab actually has a script. */}
                  {bus.hasManualTarget && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!bus.manualDirty}
                      onClick={() => void handleSaveScript()}
                    >
                      <Save />
                      Save Script
                    </Button>
                  )}
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
                ) : isCreature ? (
                  // Creatures share ONE draft across both panes via the provider, so
                  // the stats graph reflects live (unsaved) edits and a focused stat
                  // box drives the chart. The provider is always mounted (outside the
                  // dataOpen / view toggles) so the draft + save target never unmount.
                  <CreatureTabProvider id={tab.id}>
                    {dataOpen && (
                      // The creature form (stat grids, unlocks) is much taller and
                      // wider than the flat-type field grid, so give it more room.
                      <Pane label="Data" side="left" className="w-[28rem] shrink-0 border-r">
                        <CreatureDataPane />
                      </Pane>
                    )}

                    <section
                      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
                      aria-label={creatureView === "chart" ? "Stats graph" : "Script"}
                    >
                      {/* Keep the script editor MOUNTED (hidden) when the chart is
                      shown so its unsaved edits and save-bus registration survive
                      the toggle. */}
                      <div
                        className={cn(
                          "flex min-h-0 flex-1 flex-col",
                          creatureView === "chart" && "hidden",
                        )}
                      >
                        <ScriptPane
                          scriptName={tab.scriptName}
                          reach={scriptReach}
                          alsoOpenElsewhere={alsoOpenElsewhere}
                        />
                      </div>
                      {creatureView === "chart" && <CreatureChartPane />}
                    </section>
                  </CreatureTabProvider>
                ) : (
                  <>
                    {dataOpen && (
                      <Pane label="Data" side="left" className="w-72 shrink-0 border-r">
                        <DataPane objectType={tab.objectType} id={tab.id} />
                      </Pane>
                    )}

                    {/* The Script pane owns its own header (names the file + reach) and
                    a full-bleed editor, so it bypasses the generic Pane chrome.
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
          </UndoRegistryProvider>
        </RequestSaveProvider>
      </AutoSaveControllerProvider>
    </SaveBusProvider>
  );
}

/** Quiet data auto-save indicator: a spinner while saving, a persistent error. */
function AutoSaveIndicator({ status }: { status: AutoSaveStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "saving") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-xs">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status.kind === "saved") {
    return <span className="text-muted-foreground text-xs">Saved</span>;
  }
  return (
    <span
      className="flex items-center gap-1 font-medium text-destructive text-xs"
      title={status.message}
    >
      <CircleAlert className="size-3" />
      Couldn’t save
    </span>
  );
}

/** One segment of the creature center-view toggle (Script / Stats). */
function ViewToggleButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-2 py-1 font-medium text-xs transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
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
