import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { NavRail, type NavRailTool } from "./components/NavRail";
import { TooltipProvider } from "./components/ui/tooltip";
import { cn } from "./lib/utils";
import CreatureEditor from "./pages/CreatureEditor";
import DataTables from "./pages/DataTables";
import Workbench from "./pages/Workbench";

function App() {
  const [activeTool, setActiveTool] = useState<NavRailTool>("workbench");

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

  // The Workbench stays MOUNTED across tool switches (see below), so leaving it
  // with unsaved drafts no longer discards anything — no leave-the-tool guard is
  // needed. The app-close/reload warning still lives inside the Workbench.
  const handleSelectTool = useCallback((tool: NavRailTool) => {
    setActiveTool(tool);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden">
        <NavRail active={activeTool} onSelect={handleSelectTool} />
        <main
          className={cn(
            "flex h-screen min-w-0 flex-1 flex-col overflow-hidden overscroll-none",
            // The Workbench is full-bleed; the form-first tools keep their padding.
            activeTool !== "workbench" && "p-4",
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
            <Workbench />
          </div>
          {activeTool === "creature-editor" && <CreatureEditor />}
          {activeTool === "data-tables" && <DataTables />}
        </main>
      </div>
    </TooltipProvider>
  );
}

export default App;
