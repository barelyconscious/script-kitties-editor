/**
 * DataModelPanel — the XGUI editor's right-side Data Model panel (F3 wiring).
 *
 * The user types raw JSON; it parses into the flat root model the preview's
 * `{token}` bindings resolve against. Editing the JSON updates the preview (the
 * parent lifts the parsed model into the preview's `model` prop). Invalid JSON is
 * surfaced inline without tearing down the last good model — the preview keeps
 * showing the most recent valid state rather than blanking on a stray keystroke.
 *
 * This is intentionally thin: a controlled `<textarea>` over the pure
 * {@link parseDataModel}. The forEach scope stack (F4) does not change this panel —
 * it still supplies the root JSON; scoping is applied downstream in the resolver.
 *
 * @see design/xgui_ta.md — "Data Model panel (right of main content, collapsible)"
 */

import { Textarea } from "../../components/ui/textarea";
import { parseDataModel } from "../../lib/guiDataModel";
import { cn } from "../../lib/utils";

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
 * A controlled JSON editor for the data model. Parses on every keystroke and
 * reports both the text and the parse result upward; renders an inline error when
 * the JSON is invalid.
 */
export function DataModelPanel({ value, onChange }: DataModelPanelProps) {
  const parse = parseDataModel(value);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium text-sm">Data Model</h2>
        <span className="text-muted-foreground text-xs">JSON drives the preview</span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value, parseDataModel(e.target.value))}
        spellCheck={false}
        placeholder={'{\n  "health": 15,\n  "maxHealth": 25\n}'}
        className={cn(
          "min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed",
          !parse.ok && "border-destructive focus-visible:border-destructive",
        )}
        aria-invalid={!parse.ok}
      />
      {!parse.ok ? (
        <p className="text-destructive text-xs" role="alert">
          Invalid JSON: {parse.error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Tokens like <code className="font-mono">{"{health}"}</code> resolve from these fields;
          unbound tokens render dimmed in the preview.
        </p>
      )}
    </div>
  );
}
