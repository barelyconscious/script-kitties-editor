/**
 * Pure, testable logic for the API reference pane.
 *
 * The reference pane renders the {@link GAME_API} tree (see `./gameApi.ts`).
 * Two concerns live here so they can be unit-tested without a DOM:
 *  - {@link filterApiTree}: a recursive search that keeps any item whose name or
 *    documentation matches the query *or* that has a surviving descendant, so a
 *    deep match is never orphaned from its ancestors.
 *  - {@link formatSignature}: renders a function/method's args → returns as a
 *    single Lua-ish string for display.
 */

import type { ApiArg, ApiItem } from "./gameApi";

/** Whether a single item's own name or documentation contains the query. */
export function itemMatches(item: ApiItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.documentation.toLowerCase().includes(q)) return true;
  return false;
}

/**
 * Recursively filter an API tree by a free-text query.
 *
 * An item is kept when it matches directly, or when any of its (possibly deep)
 * `members` survive the filter. A kept item whose own text did not match still
 * has its surviving children attached, so the path from a root item down to a
 * deep match stays navigable. Items kept only because an *ancestor* matched are
 * NOT force-included — a match high in the tree does not flood every descendant
 * into the results; only the matching item and the spine to its matches remain.
 *
 * The returned tree is a structural copy (new arrays/objects for touched
 * nodes); the input is never mutated.
 */
export function filterApiTree(items: ApiItem[], query: string): ApiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const result: ApiItem[] = [];
  for (const item of items) {
    const self = itemMatches(item, q);
    const filteredMembers = item.members ? filterApiTree(item.members, q) : undefined;

    if (self) {
      // Direct hit: keep the item with its FULL member list intact, so drilling
      // into a matched container shows everything it contains, not a filtered
      // subset that happens to share the query.
      result.push(item);
    } else if (filteredMembers && filteredMembers.length > 0) {
      // No direct hit, but descendants matched — keep this node as a spine,
      // carrying only the surviving members.
      result.push({ ...item, members: filteredMembers });
    }
  }
  return result;
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
