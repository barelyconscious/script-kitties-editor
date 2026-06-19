/**
 * DataModelPanel — the XGUI editor's right-side Data Model panel (F3 wiring).
 *
 * The user types raw JSON; it parses into the flat root model the preview's
 * `{token}` bindings resolve against. Editing the JSON updates the preview (the
 * parent lifts the parsed model into the preview's `model` prop). Invalid JSON is
 * surfaced inline without tearing down the last good model — the preview keeps
 * showing the most recent valid state rather than blanking on a stray keystroke.
 *
 * The editor is a Monaco instance pinned to the `json` language (task 479), so the
 * JSON gets syntax highlighting and Monaco's own invalid-JSON squiggles on top of
 * the inline parse-error line. It stays editable and controlled: `value` +
 * `onChange` make it a standard controlled input the parent owns, mirroring the
 * Controller (Lua) and XML tabs' Monaco wiring. It supplies the single flat model
 * JSON; binding resolution is applied downstream in the resolver.
 *
 * @see design/xgui_ta.md — "Data Model panel (right of main content, collapsible)"
 */

import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { dataModelEditorOptions, isDarkMode, resolveMonacoTheme } from "@/lib/monaco/options";
import { parseDataModel } from "../../lib/guiDataModel";

export type DataModelPanelProps = {
  /** The raw JSON text (controlled by the parent so the model can be lifted up). */
  value: string;
  /**
   * Called on every edit with the new raw text AND the parse result, so the parent
   * can keep the last-good model live while still showing the error inline.
   */
  onChange: (text: string, parse: ReturnType<typeof parseDataModel>) => void;
};

/**
 * A controlled Monaco JSON editor for the data model. Parses on every keystroke and
 * reports both the text and the parse result upward; renders an inline error when
 * the JSON is invalid (in addition to Monaco's own squiggles).
 */
export function DataModelPanel({ value, onChange }: DataModelPanelProps) {
  const parse = parseDataModel(value);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Latest props read from inside long-lived Monaco listeners without forcing the
  // editor to be recreated when they change (mirrors ScriptEditor).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  // Guards programmatic writes so syncing an external `value` change (a new
  // component opened) doesn't echo back out through onChange.
  const applyingExternalRef = useRef(false);

  // Create / dispose the editor once. Content is synced by the effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      ...dataModelEditorOptions(),
      value: valueRef.current,
      theme: resolveMonacoTheme(isDarkMode()),
    });
    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return;
      const text = editor.getValue();
      onChangeRef.current(text, parseDataModel(text));
    });

    return () => {
      changeSub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // Sync external value changes (a new component opened) into the editor without
  // clobbering the cursor on no-op re-renders.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value === editor.getValue()) return;

    applyingExternalRef.current = true;
    const position = editor.getPosition();
    editor.setValue(value);
    if (position) editor.setPosition(position);
    applyingExternalRef.current = false;
  }, [value]);

  return (
    // No padding — Monaco fills the whole frame edge-to-edge. The parse error
    // floats as a thin bottom overlay so it never insets or shrinks the editor.
    <div className="relative h-full min-h-0">
      <div ref={containerRef} className="absolute inset-0" aria-invalid={!parse.ok} />
      {!parse.ok && (
        <p
          className="absolute inset-x-0 bottom-0 border-destructive/30 border-t bg-destructive/15 px-3 py-1 text-destructive text-xs"
          role="alert"
        >
          Invalid JSON: {parse.error}
        </p>
      )}
    </div>
  );
}
