import { invoke } from "@tauri-apps/api/core";
import { SearchIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  bumpEntityVersion,
  type EntityKind,
  entityKindForSaveCommand,
  useEntityVersions,
} from "@/lib/entities/dataVersion";
import { cn } from "@/lib/utils";
import { EntityEditDialog, type EntityField } from "./EntityEditDialog";

/** Handed to a column's render so cells can drive the table — e.g. a tag chip
 * that puts its tag into the search box. */
export type ColumnContext = {
  setQuery: (query: string) => void;
};

export type Column<T> = {
  header: string;
  /** Exactly one column should be sticky — the left-pinned identity column. */
  sticky?: boolean;
  align?: "left" | "right";
  /** Extra classes for the body cell (e.g. muted text for secondary columns). */
  className?: string;
  /**
   * Cap this column's width and ellipsize overflow. Use for long free text
   * (descriptions, joined tags) so content-sizing the table doesn't make it huge.
   */
  truncate?: boolean;
  render: (row: T, ctx: ColumnContext) => ReactNode;
};

// Width cap applied to truncating columns.
const TRUNCATE_WIDTH = "max-w-[18rem]";

/**
 * Generic browse-and-edit table for a game-data entity. Handles loading, search,
 * the sticky-column scroll layout, and the edit dialog. Each entity supplies its
 * columns, field schema, filter, and the Tauri command names.
 */
export function EntityDataTable<T extends { id: string }>({
  loadCommand,
  load,
  saveCommand,
  saveArgKey,
  onSave,
  refreshKinds,
  entityLabel,
  columns,
  fields,
  filter,
  searchPlaceholder = "Filter…",
  title,
  saveDescription,
}: {
  /** Tauri command that returns the rows. Omit when supplying `load`. */
  loadCommand?: string;
  /** Custom loader (e.g. to join two sources). Overrides `loadCommand`. Must be
   * a stable reference (module scope or memoized) to avoid refetch loops. */
  load?: () => Promise<T[]>;
  /** Save command + its argument name. Omit when supplying `onSave`. */
  saveCommand?: string;
  saveArgKey?: string;
  /** Custom save (e.g. to write back two records). Overrides command-based save. */
  onSave?: (updated: T) => Promise<void>;
  /**
   * The entity-version kinds whose bump should re-fetch the rows (an in-app save
   * elsewhere, or an external disk edit routed through `data-changed`). Defaults
   * to the kind derived from `saveCommand`; tables using a custom `load`/`onSave`
   * (e.g. the items ⋈ drops join) must pass their kinds explicitly. Must be a
   * stable reference (module scope), like `load`.
   */
  refreshKinds?: readonly EntityKind[];
  /** Singular, lowercase — used in titles and empty states, e.g. "ability". */
  entityLabel: string;
  columns: Column<T>[];
  fields: EntityField<T>[];
  filter: (row: T, query: string) => boolean;
  searchPlaceholder?: string;
  title?: (row: T) => string;
  saveDescription?: string;
}) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<T | null>(null);
  // setQuery is a stable state setter, so this context never needs to change.
  const columnCtx = useMemo<ColumnContext>(() => ({ setQuery }), []);

  // The kinds whose version bump re-fetches the rows: explicit prop, else the
  // one derived from saveCommand. Memoized for a stable array reference.
  const kinds = useMemo<readonly EntityKind[]>(() => {
    if (refreshKinds) return refreshKinds;
    const kind = saveCommand ? entityKindForSaveCommand(saveCommand) : null;
    return kind ? [kind] : [];
  }, [refreshKinds, saveCommand]);
  // Re-fetch when a watched kind is saved anywhere (another surface, or an
  // external disk edit routed through `data-changed`) so the table never serves
  // its mount-time rows forever. Re-runs keep the current rows on screen until
  // fresh data lands — no loading flash (`rows` only gates the FIRST load).
  const version = useEntityVersions(kinds);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the re-fetch trigger, not read in the body.
  useEffect(() => {
    let cancelled = false;
    const fetch = load ? load() : invoke<T[]>(loadCommand as string);
    fetch
      .then((data) => !cancelled && setRows(data))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [loadCommand, load, version]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => filter(r, q)) : rows;
  }, [rows, query, filter]);

  async function handleSave(updated: T) {
    if (onSave) {
      await onSave(updated);
    } else {
      const command = saveCommand as string;
      await invoke(command, { [saveArgKey as string]: updated });
      // Notify open lists (e.g. the season editor's pickers) to re-fetch. The
      // saveX wrappers do this on the other write paths; this is the raw-command
      // path, so bump the matching kind here too.
      const kind = entityKindForSaveCommand(command);
      if (kind) bumpEntityVersion(kind);
    }
    // id isn't editable and is the sort key, so an in-place replace preserves
    // order — no refetch needed.
    setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev);
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
        Failed to load {entityLabel}s: {error}
      </div>
    );
  }

  if (!rows) {
    return <div className="p-4 text-muted-foreground text-sm">Loading {entityLabel}s…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={searchPlaceholder}
          className="pl-8"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        {/* w-max sizes the table to its content so every column (incl. the
            sticky name column) gets its full width and the table scrolls
            horizontally, instead of w-full squeezing columns to fit. */}
        <Table className="w-max min-w-full">
          <TableHeader>
            <TableRow className="group">
              {columns.map((col) =>
                col.sticky ? (
                  <TableHead
                    key={col.header}
                    className="sticky top-0 left-0 z-30 bg-background shadow-[inset_-1px_-1px_0_0_var(--border)] before:pointer-events-none before:absolute before:inset-0 before:bg-muted/50 before:opacity-0 before:transition-opacity group-hover:before:opacity-100"
                  >
                    <span className="relative">{col.header}</span>
                  </TableHead>
                ) : (
                  <TableHead
                    key={col.header}
                    className={cn(
                      "sticky top-0 z-20 bg-background shadow-[inset_0_-1px_0_0_var(--border)]",
                      col.align === "right" && "text-right",
                    )}
                  >
                    {col.header}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground text-sm"
                >
                  No {entityLabel}s match “{query}”.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow
                  key={row.id}
                  className="group cursor-pointer"
                  onClick={() => setEditing(row)}
                >
                  {columns.map((col) =>
                    col.sticky ? (
                      <TableCell
                        key={col.header}
                        className="sticky left-0 z-10 bg-background font-medium shadow-[inset_-1px_0_0_0_var(--border)] before:pointer-events-none before:absolute before:inset-0 before:bg-muted/50 before:opacity-0 before:transition-opacity group-hover:before:opacity-100"
                      >
                        <span className="relative flex items-center">
                          {col.render(row, columnCtx)}
                        </span>
                      </TableCell>
                    ) : (
                      <TableCell
                        key={col.header}
                        className={cn(
                          col.align === "right" && "text-right tabular-nums",
                          col.className,
                        )}
                      >
                        {col.truncate ? (
                          <div className={cn(TRUNCATE_WIDTH, "truncate")}>
                            {col.render(row, columnCtx)}
                          </div>
                        ) : (
                          col.render(row, columnCtx)
                        )}
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <EntityEditDialog
        entity={editing}
        fields={fields}
        title={editing ? (title?.(editing) ?? `Edit ${entityLabel}`) : `Edit ${entityLabel}`}
        description={saveDescription}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={handleSave}
      />
    </div>
  );
}

export default EntityDataTable;
