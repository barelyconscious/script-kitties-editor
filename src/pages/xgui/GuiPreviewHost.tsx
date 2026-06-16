/**
 * GuiPreviewHost — wires the F3 resolution loop end to end:
 *
 *   Data Model JSON  ──parse──▶  flat root model ─┐
 *   palette (get_palette, module-cached) ─────────┼──▶ GuiPreview resolves tokens
 *                                                  │     + palette names + colors
 *   recolor → invalidatePalette() → re-fetch ─────┘
 *
 * Holds the Data Model panel's text and the LAST GOOD parsed model (so an invalid
 * keystroke surfaces an error without blanking the preview), subscribes to the
 * module-cached palette so a recolor updates the preview, and threads both into
 * {@link GuiPreview}. Selection is lifted here so it stays the single shared state
 * the tree/properties panels will also read (F8/F9).
 *
 * This is the smallest composition that satisfies the F3 acceptance criteria
 * "editing the Data Model JSON updates the preview" and "recoloring a palette entry
 * updates the preview." The full XGUI page shell (component list, structure column,
 * tabs) is later work; this host is the preview-side integration point those will
 * mount.
 */

import { useState } from "react";
import type { GuiNode } from "../../lib/guiNode";
import { usePalette } from "../../lib/guiPalette";
import { DataModelPanel } from "./DataModelPanel";
import { GuiPreview } from "./GuiPreview";

export type GuiPreviewHostProps = {
  /** The parsed component to preview. */
  root: GuiNode;
  /** Initial Data Model JSON text (defaults to an empty object). */
  initialModelText?: string;
};

/**
 * The preview + Data Model panel pair. The model text is controlled here; the last
 * successfully-parsed model is kept live so the preview only re-resolves against
 * valid JSON. The palette comes from the module-cached hook, so a recolor (which
 * calls `invalidatePalette`) re-fetches and re-renders without a remount.
 */
export function GuiPreviewHost({ root, initialModelText = "{}" }: GuiPreviewHostProps) {
  const [modelText, setModelText] = useState(initialModelText);
  // Last GOOD model: only advanced when the JSON parses, so an invalid keystroke
  // shows the error (in the panel) but the preview keeps the last valid state.
  const [model, setModel] = useState<unknown>(() => {
    try {
      return JSON.parse(initialModelText);
    } catch {
      return {};
    }
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const palette = usePalette();

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <GuiPreview
          root={root}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
          model={model}
          palette={palette}
        />
      </div>
      <div className="w-80 shrink-0 border-border border-l">
        <DataModelPanel
          value={modelText}
          onChange={(text, parse) => {
            setModelText(text);
            if (parse.ok) setModel(parse.model);
          }}
        />
      </div>
    </div>
  );
}
