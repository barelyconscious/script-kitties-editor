import * as monaco from "monaco-editor";
// Self-hosted editor worker. Vite's `?worker` import emits the worker as a
// bundled chunk, so it loads from the app origin (tauri://) — never a CDN.
// We only use Lua + XML, both Monarch-based and running on the main thread, so
// the base editor worker is the only one Monaco needs.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
// XML syntax highlighting for the read-only XML view (task 476). The basic-
// languages contribution registers the `xml` language as a side effect, the
// same way `registerLua` does for Lua — imported explicitly so it stays in the
// offline bundle rather than being tree-shaken out.
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import { registerLua } from "./lua";

let initialized = false;

/**
 * One-time Monaco initialization for the whole app. Wires self-hosted workers
 * (no CDN — required for an offline Tauri build) and registers the Lua language
 * once. Call from the app entry point (`main.tsx`) before any editor mounts;
 * subsequent calls are no-ops.
 */
export function setupMonaco(): void {
  if (initialized) return;

  self.MonacoEnvironment = {
    getWorker() {
      return new EditorWorker();
    },
  };

  registerLua(monaco);

  initialized = true;
}
