/**
 * XmlView — the XGUI main content's read-only XML tab (task 476). A Monaco editor
 * pinned to the `xml` language and `readOnly`, showing the LIVE serialized XML of
 * the open component (`serializeGui(open.root)`). It re-syncs whenever the visual
 * editor mutates the tree, so the XML always mirrors the current document.
 *
 * This is deliberately VIEW-ONLY for now: there is no XML→tree parse path here.
 * The editor remains visual-first; this tab is a window onto what Save will write,
 * useful for reading the structure and copying it out. Because it is read-only,
 * Monaco's own undo/redo is moot (task 472's focus-gating concern doesn't apply —
 * there is nothing to type), and no `onChange` is wired back into the store.
 *
 * Monaco setup (workers, language registration) is the app-wide `setupMonaco`;
 * this component only creates/disposes an editor instance and pushes new content
 * in. It parallels {@link import("@/components/ScriptEditor").ScriptEditor} but
 * for a non-editable XML surface, so it carries no `onChange`.
 */

import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { isDarkMode, resolveMonacoTheme, xmlViewerOptions } from "@/lib/monaco/options";
import { cn } from "@/lib/utils";

export interface XmlViewProps {
  /** The serialized XML text to display. Controlled by the parent (live-derived). */
  value: string;
  className?: string;
}

/**
 * A read-only Monaco editor showing the live serialized XML. The `value` is
 * pushed in on mount and on every change; cursor position is preserved across
 * syncs so a re-serialize from a visual edit doesn't yank the user's scroll.
 */
export function XmlView({ value, className }: XmlViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Latest value, read inside the create effect without re-creating the editor.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Create / dispose the editor once. Content is synced by the effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      ...xmlViewerOptions(),
      value: valueRef.current,
      theme: resolveMonacoTheme(isDarkMode()),
    });
    editorRef.current = editor;

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // Push new serialized XML in whenever the tree changes. No echo guard is needed
  // — the editor is read-only, so the only writes are these external syncs.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value === editor.getValue()) return;

    const position = editor.getPosition();
    editor.setValue(value);
    if (position) editor.setPosition(position);
  }, [value]);

  return <div ref={containerRef} className={cn("h-full w-full", className)} />;
}
