/**
 * Xgui — the XGUI GUI-editor page shell (F8). Composes the three working columns
 * the design lays out (component list → structure column → main content) and
 * provides the shared open-component store every region reads/writes.
 *
 * This first runnable slice wires:
 *  • LEFT — the {@link ComponentList} (folder tree + create flow + open flow).
 *  • CENTER-LEFT — the structure column: the F9a tree over the F9b properties
 *    panel. Event handling lives entirely in the Lua controller, so there is no
 *    events slice and no `<Event>` element in the tree.
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
  PanelLeftOpen,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CollapseRail } from "@/components/CollapseRail";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { serializeGui } from "@/lib/guiNode";
import { setPreference, usePreference } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { ComponentList } from "./xgui/ComponentList";
import { useComponentRegistry } from "./xgui/componentRegistry";
import { ControllerTab } from "./xgui/ControllerTab";
import { DataModelPanel } from "./xgui/DataModelPanel";
import { DiskChangeNotice } from "./xgui/DiskChangeNotice";
import { applyModelEdit, seedDataModel } from "./xgui/dataModelState";
import { getPersistedModel, setPersistedModel } from "./xgui/dataModelStore";
import { lockedKeysFor, setPersistedLocks } from "./xgui/elementLockStore";
import {
  EditorStateProvider,
  type EditorTab,
  type OpenComponent,
  useEditorStore,
} from "./xgui/editorState";
import { GuiPreviewHost } from "./xgui/GuiPreviewHost";
import { cascadeModelWrites } from "./xgui/guiModelCascade";
import { type ComponentResolver, scaffoldModelText } from "./xgui/guiModelScaffold";
import { GuiTreeStoreProvider, useGuiTreeStore } from "./xgui/guiTreeStore";
import { MainContentSkeleton, mainContentMode } from "./xgui/MainContentSkeleton";
import { PropertiesPanel } from "./xgui/PropertiesPanel";
import { StructureTree } from "./xgui/StructureTree";
import { clampTreeFraction, fractionForPointer } from "./xgui/structureSplit";
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
        <LockPersistence />
        <div className="flex h-full min-h-0">
          <ComponentList
            collapsed={componentListCollapsed}
            onCollapse={() => setPreference("xgui.componentListCollapsed", true)}
          />

          {/* When the list is collapsed, leave a slim labelled rail in its place so
            it's obvious the panel exists and how to bring it back — matching the
            Workbench's collapsed-list affordance. */}
          {componentListCollapsed && (
            <CollapsedListRail onShow={() => setPreference("xgui.componentListCollapsed", false)} />
          )}

          {/* Structure column: the tree (F9a) over properties (F9b), stacked
            top-to-bottom. Events are handled entirely in the Lua controller, so the
            editor authors no `<Event>` elements and there is no events panel. */}
          <StructureColumn />

          {/* MAIN content — the preview (+ Data Model) for the open component. */}
          <MainContent active={active} />
        </div>
      </GuiTreeStoreProvider>
    </EditorStateProvider>
  );
}

/**
 * Persists the open component's locked elements to localStorage whenever the lock
 * set OR the tree changes (element-lock persistence). Locks are stored as STABLE
 * structural keys (see {@link import("./xgui/elementLockStore")}), so re-deriving them
 * from the current tree on every edit keeps the persisted paths fresh as structure
 * shifts. Seeding back on open/reload happens at those call sites; this only writes.
 * Renders nothing — it is a side-effect bridge mounted inside the store provider.
 */
function LockPersistence() {
  const { state } = useEditorStore();
  const path = state.open?.path;
  const root = state.open?.root;
  const locked = state.lockedNodeIds;
  useEffect(() => {
    if (!path || !root) return;
    setPersistedLocks(path, lockedKeysFor(root, locked));
  }, [path, root, locked]);
  return null;
}

/**
 * The structure column — TWO slices: the TREE slice (top, {@link StructureTree})
 * and the PROPERTIES slice (bottom, {@link PropertiesPanel}) reflecting the current
 * selection. Event handling lives entirely in the Lua controller, so the editor
 * authors no `<Event>` elements and there is no dedicated events slice.
 *
 * Each slice scrolls independently within its own region so a deep tree and a long
 * property list don't fight for the column's height.
 */
function StructureColumn() {
  // The measured height of the stacked tree+properties region (excludes the
  // header), needed to convert the persisted fraction and a drag's pointer-Y into
  // pixel heights. Measured via a ResizeObserver so it tracks window resizes.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [regionHeight, setRegionHeight] = useState(0);
  const [treeFraction, setTreeFraction] = usePreference("xgui.structureTreeFraction");
  const dragging = useRef(false);

  useEffect(() => {
    const el = splitRef.current;
    if (!el) return;
    const measure = () => setRegionHeight(el.clientHeight);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // The tree slice's height in px, clamped so both slices keep their minimums for
  // the CURRENT region height (so a stored fraction from a taller window still
  // honors the minimums after a shrink). The properties slice takes the rest.
  const clampedFraction = clampTreeFraction(treeFraction, regionHeight);
  const treeHeightPx = regionHeight > 0 ? clampedFraction * regionHeight : undefined;

  // Divider drag: while the handle is held, each pointer move maps the cursor's
  // offset from the top of the region into a clamped tree fraction and persists it
  // (so the split survives tool switches via the preferences layer). Pointer
  // capture keeps moves flowing even when the cursor leaves the thin handle.
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const el = splitRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    setTreeFraction(fractionForPointer(e.clientY - top, el.clientHeight));
  };
  const endDividerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-background/40">
      <div className="border-b px-3 py-3.25 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Structure
      </div>
      {/* The stacked tree + properties region, split by a draggable divider (478).
        The TREE slice gets the persisted (clamped) fraction; PROPERTIES takes the
        rest. Each scrolls independently within its own region. */}
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        {/* TREE slice (F9a) — upper region, scrolls independently. */}
        <div
          className="flex min-h-0 flex-col"
          style={treeHeightPx !== undefined ? { height: `${treeHeightPx}px` } : { flex: "1.2" }}
        >
          <StructureTree />
        </div>
        {/* Draggable horizontal divider — grab cursor, a hairline that thickens on
          hover so it's findable. Resizes the slices above/below it. */}
        <div
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={endDividerDrag}
          onPointerCancel={endDividerDrag}
          className="group relative h-px shrink-0 cursor-row-resize bg-border"
          aria-hidden="true"
        >
          {/* A taller invisible hit area so the 1px line is easy to grab. */}
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 group-hover:bg-primary/20" />
        </div>
        {/* PROPERTIES slice (F9b) — lower region, scrolls independently, takes the
          remaining height. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <PropertiesPanel />
        </div>
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

  // A snapshot of every component's parsed tree: the `resolveComponent` resolver
  // feeds the open component's `<Component data>` auto-scaffold, and `components`
  // drives the save-time cascade below.
  const { resolve: resolveComponent, components } = useComponentRegistry();

  // CASCADE: the registry reloads on every `gui-changed` (a save or an external
  // edit), so when `components` refreshes, re-reconcile every CLOSED component's
  // persisted data model against the fresh shapes — prune-syncing each `data=`
  // object to its child. The OPEN component is skipped (its model is live in the
  // panel and persisted from there); a component the scaffold leaves unchanged
  // produces no write. This is how a child's shape change reaches parents that
  // aren't open, including never-opened ones (seeded from an empty baseline).
  useEffect(() => {
    if (components.length === 0) return;
    for (const w of cascadeModelWrites(components, resolveComponent, getPersistedModel, open?.path)) {
      setPersistedModel(w.path, w.text);
    }
  }, [components, resolveComponent, open?.path]);

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
          <OpenComponentPanes
            key={open.path}
            open={open}
            activeTab={activeTab}
            resolveComponent={resolveComponent}
          />
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
function OpenComponentPanes({
  open,
  activeTab,
  resolveComponent,
}: {
  open: OpenComponent;
  activeTab: EditorTab;
  /** Resolves a nested `<Component src>` to its tree, for `data=` auto-scaffold. */
  resolveComponent: ComponentResolver;
}) {
  // The Data Model state — raw text (panel) + LAST GOOD parsed model (preview) —
  // lifted here so ONE source feeds both. An edit advances the model only when the
  // JSON parses (see `applyModelEdit`), so an invalid keystroke keeps the preview on
  // the last valid state. The advance rule lives in the pure `dataModelState` module
  // so it is unit-tested off the React tree.
  //
  // SEED (task 484): the model is PERSISTED per component path in localStorage, so a
  // previously-edited model is RESTORED as the base; only when nothing is stored do
  // we fall back to the component's own `modelText`. This is editor-local state — it
  // is never written to game data.
  //
  // AUTO-SCAFFOLD (task 482): on open we then PRE-FILL the model from the component's
  // `{token}` references — `scaffoldModelText` extracts the (scope-aware) tokens from
  // the tree and additively merges placeholders into the seed text. Running the
  // scaffold ON TOP of a restored model means tokens added while this component was
  // away still appear, without disturbing the user's restored edits. An empty seed
  // is filled wholesale; an existing model is preserved and only grown. We seed the
  // state with the scaffolded text so the very first render already resolves bindings.
  const [dataModel, setDataModel] = useState(() =>
    seedDataModel(getPersistedModel(open.path), open.modelText, open.root, resolveComponent, open.name),
  );

  // Persist the model text per component path on EVERY change — user keystrokes in
  // the panel AND additive scaffold merges both flow through `dataModel.text`, so a
  // single effect captures both. localStorage writes are cheap; no debounce needed.
  // Keyed by `open.path` so switching back restores exactly this component's model.
  useEffect(() => {
    setPersistedModel(open.path, dataModel.text);
  }, [open.path, dataModel.text]);

  // As the visual editor adds tokens (every immutable tree edit replaces
  // `open.root`), additively merge any NEW tokens into the model. `scaffoldModelText`
  // returns a rewritten text ONLY when there is genuinely something new to add — so
  // a tree edit that introduces no token (or a Data-Model keystroke, which doesn't
  // change `open.root`) leaves the user's exact JSON untouched, avoiding reformat
  // churn while they type. The merged model flows through `applyModelEdit`, so it
  // still rides the last-good-model path that drives the preview.
  // Also re-runs when `resolveComponent` changes: the component registry loads
  // asynchronously, so a `<Component data>` object that was present-but-empty at
  // seed time fills in once the child's tree is available. `scaffoldModelText`
  // returns `null` when there is nothing new to add (or prune), so a re-run with an
  // unchanged shape is a no-op and never churns the user's JSON.
  useEffect(() => {
    setDataModel((prev) => {
      const scaffolded = scaffoldModelText(prev.text, open.root, resolveComponent, open.name);
      return scaffolded === null ? prev : applyModelEdit(prev, scaffolded);
    });
  }, [open.root, open.name, resolveComponent]);
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
        <div className="relative flex w-80 shrink-0 flex-col border-black border-l-2">
          <CollapseRail
            side="left"
            onClick={() => setModelPanelOpen(false)}
            label="Collapse Data Model panel"
          />
          <div className="flex shrink-0 items-center border-b px-3 py-2">
            <h2 className="font-medium text-sm">Data Model</h2>
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
              className="flex h-full w-9 shrink-0 flex-col items-center border-black border-l-2 bg-background/40 py-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftOpen className="size-4 shrink-0 rotate-180" />
              <span className="flex min-h-0 flex-1 items-center">
                <span className="text-xs uppercase tracking-wide [writing-mode:vertical-rl]">
                  Data Model
                </span>
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
          className="flex h-full w-9 shrink-0 flex-col items-center border-r bg-sidebar py-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4 shrink-0" />
          <span className="flex min-h-0 flex-1 items-center">
            <span className="text-xs uppercase tracking-wide [writing-mode:vertical-rl]">
              Components
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Show component list</TooltipContent>
    </Tooltip>
  );
}
