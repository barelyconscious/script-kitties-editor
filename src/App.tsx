import { useState } from "react";
import "./App.css";
import { NavRail, type NavRailTool } from "./components/NavRail";
import { TooltipProvider } from "./components/ui/tooltip";
import CreatureEditor from "./pages/CreatureEditor";
import DataTables from "./pages/DataTables";
import Workbench from "./pages/Workbench";

function App() {
  const [activeTool, setActiveTool] = useState<NavRailTool>("workbench");

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden">
        <NavRail active={activeTool} onSelect={setActiveTool} />
        <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden overscroll-none p-4">
          {activeTool === "workbench" && <Workbench />}
          {activeTool === "creature-editor" && <CreatureEditor />}
          {activeTool === "data-tables" && <DataTables />}
        </main>
      </div>
    </TooltipProvider>
  );
}

export default App;
