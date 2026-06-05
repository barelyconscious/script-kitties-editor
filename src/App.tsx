import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import "./App.css";
import { NavRail, type NavRailTool } from "./components/NavRail";
import { TooltipProvider } from "./components/ui/tooltip";
import CreatureEditor from "./pages/CreatureEditor";
import DataTables from "./pages/DataTables";
import Workbench from "./pages/Workbench";

function App() {
  const [_greetMsg, setGreetMsg] = useState("");
  const [name, _setName] = useState("");
  const [_abilities, _setAbilities] = useState([]);
  const [activeTool, setActiveTool] = useState<NavRailTool>("workbench");

  async function _greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  async function _loadAbilities() {
    _setAbilities(await invoke("get_abilities_api"));
  }

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
