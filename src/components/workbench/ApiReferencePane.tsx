import {
  Box,
  Braces,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code2,
  FunctionSquare,
  Hash,
  KeyRound,
  Library,
  PanelRightOpen,
  SearchIcon,
  Type,
} from "lucide-react";
import { type ComponentType, useMemo, useState } from "react";
import { CollapseRail } from "@/components/CollapseRail";
import { Input } from "@/components/ui/input";
import { type ApiItem, type ApiItemType, GAME_API } from "@/lib/api/gameApi";
import {
  buildTypeIndex,
  filterApiTree,
  hasSignature,
  isDrillable,
  isPrimitiveType,
  resolveTypeRef,
} from "@/lib/api/search";
import { cn } from "@/lib/utils";

export interface ApiReferencePaneProps {
  /**
   * The API tree to render. Defaults to the bundled {@link GAME_API} — the
   * single source of truth. Overridable mainly for tests/stories.
   */
  items?: ApiItem[];
  /**
   * When true (the default), the pane renders its own collapse toggle and can
   * collapse to a thin rail. This keeps the pane self-contained — it owns no
   * Workbench state. Set false to render a fixed, always-open pane and let a
   * parent own the collapse.
   */
  collapsible?: boolean;
  /** Initial collapsed state when `collapsible`. */
  defaultCollapsed?: boolean;
  className?: string;
}

// Per-kind icon + accent color. Drives the leading glyph on every row.
const KIND_META: Record<
  ApiItemType,
  { Icon: ComponentType<{ className?: string }>; color: string }
> = {
  namespace: { Icon: Braces, color: "text-muted-foreground" },
  library: { Icon: Library, color: "text-violet-500" },
  object: { Icon: Box, color: "text-amber-500" },
  enum: { Icon: Hash, color: "text-teal-500" },
  function: { Icon: FunctionSquare, color: "text-blue-500" },
  method: { Icon: FunctionSquare, color: "text-blue-500" },
  property: { Icon: CircleDot, color: "text-muted-foreground" },
  constant: { Icon: CircleDot, color: "text-orange-500" },
  callback: { Icon: Code2, color: "text-pink-500" },
  keyword: { Icon: KeyRound, color: "text-rose-500" },
  string: { Icon: Type, color: "text-green-600" },
  int: { Icon: Type, color: "text-cyan-600" },
  double: { Icon: Type, color: "text-cyan-600" },
  bool: { Icon: Type, color: "text-cyan-600" },
};

/** Small uppercase kind/tag chip, matching the app's muted-pill styling. */
function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-medium text-[0.65rem] text-muted-foreground uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Renders a single type name (as written in a `detail`/arg/return string).
 *
 * If the name resolves to a known top-level type it becomes a link — the app's
 * accent color with a hover underline (matching the shadcn `link` button
 * idiom) — that drills into that type. Primitives and unknown names render as
 * plain text that inherits the surrounding (muted) color, so the color alone
 * teaches "type names in accent are navigable". A trailing `[]` on an array
 * type is left as adjacent plain text; only the element identifier links.
 */
function TypeRef({
  name,
  typeIndex,
  onOpenType,
}: {
  name: string;
  typeIndex: Map<string, ApiItem>;
  onOpenType: (name: string) => void;
}) {
  const trimmed = name.trim();
  const isArray = trimmed.endsWith("[]");
  const base = isArray ? trimmed.slice(0, -2) : trimmed;
  const resolved = isPrimitiveType(base) ? null : resolveTypeRef(base, typeIndex);

  if (!resolved) {
    return <span>{name}</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop the drill click on any enclosing row: a type link navigates to
          // the type, not into the row that renders it.
          e.stopPropagation();
          onOpenType(base);
        }}
        className="rounded-sm text-primary underline-offset-4 transition-colors hover:underline"
      >
        {base}
      </button>
      {isArray && <span>[]</span>}
    </>
  );
}

/** Renders `(a: T, b: U) → R`, threading each type through {@link TypeRef}. */
function Signature({
  item,
  typeIndex,
  onOpenType,
  className,
}: {
  item: Pick<ApiItem, "args" | "returns">;
  typeIndex: Map<string, ApiItem>;
  onOpenType: (name: string) => void;
  className?: string;
}) {
  const args = item.args ?? [];
  return (
    <span className={className}>
      {"("}
      {args.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: arg names can repeat across overloads; position is the stable identity within one signature.
        <span key={`${a.name}-${i}`}>
          {i > 0 && ", "}
          {`${a.name}: `}
          <TypeRef name={a.type} typeIndex={typeIndex} onOpenType={onOpenType} />
        </span>
      ))}
      {")"}
      {item.returns && (
        <>
          {" → "}
          <TypeRef name={item.returns.type} typeIndex={typeIndex} onOpenType={onOpenType} />
        </>
      )}
    </span>
  );
}

/** One row in a member/item list. Clickable when drillable. */
function ItemRow({
  item,
  onOpen,
  typeIndex,
  onOpenType,
}: {
  item: ApiItem;
  onOpen?: (item: ApiItem) => void;
  typeIndex: Map<string, ApiItem>;
  onOpenType: (name: string) => void;
}) {
  const meta = KIND_META[item.type];
  const Icon = meta.Icon;
  const drillable = isDrillable(item);
  const signature = hasSignature(item);

  const inner = (
    <>
      <Icon className={cn("mt-0.5 size-4 shrink-0", meta.color)} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium font-mono text-sm">{item.name}</span>
          {signature && (
            <Signature
              item={item}
              typeIndex={typeIndex}
              onOpenType={onOpenType}
              className="font-mono text-muted-foreground text-xs"
            />
          )}
          {item.detail && !signature && (
            <span className="font-mono text-muted-foreground text-xs">
              <TypeRef name={item.detail} typeIndex={typeIndex} onOpenType={onOpenType} />
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-muted-foreground text-xs">{item.documentation}</span>
      </span>
      {drillable && onOpen && (
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  if (drillable && onOpen) {
    // Drillable rows never render a TypeRef: no item in the tree is BOTH
    // drillable (has members) AND carries a signature/detail (types only appear
    // on leaf properties/methods, which fall through to the <div> below). So a
    // <button> row here never nests a TypeRef <button> inside it.
    return (
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex w-full items-start gap-2 px-2 py-2">{inner}</div>;
}

/** The drilled-in detail view: header signature, prose, examples, members. */
function ItemDetail({
  item,
  onOpen,
  typeIndex,
  onOpenType,
}: {
  item: ApiItem;
  onOpen: (item: ApiItem) => void;
  typeIndex: Map<string, ApiItem>;
  onOpenType: (name: string) => void;
}) {
  const signature = hasSignature(item);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold text-base">{item.name}</span>
          <Chip>{item.type}</Chip>
          {item.tags?.map((tag) => (
            <Chip key={tag} className="text-muted-foreground/80">
              {tag}
            </Chip>
          ))}
        </div>
        {signature && (
          <code className="block rounded bg-muted px-2 py-1 font-mono text-foreground/90 text-xs">
            <Signature item={item} typeIndex={typeIndex} onOpenType={onOpenType} />
          </code>
        )}
      </div>

      <p className="text-muted-foreground text-sm leading-relaxed">{item.documentation}</p>

      {item.examples && item.examples.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Examples
          </h4>
          {item.examples.map((ex) => (
            <div key={ex.title} className="flex flex-col gap-1">
              <span className="text-foreground/80 text-xs">{ex.title}</span>
              <pre className="overflow-x-auto rounded-md border bg-muted/50 p-2 font-mono text-xs">
                <code>{ex.code}</code>
              </pre>
            </div>
          ))}
        </div>
      )}

      {item.members && item.members.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Members
          </h4>
          <div className="flex flex-col divide-y divide-border/60">
            {item.members.map((member, i) => (
              <ItemRow
                // biome-ignore lint/suspicious/noArrayIndexKey: member names can repeat where the game overloads them (e.g. Creature.removeEffect); the index disambiguates.
                key={`${member.name}-${i}`}
                item={member}
                onOpen={onOpen}
                typeIndex={typeIndex}
                onOpenType={onOpenType}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The right-side API REFERENCE pane: a searchable, drill-in browser over the
 * Lua scripting API tree. Standalone — it holds only its own search/navigation
 * state and never touches Workbench state. Give it nothing and it renders the
 * bundled {@link GAME_API}.
 *
 * Search filters the top-level list across the whole tree (an item survives if
 * it or any descendant matches). Drilling into an item replaces the list with
 * that item's detail (signature, prose, examples) and its members; a breadcrumb
 * walks back up. No inline completion — that is a separate, deferred surface.
 */
export function ApiReferencePane({
  items = GAME_API,
  collapsible = true,
  defaultCollapsed = false,
  className,
}: ApiReferencePaneProps) {
  const [query, setQuery] = useState("");
  // The drill path from a root item down to the currently-focused item. Empty
  // means we are at the searchable root list.
  const [path, setPath] = useState<ApiItem[]>([]);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const rootList = useMemo(() => {
    const filtered = filterApiTree(items, query);
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [items, query]);

  // Resolve type refs against the UNFILTERED tree, so clicking a type from
  // inside a filtered view lands on the COMPLETE type, not a filtered stub.
  const typeIndex = useMemo(() => buildTypeIndex(items), [items]);

  const focused = path.length > 0 ? path[path.length - 1] : null;

  function open(item: ApiItem) {
    setPath((prev) => [...prev, item]);
  }
  function goToDepth(depth: number) {
    // depth 0 == root list; depth n == keep the first n items of the path.
    setPath((prev) => prev.slice(0, depth));
  }
  function openType(name: string) {
    // A cross-ref pushes the canonical top-level type onto the same drill stack;
    // the breadcrumb becomes a navigation trail (intentional). Unknown names
    // never reach here — TypeRef only renders resolved names as clickable.
    const item = resolveTypeRef(name, typeIndex);
    if (item) open(item);
  }

  if (collapsible && collapsed) {
    // The WHOLE strip is the click target (matching the Workbench/XGUI collapsed
    // list rails), so re-opening is "grab the rail", not "find the little button".
    return (
      <button
        type="button"
        aria-label="Show API reference"
        title="Show API reference"
        onClick={() => setCollapsed(false)}
        className={cn(
          "flex h-full w-10 shrink-0 flex-col items-center border-l bg-background py-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        <PanelRightOpen className="size-4 shrink-0" />
        <span className="flex min-h-0 flex-1 items-center">
          <span className="font-medium text-[0.6rem] uppercase tracking-widest [writing-mode:vertical-rl]">
            API Reference
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn("relative flex h-full min-h-0 w-80 flex-col border-l bg-background", className)}
    >
      {collapsible && (
        <CollapseRail side="left" onClick={() => setCollapsed(true)} label="Hide API reference" />
      )}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          API Reference
        </h3>
      </div>

      {focused ? (
        <Breadcrumb path={path} onRoot={() => goToDepth(0)} onCrumb={(d) => goToDepth(d)} />
      ) : (
        <div className="relative px-3 py-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search the API…"
            className="pl-8"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {focused ? (
          <ItemDetail item={focused} onOpen={open} typeIndex={typeIndex} onOpenType={openType} />
        ) : rootList.length === 0 ? (
          <p className="px-2 py-8 text-center text-muted-foreground text-sm">
            Nothing matches “{query}”.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border/60">
            {rootList.map((item) => (
              <ItemRow
                key={item.name}
                item={item}
                onOpen={open}
                typeIndex={typeIndex}
                onOpenType={openType}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Back affordance + breadcrumb trail for the drill path. */
function Breadcrumb({
  path,
  onRoot,
  onCrumb,
}: {
  path: ApiItem[];
  onRoot: () => void;
  onCrumb: (depth: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 border-b px-2 py-1.5 text-sm"
      style={{ padding: "8px" }}
    >
      <button
        type="button"
        title="Back to all"
        onClick={() => (path.length > 1 ? onCrumb(path.length - 1) : onRoot())}
        className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
      </button>
      <nav className="flex min-w-0 flex-wrap items-center gap-0.5">
        <button
          type="button"
          onClick={onRoot}
          className="rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          API
        </button>
        {path.map((item, i) => {
          const isLast = i === path.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a drill path is an ordered stack that can repeat a type name; the depth index is the stable identity.
            <span key={`${item.name}-${i}`} className="flex items-center gap-0.5">
              <ChevronRight className="size-3.5 text-muted-foreground/60" />
              {isLast ? (
                <span className="font-medium font-mono text-foreground">{item.name}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onCrumb(i + 1)}
                  className="rounded px-1 py-0.5 font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {item.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}

export default ApiReferencePane;
