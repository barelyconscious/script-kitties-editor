/**
 * DiskChangeNotice — the non-destructive "this file changed on disk" banner shown
 * when the OPEN component's `.xml` is edited externally WHILE the editor has
 * unsaved changes (F13). It mirrors F11's warn-on-switch trust model: the user's
 * draft is NEVER silently overwritten; we surface the conflict and let them
 * choose. The default (dismiss) KEEPS their draft — Reload is the deliberate,
 * destructive action they opt into.
 *
 * Presentational only: it renders the two choices and reports the pick; the
 * caller (the component list) owns the actual re-read/re-parse on Reload.
 *
 * @see design/xgui_ta.md — section 7 "Warn on switch" (the trust model).
 */

import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DiskChangeNoticeProps = {
  /** Basename of the component whose file changed under unsaved edits. */
  componentName: string;
  /** Discard the local draft and re-read the file from disk. */
  onReload: () => void;
  /** Keep the local draft; dismiss the notice (the safe default). */
  onKeep: () => void;
};

export function DiskChangeNotice({ componentName, onReload, onKeep }: DiskChangeNoticeProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-amber-700 text-xs dark:text-amber-400">
      <span className="min-w-0 flex-1">
        <span className="font-mono">{componentName}</span> changed on disk, but you have unsaved
        edits. Reloading will discard your changes.
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onReload}
        className="h-6 gap-1 px-2 text-destructive text-xs hover:text-destructive"
      >
        <RefreshCw className="size-3" aria-hidden />
        Reload
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onKeep}
        className="h-6 gap-1 px-2 text-xs"
        title="Keep my unsaved changes"
      >
        <X className="size-3" aria-hidden />
        Keep my changes
      </Button>
    </div>
  );
}
