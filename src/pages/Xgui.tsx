/**
 * Xgui — the XGUI GUI-editor page shell (F8). Composes the three working columns
 * the design lays out (component list → structure column → main content) and
 * provides the shared open-component store every region reads/writes.
 *
 * This first runnable slice wires:
 *  • LEFT — the {@link ComponentList} (folder tree + create flow + open flow).
 *  • CENTER-LEFT — the structure column: the F9a tree over the F9b properties
 *    panel. Events are ordinary tree nodes, so there is no separate events slice.
 *  • MAIN — when a component is open, the existing F3 {@link GuiPreviewHost}
 *    (preview + Data Model panel) renders it, fed from the shared store. A
 *    clearly-marked SEAM marks where the View/Controller tab bar (F10) lands.
 *
 * The page stays MOUNTED across tool switches (like the Workbench) so an open
 * component and its unsaved edits survive leaving and returning — see {@link App}.
 *
 * @see design/xgui_ta.md — "High Level Visual Layout" (the three columns).
 */

import {
  Code2,
  FileCode2,
  LayoutTemplate,
  Loader2,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { serializeGui } from "@/lib/guiNode";
import { setPreference } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { ComponentList } from "./xgui/ComponentList";
import { ControllerTab } from "./xgui/ControllerTab";
import { DataModelPanel } from "./xgui/DataModelPanel";
import { DiskChangeNotice } from "./xgui/DiskChangeNotice";
import { applyModelEdit, initDataModelState } from "./xgui/dataModelState";
import {
  EditorStateProvider,
  type EditorTab,
  type OpenComponent,
  useEditorStore,
} from "./xgui/editorState";
import { GuiPreviewHost } from "./xgui/GuiPreviewHost";
import { GuiTreeStoreProvider, useGuiTreeStore } from "./xgui/guiTreeStore";
import { MainContentSkeleton, mainContentMode } from "./xgui/MainContentSkeleton";
import { PropertiesPanel } from "./xgui/PropertiesPanel";
import { StructureTree } from "./xgui/StructureTree";
import { useComponentSave } from "./xgui/useComponentSave";
import { useEditorKeyboard } from "./xgui/useEditorKeyboard";
import { XmlView } from "./xgui/XmlView";

export interface XguiProps {
  /**
   * Whether the component-list pane is collapsed. Owned by {@link App} (via the
   * preferences layer) and toggled by the XGUI rail icon, so it persists across
   * tool switches — mirroring the Workbench's object-list pattern.
   */
  componentListCollapsed?: boolean;
  /**
   * Whether the GUI Editor is the FOREGROUND tool. The page stays mounted across
   * tool switches, so its global keyboard commands (Cmd+S save, Cmd+Z undo) must
   * only fire when the editor is actually in front — see {@link useEditorKeyboard}.
   */
  active?: boolean;
}

/**
 * The XGUI page. Wraps everything in the shared {@link EditorStateProvider} so
 * the component list, structure column, and main content all act on one open
 * component, then lays out the three columns.
 */
export default function Xgui({ componentListCollapsed, active = false }: XguiProps) {
  return (
    <EditorStateProvider>
      <GuiTreeStoreProvider>
        <div className="flex h-full min-h-0">
          <ComponentList collapsed={componentListCollapsed} />

          {/* When the list is collapsed, leave a slim labelled rail in its place so
            it's obvious the panel exists and how to bring it back — matching the
            Workbench's collapsed-list affordance. */}
          {componentListCollapsed && (
            <CollapsedListRail onShow={() => setPreference("xgui.componentListCollapsed", false)} />
          )}

          {/* Structure column: the tree (F9a) over properties (F9b), stacked
            top-to-bottom. Events are ordinary <Event> tree nodes now — added,
            labeled, edited (in Properties), and removed through these two slices —
            so the dedicated events panel is gone. */}
          <StructureColumn />

          {/* MAIN content — the preview (+ Data Model) for the open component. */}
          <MainContent active={active} />
        </div>
      </GuiTreeStoreProvider>
    </EditorStateProvider>
  );
}

/**
 * The structure column — TWO slices: the TREE slice (top, {@link StructureTree})
 * and the PROPERTIES slice (bottom, {@link PropertiesPanel}) reflecting the current
 * selection. `<Event>` registrations are ordinary tree nodes (labeled by name,
 * added/removed via the tree, edited via Properties), so there is no longer a
 * dedicated events slice.
 *
 * Each slice scrolls independently within its own region so a deep tree and a long
 * property list don't fight for the column's height.
 */
function StructureColumn() {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-background/40">
      <div className="border-b px-3 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Structure
      </div>
      {/* TREE slice (F9a) — upper region, scrolls independently. */}
      <div className="flex min-h-0 flex-[1.2] flex-col">
        <StructureTree />
      </div>
      {/* PROPERTIES slice (F9b) — lower region, scrolls independently. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <PropertiesPanel />
      </div>
    </aside>
  );
}

/**
 * The main content region. Hosts the segmented View/Controller/XML tab toggle
 * (task 476) and, when a component is open, the {@link OpenComponentPanes} — the
 * swapping main pane plus the always-visible Data Model panel. Empty state shows
 * the {@link MainContentSkeleton}. The structure column is a sibling (see
 * {@link StructureColumn}) and stays visible across all three tabs by construction.
 */
function MainContent({ active }: { active: boolean }) {
  const { state, dispatch } = useEditorStore();
  const open = state.open;
  const activeTab = state.activeTab;
  const dirty = state.dirty;
  const { save, saving, error, clearError } = useComponentSave();

  // Cmd/Ctrl+S Save and Cmd/Ctrl+Z/Shift+Z/Ctrl+Y undo-redo, scoped to the
  // foreground editor (the page stays mounted across tool switches). Save reuses
  // the SAME `save()` the button calls; undo/redo drive the store's history.
  useEditorKeyboard({ active, onSave: () => void save() });
  // F13: the open component's file changed on disk while it had unsaved edits.
  // The notice lets the user reload (discarding their draft) or keep their work —
  // we never stomp it silently.
  const { live } = useGuiTreeStore();

  // Warn on app close / reload while the open component is dirty — nothing
  // auto-saves, so an intentional reload must confirm before discarding edits.
  // Registered only while dirty so a clean editor never blocks a reload. Mirrors
  // the Workbench's app-close guard.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* View / Controller / XML tab bar (F10 + task 476) — a SEGMENTED PILL toggle
          bound to `activeTab`, matching the creature editor's Script/Stats control
          (rounded container + icon+label segments, active segment filled). The
          structure column (a sibling, see StructureColumn) and the Data Model panel
          (inside OpenComponentPanes) stay visible across all three tabs; only the
          main pane swaps. */}
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border p-0.5">
          <TabButton
            tab="view"
            active={activeTab === "view"}
            onSelect={() => dispatch({ type: "setTab", tab: "view" })}
            Icon={LayoutTemplate}
            label="View"
          />
          <TabButton
            tab="controller"
            active={activeTab === "controller"}
            onSelect={() => dispatch({ type: "setTab", tab: "controller" })}
            Icon={FileCode2}
            label="Controller"
          />
          <TabButton
            tab="xml"
            active={activeTab === "xml"}
            onSelect={() => dispatch({ type: "setTab", tab: "xml" })}
            Icon={Code2}
            label="XML"
          />
        </div>
        {open && (
          <span
            className="ml-auto truncate font-mono text-muted-foreground text-xs"
            title={open.path}
          >
            {open.path}
          </span>
        )}
        {open && (
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="h-7 gap-1.5 px-2.5 text-xs"
            title={dirty ? "Save this component (XML + controller)" : "No unsaved changes"}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Save
            {dirty && !saving && (
              <span
                role="img"
                aria-label="Unsaved changes"
                className="size-1.5 rounded-full bg-primary-foreground"
              />
            )}
          </Button>
        )}
      </div>

      {/* F13: the open file changed on disk under unsaved edits. Non-destructive —
          default keeps the draft; Reload is the deliberate discard. Shown only when
          the notice still refers to the open component. */}
      {live.diskChangeNotice != null && live.diskChangeNotice === open?.name && (
        <DiskChangeNotice
          componentName={live.diskChangeNotice}
          onReload={live.reloadFromDisk}
          onKeep={live.keepLocalChanges}
        />
      )}

      {/* A failed save surfaces here and KEEPS the component dirty (design risk
          #5) so the user knows the save didn't land and can retry. */}
      {error && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-destructive/10 px-3 py-1.5 text-destructive text-xs">
          <span className="min-w-0 truncate">Save failed: {error}</span>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-destructive/20"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {mainContentMode(open) === "preview" && open ? (
          // Keyed by path so opening a DIFFERENT component remounts the panes (and
          // resets the lifted Data Model state) cleanly. Within one component, the
          // panes stay mounted across tab flips.
          <OpenComponentPanes key={open.path} open={open} activeTab={activeTab} />
        ) : (
          // Empty / first-run (F12): no component open — and an empty `gui/` folder
          // reaches here the same way (nothing to pick → nothing open). Show the
          // skeleton layout so a first-run user sees structure, not a blank panel.
          <MainContentSkeleton />
        )}
      </div>
    </div>
  );
}

/**
 * The panes shown for an OPEN component (task 476): the swapping main pane on the
 * left (View preview / Controller Lua / XML view) and the ALWAYS-VISIBLE,
 * collapsible Data Model panel on the right. Keyed by component path at the call
 * site, so this owns the lifted Data Model state for one component's lifetime.
 *
 * WHY the model lives here: the Data Model JSON drives BOTH the preview's
 * `{token}` resolution AND its own panel. Hoisting it out of GuiPreviewHost (where
 * it used to live) lets the panel stay mounted alongside the Controller and XML
 * tabs — where the model is still worth reading/editing — instead of vanishing
 * whenever the View tab isn't active. The LAST-GOOD parsed model is kept live so
 * an invalid keystroke surfaces an error without blanking the preview.
 *
 * All three tab panes stay MOUNTED and toggle visibility (like the Workbench's
 * tabs) so Monaco's editor state and the preview's selection/view survive flipping
 * tabs; only their visibility changes.
 */
function OpenComponentPanes({ open, activeTab }: { open: OpenComponent; activeTab: EditorTab }) {
  // The Data Model state — raw text (panel) + LAST GOOD parsed model (preview) —
  // lifted here so ONE source feeds both. Seeded from the open component's stored
  // model text; an edit advances the model only when the JSON parses (see
  // `applyModelEdit`), so an invalid keystroke keeps the preview on the last valid
  // state. The advance rule lives in the pure `dataModelState` module so it is
  // unit-tested off the React tree.
  const [dataModel, setDataModel] = useState(() => initDataModelState(open.modelText));
  // Whether the Data Model panel is collapsed (task 476 keeps it collapsible).
  const [modelPanelOpen, setModelPanelOpen] = useState(true);

  // The LIVE serialized XML of the current tree. Re-derived whenever the visual
  // editor mutates `open.root` (every immutable edit replaces the reference), so
  // the read-only XML tab always mirrors the document. Memoized so a tab flip or a
  // Data-Model keystroke doesn't re-serialize needlessly.
  const xml = useMemo(() => serializeGui(open.root), [open.root]);

  return (
    <div className="flex h-full min-h-0">
      {/* MAIN pane — only this swaps per tab. Each pane stays mounted; visibility
          toggles so Monaco/preview state survives tab flips. */}
      <div className="relative min-h-0 min-w-0 flex-1">
        <div className={cn("absolute inset-0", activeTab !== "view" && "hidden")}>
          <GuiPreviewHost root={open.root} model={dataModel.model} />
        </div>
        <div className={cn("absolute inset-0", activeTab !== "controller" && "hidden")}>
          <ControllerTab />
        </div>
        <div className={cn("absolute inset-0", activeTab !== "xml" && "hidden")}>
          <XmlView value={xml} />
        </div>
      </div>

      {/* ALWAYS-VISIBLE Data Model panel (task 476) — persistent across View,
          Controller, and XML; collapsible to a slim toggle rail. */}
      {modelPanelOpen ? (
        <div className="flex w-80 shrink-0 flex-col border-border border-l">
          <div className="flex shrink-0 items-center justify-end border-b px-1.5 py-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Collapse Data Model panel"
              aria-pressed
              onClick={() => setModelPanelOpen(false)}
            >
              <PanelLeftClose className="rotate-180" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <DataModelPanel
              value={dataModel.text}
              onChange={(text) => setDataModel((prev) => applyModelEdit(prev, text))}
            />
          </div>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Show Data Model panel"
              onClick={() => setModelPanelOpen(true)}
              className="flex h-full w-9 shrink-0 flex-col items-center gap-2 border-l bg-background/40 py-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftOpen className="size-4 shrink-0 rotate-180" />
              <span className="text-xs uppercase tracking-wide [writing-mode:vertical-rl]">
                Data Model
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Show Data Model panel</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** One segment of the View/Controller/XML segmented toggle (icon + label). */
function TabButton({
  tab,
  active,
  onSelect,
  Icon,
  label,
}: {
  tab: EditorTab;
  active: boolean;
  onSelect: () => void;
  Icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-tab={tab}
      onClick={onSelect}
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

/**
 * The slim placeholder shown where the component list was, while it's collapsed.
 * Mirrors the Workbench's CollapsedListRail.
 */
function CollapsedListRail({ onShow }: { onShow: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Show component list"
          onClick={onShow}
          className="flex h-full w-9 shrink-0 flex-col items-center gap-2 border-r bg-sidebar py-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4 shrink-0" />
          <span className="text-xs uppercase tracking-wide [writing-mode:vertical-rl]">
            Components
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Show component list</TooltipContent>
    </Tooltip>
  );
}
