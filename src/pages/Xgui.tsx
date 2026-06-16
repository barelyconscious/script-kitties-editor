/**
 * Xgui — the XGUI GUI-editor page shell (F8). Composes the three working columns
 * the design lays out (component list → structure column → main content) and
 * provides the shared open-component store every region reads/writes.
 *
 * This first runnable slice wires:
 *  • LEFT — the {@link ComponentList} (folder tree + create flow + open flow).
 *  • CENTER-LEFT — a clearly-marked SEAM for the structure column (F9a tree /
 *    F9b properties / F9c events). Empty placeholder for now.
 *  • MAIN — when a component is open, the existing F3 {@link GuiPreviewHost}
 *    (preview + Data Model panel) renders it, fed from the shared store. A
 *    clearly-marked SEAM marks where the View/Controller tab bar (F10) lands.
 *
 * The page stays MOUNTED across tool switches (like the Workbench) so an open
 * component and its unsaved edits survive leaving and returning — see {@link App}.
 *
 * @see design/xgui_ta.md — "High Level Visual Layout" (the three columns).
 */

import { PanelLeftOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setPreference } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { ComponentList } from "./xgui/ComponentList";
import { EditorStateProvider, useEditorStore } from "./xgui/editorState";
import { GuiPreviewHost } from "./xgui/GuiPreviewHost";
import { PropertiesPanel } from "./xgui/PropertiesPanel";
import { StructureTree } from "./xgui/StructureTree";

export interface XguiProps {
  /**
   * Whether the component-list pane is collapsed. Owned by {@link App} (via the
   * preferences layer) and toggled by the XGUI rail icon, so it persists across
   * tool switches — mirroring the Workbench's object-list pattern.
   */
  componentListCollapsed?: boolean;
}

/**
 * The XGUI page. Wraps everything in the shared {@link EditorStateProvider} so
 * the component list, structure column, and main content all act on one open
 * component, then lays out the three columns.
 */
export default function Xgui({ componentListCollapsed }: XguiProps) {
  return (
    <EditorStateProvider>
      <div className="flex h-full min-h-0">
        <ComponentList collapsed={componentListCollapsed} />

        {/* When the list is collapsed, leave a slim labelled rail in its place so
            it's obvious the panel exists and how to bring it back — matching the
            Workbench's collapsed-list affordance. */}
        {componentListCollapsed && (
          <CollapsedListRail onShow={() => setPreference("xgui.componentListCollapsed", false)} />
        )}

        {/* Structure column. F9a fills the TREE slice (top); F9b properties and
            F9c events stack below it in the same column (still seams for now). */}
        <StructureColumn />

        {/* MAIN content — the preview (+ Data Model) for the open component. */}
        <MainContent />
      </div>
    </EditorStateProvider>
  );
}

/**
 * The structure column (tree + properties + events). F9a fills the TREE slice
 * (top) with the live {@link StructureTree}; F9b fills the PROPERTIES slice
 * (middle) with the live {@link PropertiesPanel} reflecting the current
 * selection; the Events (F9c) slice remains a seam below it, so the three-slice
 * column reads correctly now and the last slice slots in without reshaping it.
 *
 * The tree gets the upper half (its own scroll), the properties panel the lower
 * half (its own scroll), so a deep tree and a long property list each scroll
 * independently rather than fighting for the column's height.
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
      {/* SEAM: Events (F9c) stacks below the properties panel. */}
      <div className="border-t px-3 py-1.5 text-center text-[10px] text-muted-foreground/50">
        Events land here (F9c).
      </div>
    </aside>
  );
}

/**
 * The main content region. Shows the open component's preview (via the F3
 * {@link GuiPreviewHost}) or an empty state. The View/Controller tab bar (F10)
 * mounts at the marked seam.
 */
function MainContent() {
  const { state } = useEditorStore();
  const open = state.open;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* SEAM: View / Controller tab bar (F10). A static "View" label stands in
          until F10 makes it a real toggle bound to `state.activeTab`. */}
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        <span className={cn("rounded px-2 py-1 text-xs", "bg-muted font-medium text-foreground")}>
          View
        </span>
        <span className="rounded px-2 py-1 text-muted-foreground/50 text-xs" title="Coming in F10">
          Controller
        </span>
        {open && (
          <span
            className="ml-auto truncate font-mono text-muted-foreground text-xs"
            title={open.path}
          >
            {open.path}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {open ? (
          // Remount the host per open component (keyed by path) so its internal
          // Data Model + selection state resets cleanly when a different component
          // is opened. F3's host owns that local state today; F9/F10 will lift
          // selection into the shared store and this key can be reconsidered.
          <GuiPreviewHost key={open.path} root={open.root} initialModelText={open.modelText} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Select a component to open it.
          </div>
        )}
      </div>
    </div>
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
