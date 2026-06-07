import type * as Monaco from "monaco-editor";
import { LUA_LANGUAGE_ID } from "./lua";

/** Monaco's two built-in themes we map the app's light/dark mode onto. */
export type MonacoTheme = "vs" | "vs-dark";

/** Map the app's dark-mode flag to the matching built-in Monaco theme. */
export function resolveMonacoTheme(isDark: boolean): MonacoTheme {
  return isDark ? "vs-dark" : "vs";
}

/** Read the app's current mode off the `dark` class the theme hook toggles. */
export function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/**
 * Construction options for the script editor. Pure so the choices (read-only,
 * Lua language, layout) are assertable without standing up a real editor.
 */
export function scriptEditorOptions(
  readOnly: boolean,
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    language: LUA_LANGUAGE_ID,
    readOnly,
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 13,
    lineNumbers: "on",
    roundedSelection: false,
    scrollBeyondLastLine: false,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: "on",
    folding: true,
    foldingStrategy: "indentation",
    smoothScrolling: true,
    renderWhitespace: "selection",
    fixedOverflowWidgets: true,
  };
}
