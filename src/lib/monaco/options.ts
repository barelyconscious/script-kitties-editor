import type * as Monaco from "monaco-editor";
import { LUA_LANGUAGE_ID } from "./lua";

/** Monaco's built-in XML language id (registered via the basic-languages contribution). */
export const XML_LANGUAGE_ID = "xml";

/** Monaco's built-in JSON language id (registered via the json language contribution). */
export const JSON_LANGUAGE_ID = "json";

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

/**
 * Construction options for the editable Data Model JSON editor (task 479). Mirrors
 * the script editor's layout choices but pins the JSON language so the panel gets
 * syntax highlighting and Monaco's JSON validation (invalid-JSON squiggles). It
 * stays EDITABLE — the panel keeps the last-good parsed model driving the preview,
 * so this is a normal read/write surface. The minimap is off: the model JSON is
 * short and the panel is narrow, so the minimap would only steal width. Pure so the
 * choices are assertable without a real editor.
 */
export function dataModelEditorOptions(): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    language: JSON_LANGUAGE_ID,
    readOnly: false,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: "on",
    roundedSelection: false,
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "on",
    folding: true,
    foldingStrategy: "indentation",
    smoothScrolling: true,
    renderWhitespace: "selection",
    fixedOverflowWidgets: true,
  };
}

/**
 * Construction options for the read-only XML viewer (task 476). Mirrors the
 * script editor's layout choices but pins the XML language and always-on
 * read-only — this surface is a LIVE serialized view of the component, never an
 * edit target. Pure so the choices are assertable without a real editor.
 */
export function xmlViewerOptions(): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    language: XML_LANGUAGE_ID,
    readOnly: true,
    // A read-only viewer hides the blinking caret/overlays that imply editing.
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 13,
    lineNumbers: "on",
    roundedSelection: false,
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "on",
    folding: true,
    foldingStrategy: "indentation",
    smoothScrolling: true,
    renderWhitespace: "selection",
    fixedOverflowWidgets: true,
  };
}
