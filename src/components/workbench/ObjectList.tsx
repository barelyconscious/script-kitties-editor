import { ChevronDown, ChevronRight, FileCode, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Sprite } from "@/components/Sprite";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
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
  className?: string;
}

/**
 * The far-left object browser: every game object grouped by type under
 * collapsible headers, with a single search that filters across ALL groups.
 * Clicking a row opens (or focuses) that object's tab.
 */
export function ObjectList({
  objects,
  loading,
  error,
  activeKey,
  onOpen,
  className,
}: ObjectListProps) {
  const [query, setQuery] = useState("");
  // Collapsed group headers. Empty = everything expanded.
  const [collapsed, setCollapsed] = useState<Set<GameObjectType>>(() => new Set());

  const groups = useMemo(() => groupObjects(objects, query), [objects, query]);

  function toggle(type: GameObjectType) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <div
      className={cn("flex h-full min-h-0 w-64 shrink-0 flex-col border-r bg-background", className)}
    >
      <div className="relative px-3 py-2">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search objects…"
          className="pl-8"
        />
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
              <div key={group.type} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggle(group.type)}
                  className="flex w-full items-center gap-1 px-2 py-1.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide transition-colors hover:text-foreground"
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
                {!isCollapsed && (
                  <ul>
                    {group.objects.map((obj) => (
                      <ObjectRow
                        key={`${obj.objectType}:${obj.id}`}
                        obj={obj}
                        active={activeKey === `${obj.objectType}:${obj.id}`}
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

export default ObjectList;

// Re-export so consumers needing the group order don't reach past this module.
export { GROUP_ORDER };
