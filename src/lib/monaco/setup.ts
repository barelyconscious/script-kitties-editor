import * as monaco from "monaco-editor";
// Self-hosted editor worker. Vite's `?worker` import emits the worker as a
// bundled chunk, so it loads from the app origin (tauri://) — never a CDN.
// We only use Lua, which is Monarch-based and runs on the main thread, so the
// base editor worker is the only one Monaco needs.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
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
