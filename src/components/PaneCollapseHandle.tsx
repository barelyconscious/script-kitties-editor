import { PanelLeftClose } from "lucide-react";

/**
 * A hover-revealed collapse control pinned to a left-docked pane's RIGHT border.
 * Clicking it collapses the pane. Drop it inside a pane whose root is
 * `relative group/pane` — the handle reveals on the pane's hover (the named
 * `group/pane` keeps it independent of the per-row `group` hovers inside the
 * list): the border line highlights and a small chevron tab fades in at the
 * vertical center, flush to the right edge.
 *
 * The tab is `pointer-events-none` until the pane is hovered, so an invisible
 * button never intercepts clicks on list rows underneath it.
 */
export function PaneCollapseHandle({
  onCollapse,
  label,
}: {
  /** Collapse the pane (the parent owns where the collapsed flag lives). */
  onCollapse: () => void;
  /** Accessible label / tooltip, e.g. "Collapse object list". */
  label: string;
}) {
  return (
    <>
      {/* The right border line, brightened while the pane is hovered so the edge
          reads as an interactive handle. Purely visual — never eats clicks. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-px bg-transparent transition-colors group-hover/pane:bg-primary/40" />
      {/* The collapse tab: flush to the right edge, vertically centered, revealed
          on pane hover. Disabled for pointer events until shown so it can't block
          row clicks while invisible. */}
      <button
        type="button"
        onClick={onCollapse}
        aria-label={label}
        title={label}
        className="pointer-events-none absolute top-1/2 right-0 z-20 flex size-6 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground group-hover/pane:pointer-events-auto group-hover/pane:opacity-100"
      >
        <PanelLeftClose className="size-3.5" />
      </button>
    </>
  );
}

export default PaneCollapseHandle;
