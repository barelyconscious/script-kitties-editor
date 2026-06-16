/**
 * MainContentSkeleton — the empty / first-run placeholder for the XGUI main
 * content (F12, design section 8). When nothing is open — either the `gui/`
 * folder is empty (no component to pick) or the user simply hasn't opened one
 * yet — the main content shows a SKELETON LAYOUT instead of a blank panel, so a
 * first-run user sees the *structure* of a component coming rather than emptiness
 * or an error.
 *
 * Both "empty gui/" and "nothing selected" collapse to the same condition at this
 * seam: the shared store's `open` is `null` (see {@link MainContent} in
 * {@link Xgui}). The skeleton is purely presentational — a greyed wireframe of a
 * typical View (header bar, a couple of rows, an action) plus one quiet line of
 * guidance pointing at the component list.
 *
 * @see design/xgui_ta.md — "Empty / first-run state".
 */

import { LayoutTemplate } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { OpenComponent } from "./editorState";

/** What the XGUI main content should render. */
export type MainContentMode = "preview" | "skeleton";

/**
 * Decide what the main content shows. The preview renders only when a component
 * is open; otherwise the empty/first-run skeleton stands in. An empty `gui/`
 * folder and a not-yet-opened component both reach here as `open === null`, so
 * both yield the skeleton — never a blank panel.
 */
export function mainContentMode(open: OpenComponent | null): MainContentMode {
  return open ? "preview" : "skeleton";
}

/**
 * The wireframe + guidance shown when no component is open. Sized to read as
 * "structure coming" — a faint component-shaped scaffold, never an error.
 */
export function MainContentSkeleton() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        {/* The skeleton wireframe — a stylised View: title bar, a row of fields,
            and an action button. Greyed and non-interactive; it stands in for the
            component that will render here once one is opened. */}
        <div aria-hidden className="w-full rounded-lg border border-dashed bg-background/40 p-4">
          <div className="flex flex-col gap-3">
            {/* Title bar */}
            <div className="flex items-center gap-2">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            {/* Body rows */}
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <div className="flex gap-2">
              <Skeleton className="h-16 flex-1 rounded-md" />
              <Skeleton className="h-16 flex-1 rounded-md" />
            </div>
            <Skeleton className="h-3 w-2/3" />
            {/* Action */}
            <div className="flex justify-end">
              <Skeleton className="h-7 w-24 rounded-md" />
            </div>
          </div>
        </div>

        {/* The one quiet line of guidance — points at the component list rather
            than reading as a failure. */}
        <div className="flex flex-col items-center gap-1 text-center">
          <LayoutTemplate className="size-5 text-muted-foreground" aria-hidden />
          <p className="font-medium text-foreground text-sm">No component open</p>
          <p className="max-w-xs text-muted-foreground text-xs">
            Pick a component from the list, or use <span className="font-medium">+</span> to create
            one. Its layout will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
