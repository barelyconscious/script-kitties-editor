import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAutohideScrollbars } from "./lib/autohide-scrollbars";
import { setupMonaco } from "./lib/monaco/setup";

// Register Monaco's self-hosted workers and the Lua language exactly once,
// before any editor mounts.
setupMonaco();

// Hide scrollbars until the user scrolls (macOS-style), on every platform.
initAutohideScrollbars();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
