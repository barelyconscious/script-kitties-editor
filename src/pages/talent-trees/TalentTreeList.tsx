/**
 * TalentTreeList — the collapsible left panel of the Talent Trees tool, modelled
 * on the GUI Editor's ComponentList: a search box, then TREES and CLUSTERS
 * sections (collapsible, each with a hover "+" to create one), and a row per
 * tree with an unsaved-changes dot and a hover delete.
 */

import {
  ChevronDown,
  ChevronRight,
  Network,
  Plus,
  SearchIcon,
  Shapes,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { CollapseRail } from "@/components/CollapseRail";
import { Input } from "@/components/ui/input";
import type { TalentTree, TreeKind } from "@/lib/talentTree";
import { cn } from "@/lib/utils";

const SECTIONS: { kind: TreeKind; label: string; empty: string }[] = [
  { kind: "tree", label: "Trees", empty: "No trees yet." },
  { kind: "cluster", label: "Clusters", empty: "No clusters yet." },
];

export function TalentTreeList({
  trees,
  activeId,
  dirtyIds,
  onOpen,
  onCreate,
  onDelete,
  onCollapse,
}: {
  trees: TalentTree[];
  activeId: string | null;
  /** Trees whose content differs from the last save. */
  dirtyIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onCreate: (kind: TreeKind) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<TreeKind>>(() => new Set());
  const q = query.trim().toLowerCase();

  return (
    <div className="relative flex h-full min-h-0 w-64 shrink-0 flex-col border-r bg-sidebar">
      <CollapseRail side="right" onClick={onCollapse} label="Collapse tree list" />
      <div className="px-3 py-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search trees…"
            className="pr-8 pl-8"
          />
          {query && (
            <button
              type="button"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto pb-4">
        {SECTIONS.map(({ kind, label, empty }) => {
          const all = trees
            .filter((t) => t.kind === kind)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          const rows = q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all;
          const isClosed = !q && closed.has(kind);
          const Icon = kind === "tree" ? Network : Shapes;
          return (
            <li key={kind}>
              <div className="group flex w-full min-w-0 items-center gap-1 pr-2 pl-2">
                <button
                  type="button"
                  onClick={() =>
                    setClosed((prev) => {
                      const next = new Set(prev);
                      if (next.has(kind)) next.delete(kind);
                      else next.add(kind);
                      return next;
                    })
                  }
                  className="flex min-w-0 flex-1 select-none items-center gap-1 py-1 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide transition-colors group-hover:text-foreground"
                >
                  {isClosed ? (
                    <ChevronRight className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 truncate">{label}</span>
                </button>
                <button
                  type="button"
                  aria-label={`New ${kind}`}
                  title={`New ${kind}`}
                  onClick={() => onCreate(kind)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              {!isClosed && (
                <ul>
                  {rows.length === 0 && (
                    <li className="px-3 py-2 text-muted-foreground text-xs">
                      {q ? "No matches." : empty}
                    </li>
                  )}
                  {rows.map((t) => (
                    <li key={t.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onOpen(t.id)}
                        title={t.name}
                        className={cn(
                          "flex w-full select-none items-center gap-2 py-1 pr-8 pl-5 text-left text-sm transition-colors hover:bg-muted",
                          activeId === t.id && "bg-muted font-medium",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            kind === "tree" ? "text-primary" : "text-muted-foreground",
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{t.name || "Untitled"}</span>
                        {dirtyIds.has(t.id) && (
                          <span
                            role="img"
                            aria-label="Unsaved changes"
                            title="Unsaved changes"
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                          />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${t.name}`}
                        title={`Delete ${t.name}`}
                        onClick={() => onDelete(t.id)}
                        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
