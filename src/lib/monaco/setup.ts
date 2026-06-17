import * as monaco from "monaco-editor";
// Self-hosted editor worker. Vite's `?worker` import emits the worker as a
// bundled chunk, so it loads from the app origin (tauri://) — never a CDN.
// Lua + XML are Monarch-based and run on the main thread, so they need only the
// base editor worker; JSON (task 479) is the exception — its contribution runs
// tokenization + validation in a dedicated json worker, imported below.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
// JSON syntax highlighting + validation for the Data Model panel (task 479). The
// language contribution registers the `json` language and drives its own worker
// (squiggles for invalid JSON come free). Imported explicitly so it stays in the
// offline bundle rather than being tree-shaken out.
import "monaco-editor/esm/vs/language/json/monaco.contribution";
// The JSON language worker, emitted as a bundled chunk by Vite's `?worker` so it
// loads from the app origin (tauri://) — never a CDN, matching the editor worker.
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
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
    // The JSON language drives its own worker (label `json`); everything else
    // (Lua, XML, the editor core) runs on the base editor worker. Keyed by the
    // label Monaco passes so the json worker only spins up for JSON models.
    getWorker(_workerId: string, label: string) {
      if (label === "json") return new JsonWorker();
      return new EditorWorker();
    },
  };

  registerLua(monaco);

  initialized = true;
}
