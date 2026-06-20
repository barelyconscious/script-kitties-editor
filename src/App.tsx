import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { NAV_RAIL_TOOLS, NavRail, type NavRailTool } from "./components/NavRail";
import { TooltipProvider } from "./components/ui/tooltip";
import { usePreference } from "./lib/preferences";
import { RegistryProvider } from "./lib/registry";
import { cn } from "./lib/utils";
import DataTables from "./pages/DataTables";
import Registry from "./pages/Registry";
import Workbench from "./pages/Workbench";
import Xgui from "./pages/Xgui";

function App() {
  const [activeTool, setActiveTool] = useState<NavRailTool>("workbench");

  // Whether the Workbench's object-list pane is collapsed. Held in the central
  // preferences layer so it survives tool switches now and can move to
  // localStorage later without touching this component.
  const [objectListCollapsed, setObjectListCollapsed] = usePreference(
    "workbench.objectListCollapsed",
  );

  // Same pattern for the XGUI editor's component-list pane: its collapse state
  // lives in the preferences layer so it survives tool switches, and the XGUI
  // rail icon toggles it when already on the GUI Editor tool.
  const [componentListCollapsed, setComponentListCollapsed] = usePreference(
    "xgui.componentListCollapsed",
  );

  // Safety net for Ctrl+W on Windows/Linux webviews (WebView2 / WebKitGTK),
  // where the close shortcut can be delivered to the page rather than a native
  // menu. On macOS the custom Rust menu already drops Cmd+W; this is harmless
  // there. Capture phase + stopPropagation so nothing downstream re-triggers a
  // close. Only swallows the W-with-modifier combo — every other shortcut
  // (copy/paste/undo/reload/quit) passes through untouched.
  useEffect(() => {
    const swallowCloseWindow = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", swallowCloseWindow, { capture: true });
    return () => window.removeEventListener("keydown", swallowCloseWindow, { capture: true });
  }, []);

  // Cmd/Ctrl+1..4 jump straight to the Nth NavRail tool (1 = the topmost rail
  // button). This is pure NAVIGATION — it sets the active tool directly rather
  // than routing through `handleSelectTool`, so hitting the shortcut for the tool
  // you're already on is a no-op, not a list-pane toggle. The digit→tool mapping
  // comes from the shared `NAV_RAIL_TOOLS` order, so it can never drift from the
  // rail. We read the physical digit key (`code`) so it survives non-US layouts,
  // and ignore the combo when Shift/Alt are also held (those are other commands).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (!/^Digit[1-9]$/.test(e.code)) return;
      const tool = NAV_RAIL_TOOLS[Number(e.code.slice(5)) - 1];
      if (!tool) return;
      e.preventDefault();
      setActiveTool(tool);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  // The Workbench stays MOUNTED across tool switches (see below), so leaving it
  // with unsaved drafts no longer discards anything — no leave-the-tool guard is
  // needed. The app-close/reload warning still lives inside the Workbench.
  //
  // Clicking the Workbench rail icon while ALREADY in the Workbench toggles its
  // object-list pane instead of re-navigating; from any other tool it just
  // switches in (leaving the pane in whatever state it was last left).
  const handleSelectTool = useCallback(
    (tool: NavRailTool) => {
      if (tool === "workbench" && activeTool === "workbench") {
        setObjectListCollapsed((v) => !v);
        return;
      }
      if (tool === "xgui" && activeTool === "xgui") {
        setComponentListCollapsed((v) => !v);
        return;
      }
      setActiveTool(tool);
    },
    [activeTool, setObjectListCollapsed, setComponentListCollapsed],
  );

  return (
    <TooltipProvider>
      <RegistryProvider>
        <div className="flex h-screen overflow-hidden">
          <NavRail active={activeTool} onSelect={handleSelectTool} />
          <main
            className={cn(
              "flex h-screen min-w-0 flex-1 flex-col overflow-hidden overscroll-none",
              // The Workbench and GUI Editor are full-bleed; the form-first tools
              // keep their padding.
              activeTool !== "workbench" && activeTool !== "xgui" && "p-4",
            )}
          >
            {/* The Workbench stays mounted (hidden when inactive) so its open tabs
              and any unsaved drafts survive leaving and returning — every tab is
              already kept mounted-but-hidden inside it, so this just extends the
              same trick one level up. The form-first tools are cheap to rebuild
              from disk, so they mount on demand. */}
            <div
              className={cn("flex min-h-0 flex-1 flex-col", activeTool !== "workbench" && "hidden")}
            >
              <Workbench objectListCollapsed={objectListCollapsed} />
            </div>
            {/* The GUI Editor likewise stays mounted so an open component and its
              unsaved edits survive leaving and returning. */}
            <div className={cn("flex min-h-0 flex-1 flex-col", activeTool !== "xgui" && "hidden")}>
              <Xgui
                componentListCollapsed={componentListCollapsed}
                active={activeTool === "xgui"}
              />
            </div>
            {activeTool === "data-tables" && <DataTables />}
            {activeTool === "registry" && <Registry />}
          </main>
        </div>
      </RegistryProvider>
    </TooltipProvider>
  );
}

export default App;
