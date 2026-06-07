import { useCallback, useState } from "react";
import "./App.css";
import { NavRail, type NavRailTool } from "./components/NavRail";
import { TooltipProvider } from "./components/ui/tooltip";
import { cn } from "./lib/utils";
import CreatureEditor from "./pages/CreatureEditor";
import DataTables from "./pages/DataTables";
import Workbench from "./pages/Workbench";

function App() {
  const [activeTool, setActiveTool] = useState<NavRailTool>("workbench");
  // Workbench reports aggregate dirtiness up because it UNMOUNTS on a tool
  // switch — so the leave-the-tool guard has to live here, above it.
  const [workbenchDirty, setWorkbenchDirty] = useState(false);

  const handleSelectTool = useCallback(
    (tool: NavRailTool) => {
      if (
        activeTool === "workbench" &&
        tool !== "workbench" &&
        workbenchDirty &&
        !window.confirm("You have unsaved changes in the Workbench. Leave anyway?")
      ) {
        return;
      }
      setActiveTool(tool);
    },
    [activeTool, workbenchDirty],
  );

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
          {activeTool === "workbench" && <Workbench onDirtyChange={setWorkbenchDirty} />}
          {activeTool === "creature-editor" && <CreatureEditor />}
          {activeTool === "data-tables" && <DataTables />}
        </main>
      </div>
    </TooltipProvider>
  );
}

export default App;
