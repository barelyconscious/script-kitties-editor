import {
  ChevronDown,
  ChevronRight,
  FileCode,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Sprite } from "@/components/Sprite";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  flattenGroups,
  type GameObject,
  type GameObjectType,
  GROUP_ORDER,
  groupObjects,
  hasScript,
} from "./gameObjects";

export interface ObjectListProps {
  objects: GameObject[];
  loading?: boolean;
  error?: string | null;
  /** Identity key (`objectType:id`) of the object whose tab is active, if any. */
  activeKey?: string | null;
  onOpen: (obj: GameObject) => void;
  /**
   * Open the "New object" modal. A `type` (from a group's "+") preselects it;
   * the top-level / rail "+" passes none so the modal defaults the type.
   */
  onNew: (type?: GameObjectType) => void;
  className?: string;
}

/** Stable identity key for an object, matching `activeKey`'s `objectType:id` shape. */
function keyOf(obj: GameObject): string {
  return `${obj.objectType}:${obj.id}`;
}

/**
 * The far-left object browser: every game object grouped by type under
 * collapsible headers, with a single search that filters across ALL groups.
 * Clicking a row opens (or focuses) that object's tab.
 *
 * Can collapse to a thin sprite-only rail (same grouped order, names surfaced on
 * hover) to reclaim horizontal space while keeping objects openable.
 */
export function ObjectList({
  objects,
  loading,
  error,
  activeKey,
  onOpen,
  onNew,
  className,
}: ObjectListProps) {
  const [query, setQuery] = useState("");
  // Collapsed group headers (expanded view only). Empty = everything expanded.
  const [collapsed, setCollapsed] = useState<Set<GameObjectType>>(() => new Set());
  // Whether the whole list is collapsed to the sprite-only rail. Default: expanded.
  const [railed, setRailed] = useState(false);

  // The rail ignores the search box, so build its grouping unfiltered. The
  // expanded view filters by the live query. Both share `groupObjects`.
  const groups = useMemo(
    () => groupObjects(objects, railed ? "" : query),
    [objects, query, railed],
  );
  const railObjects = useMemo(() => (railed ? flattenGroups(groups) : []), [railed, groups]);

  function toggleGroup(type: GameObjectType) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  if (railed) {
    return (
      <div
        className={cn("flex h-full min-h-0 w-12 shrink-0 flex-col border-r bg-sidebar", className)}
      >
        <div className="flex flex-col items-center gap-1 py-2">
          <button
            type="button"
            onClick={() => setRailed(false)}
            title="Expand object list"
            aria-label="Expand object list"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onNew()}
            title="New object"
            aria-label="New object"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pb-4">
          {loading || error || railObjects.length === 0
            ? null
            : railObjects.map((obj) => (
                <RailItem
                  key={keyOf(obj)}
                  obj={obj}
                  active={activeKey === keyOf(obj)}
                  onOpen={onOpen}
                />
              ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex h-full min-h-0 w-64 shrink-0 flex-col border-r bg-sidebar", className)}
    >
      <div className="flex items-center gap-1 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search objects…"
            className="pl-8"
          />
        </div>
        <button
          type="button"
          onClick={() => onNew()}
          title="New object"
          aria-label="New object"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setRailed(true)}
          title="Collapse object list"
          aria-label="Collapse object list"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {loading ? (
          <p className="px-3 py-8 text-center text-muted-foreground text-sm">Loading objects…</p>
        ) : error ? (
          <p className="px-3 py-8 text-center text-destructive text-sm">{error}</p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-8 text-center text-muted-foreground text-sm">
            {query.trim() ? `Nothing matches “${query}”.` : "No objects found."}
          </p>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.type);
            return (
              <div key={group.type} className="group/grp mb-1">
                <div className="flex items-center pr-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.type)}
                    className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide transition-colors hover:text-foreground"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                    <span>{group.label}</span>
                    <span className="ml-auto text-muted-foreground/60 tabular-nums">
                      {group.objects.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNew(group.type)}
                    title={`New ${group.label.replace(/s$/, "").toLowerCase()}`}
                    aria-label={`New ${group.label.replace(/s$/, "").toLowerCase()}`}
                    className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/grp:opacity-100"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {!isCollapsed && (
                  <ul>
                    {group.objects.map((obj) => (
                      <ObjectRow
                        key={keyOf(obj)}
                        obj={obj}
                        active={activeKey === keyOf(obj)}
                        onOpen={onOpen}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ObjectRow({
  obj,
  active,
  onOpen,
}: {
  obj: GameObject;
  active: boolean;
  onOpen: (obj: GameObject) => void;
}) {
  const scripted = hasScript(obj);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(obj)}
        title={obj.name}
        className={cn(
          "flex w-full items-center gap-2 px-2 py-1 pl-6 text-left text-sm transition-colors hover:bg-muted",
          active && "bg-muted font-medium",
        )}
      >
        {obj.sprite ? (
          <Sprite name={obj.sprite} className="size-5" lazy />
        ) : (
          <span className="size-5 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate">{obj.name}</span>
        {scripted && (
          <FileCode className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has script" />
        )}
      </button>
    </li>
  );
}

/** A single sprite button in the collapsed rail; hovering reveals the object name. */
function RailItem({
  obj,
  active,
  onOpen,
}: {
  obj: GameObject;
  active: boolean;
  onOpen: (obj: GameObject) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(obj)}
          aria-label={obj.name}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted",
            active && "bg-muted ring-1 ring-ring",
          )}
        >
          {obj.sprite ? (
            <Sprite name={obj.sprite} className="size-6" lazy />
          ) : (
            <span className="size-6 shrink-0" aria-hidden="true" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{obj.name}</TooltipContent>
    </Tooltip>
  );
}

export default ObjectList;

// Re-export so consumers needing the group order don't reach past this module.
export { GROUP_ORDER };
