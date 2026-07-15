/**
 * Pure, testable logic for the API reference pane.
 *
 * The reference pane renders the {@link GAME_API} tree (see `./gameApi.ts`).
 * Two concerns live here so they can be unit-tested without a DOM:
 *  - {@link filterApiTree}: a NAME-ONLY search over the top-level items — an item
 *    is kept iff its own name matches the query (documentation and members/subtypes
 *    are not searched), with its full member list retained so it stays drillable.
 *  - {@link formatSignature}: renders a function/method's args → returns as a
 *    single Lua-ish string for display.
 */

import type { ApiArg, ApiItem } from "./gameApi";

/**
 * Whether a single item's own NAME contains the query (case-insensitive). The
 * search is deliberately name-only — an item's `documentation` prose is NOT matched
 * — so the search bar finds types by name rather than acting as a full-text index.
 */
export function itemMatches(item: ApiItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q);
}

/**
 * Filter an API list by a free-text query, keeping ONLY the top-level items whose
 * own NAME matches. Documentation is not searched, and members (subtypes) do NOT
 * pull their parent in — searching a method/property name like `applyEffect` finds
 * nothing at the root, because the search is a type-name finder, not a deep
 * full-text index. A kept item retains its full member list, so drilling into it
 * still shows everything it contains.
 *
 * Returns the input array unchanged for an empty query; never mutates the input.
 */
export function filterApiTree(items: ApiItem[], query: string): ApiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => itemMatches(item, q));
}

/**
 * Render a function/method/constructor signature as `(a: T, b: U) → R`.
 * Returns an empty string for items that take no args and return nothing
 * (callers can then choose to render nothing).
 */
export function formatSignature(item: Pick<ApiItem, "args" | "returns">): string {
  const args: ApiArg[] = item.args ?? [];
  const params = args.map((a) => `${a.name}: ${a.type}`).join(", ");
  const head = `(${params})`;
  return item.returns ? `${head} → ${item.returns.type}` : head;
}

/** Whether an item kind carries a call signature worth rendering. */
export function hasSignature(item: ApiItem): boolean {
  return (
    item.type === "function" ||
    item.type === "method" ||
    item.type === "callback" ||
    item.args !== undefined ||
    item.returns !== undefined
  );
}

/** Whether an item can be drilled into (has child members to show). */
export function isDrillable(item: ApiItem): boolean {
  return !!item.members && item.members.length > 0;
}

/**
 * The closed set of language/game primitive type names. These are never
 * linkable in the reference pane — they resolve to nothing to drill into, so a
 * `TypeRef` renders them as plain muted text. Matched case-insensitively so a
 * stray `Bool`/`String` is still treated as a primitive rather than a dead link.
 */
const PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  "string",
  "int",
  "double",
  "bool",
  "table",
  "any",
  "void",
  "number",
  "function",
  "nil",
]);

/** Whether a bare type name is a non-linkable primitive. */
export function isPrimitiveType(name: string): boolean {
  return PRIMITIVE_TYPES.has(name.trim().toLowerCase());
}

/**
 * Build a `name → ApiItem` index over the TOP-LEVEL items of an API tree.
 *
 * Top-level names are unique per the module's authoring rules (see
 * `gameApi.ts`), so a lookup is unambiguous. This must be built over the
 * UNFILTERED tree so a type ref resolved from inside a filtered view lands on
 * the complete type, not a filtered stub. The first occurrence of a name wins;
 * later duplicates (which should not exist) are ignored.
 */
export function buildTypeIndex(items: ApiItem[]): Map<string, ApiItem> {
  const index = new Map<string, ApiItem>();
  for (const item of items) {
    if (!index.has(item.name)) index.set(item.name, item);
  }
  return index;
}

/**
 * Resolve a type name (as written in a `detail`/arg/return string) to its
 * canonical top-level {@link ApiItem}, or `null` if it names no known type.
 *
 * A trailing `[]` (array types like `CreatureEffect[]`) is stripped before
 * lookup — the element type is what you drill into. Unknown names (typos,
 * unmodeled types) and primitives (which are never indexed) return `null`.
 */
export function resolveTypeRef(name: string, index: Map<string, ApiItem>): ApiItem | null {
  const base = name.trim().replace(/\[\]$/, "");
  return index.get(base) ?? null;
}
