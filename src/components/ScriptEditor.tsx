import * as monaco from "monaco-editor";
import { type ReactNode, useEffect, useRef } from "react";
import { isDarkMode, resolveMonacoTheme, scriptEditorOptions } from "@/lib/monaco/options";
import { cn } from "@/lib/utils";

export interface ScriptEditorProps {
  /** Current script contents. Controlled — the parent owns this value. */
  value: string;
  /** Fired on every user edit with the editor's new contents. */
  onChange: (value: string) => void;
  /** Fired when the user presses ⌘S / Ctrl+S inside the editor. */
  onSave?: () => void;
  /** When true, the editor renders but rejects edits (resolved-but-immutable). */
  readOnly?: boolean;
  /**
   * Presentation hook for the non-editable states the script pane will drive —
   * script-less objects and broken-install errors. When provided, this content
   * is shown *instead of* the editor and no Monaco instance is mounted.
   */
  placeholder?: ReactNode;
  className?: string;
}

/**
 * A controlled Monaco editor for Lua scripts. `value` + `onChange` make it a
 * standard controlled input; `onSave` wires ⌘S. It deliberately carries no
 * knowledge of objects, entity types, or persistence — the workspace owns all
 * of that. Syntax highlighting only: no completion, no validation (v1 scope).
 *
 * The language is registered once globally by `setupMonaco`; this component
 * only creates and disposes editor instances.
 */
export function ScriptEditor({
  value,
  onChange,
  onSave,
  readOnly = false,
  placeholder,
  className,
}: ScriptEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Latest props read from inside long-lived Monaco listeners without forcing
  // the editor to be recreated when they change.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const valueRef = useRef(value);
  valueRef.current = value;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // Guards programmatic writes so syncing an external `value` change doesn't
  // echo back out through onChange. A single flag — not the predecessor's
  // per-entityType global dance.
  const applyingExternalRef = useRef(false);

  const showPlaceholder = placeholder != null;

  // Create / dispose the editor. Recreated only when toggling in/out of the
  // placeholder state; value/readOnly are synced by the effects below.
  useEffect(() => {
    if (showPlaceholder) return;
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      ...scriptEditorOptions(readOnlyRef.current),
      value: valueRef.current,
      theme: resolveMonacoTheme(isDarkMode()),
    });
    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return;
      onChangeRef.current(editor.getValue());
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });

    return () => {
      changeSub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [showPlaceholder]);

  // Sync external value changes (a new object opened, a sibling-tab refresh)
  // into the editor without clobbering the cursor on no-op re-renders.
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

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  if (showPlaceholder) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center p-6 text-center text-muted-foreground text-sm",
          className,
        )}
      >
        {placeholder}
      </div>
    );
  }

  return <div ref={containerRef} className={cn("h-full w-full", className)} />;
}
