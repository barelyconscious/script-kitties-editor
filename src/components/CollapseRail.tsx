/**
 * CollapseRail — a thin, edge-hugging strip that collapses its parent panel on
 * click, adapting shadcn's `SidebarRail` interaction WITHOUT pulling in the full
 * Sidebar/`useSidebar` context. The affordance lives ON the panel's border seam
 * (not as a header icon button): a hairline + a resize cursor reveal on hover so
 * "grab the edge to collapse" teaches itself.
 *
 * The parent panel MUST be positioned (`relative`). `side` names the panel EDGE
 * the rail hugs — a LEFT-docked panel collapses via its RIGHT edge
 * (`side="right"`); a RIGHT-docked panel collapses via its LEFT edge
 * (`side="left"`).
 *
 * Re-opening is handled separately by each surface's collapsed strip (a slim
 * labelled rail shown in the panel's place), so this only ever collapses.
 *
 * Note: the rail straddles the panel's border, so on a left-docked list whose
 * content scrolls, it overlaps the outer few px of that scrollbar. The strip is
 * kept narrow to minimise it; the bulk of the scrollbar stays grabbable.
 */

import { cn } from "@/lib/utils";

export function CollapseRail({
  side,
  onClick,
  label,
  className,
}: {
  /** The panel edge the rail hugs: `right` for a left-docked panel, `left` for a right-docked one. */
  side: "left" | "right";
  onClick: () => void;
  /** Accessible name + tooltip, e.g. "Collapse object list". */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        // A narrow vertical hit strip centered on the panel's border seam. Kept
        // focusable (no tabIndex=-1) so collapsing stays keyboard-reachable now
        // that the header button is gone.
        "group/rail absolute inset-y-0 z-20 w-2.5 cursor-col-resize outline-none",
        side === "right" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
        // The 2px hairline: transparent at rest (the panel border carries the
        // visible edge), brightening on hover/keyboard-focus so the collapse
        // affordance is findable.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary/50 focus-visible:after:bg-primary",
        className,
      )}
    />
  );
}

export default CollapseRail;
