/**
 * guiForEach — the pure, unit-testable STAMPING step for `forEach` repetition
 * (F4).
 *
 * A node carrying `forEach="{collection}"` is a TEMPLATE: it is stamped once per
 * item in the bound collection, and inside each stamped subtree bare tokens
 * resolve against that item (via {@link ScopeStack}). This module turns one
 * (template node, enclosing scope) pair into the list of INSTANCES the renderer
 * paints — it does not render; it computes "how many, and with which item scope."
 *
 * The locked semantics (design/xgui_ta.md — "forEach semantics resolved"):
 *
 *   - The `forEach` value is a `{collection}` token resolved in the ENCLOSING
 *     scope (the scope the template node sits in — item scope if the template is
 *     itself nested under another `forEach`, root otherwise). Per the rules a bare
 *     token is item-scoped and `$.` is root, so `forEach="{cells}"` under an outer
 *     loop reads `cells` off the outer item.
 *   - The collection must resolve to an ARRAY. Each element becomes one instance,
 *     rendered with a stack that PUSHES that element as the current item scope.
 *   - **Empty or unresolved collection → ZERO instances.** A non-array value
 *     (object/scalar/`undefined`) is treated as empty — zero instances. The
 *     template node itself is unaffected here: it always remains ONE node in the
 *     editor tree (selectable/editable); this module governs only the PREVIEW's
 *     rendered instance count.
 *   - **Identity is positional (index).** The optional `key` attribute is stored
 *     verbatim on the node and is NOT interpreted here — the editor re-stamps
 *     wholesale on data-model change (preview arrays are small), so the instance
 *     key is just the array index. (The runtime honors `key`; the editor does
 *     not — consistent with how it stores event handlers it doesn't interpret.)
 *
 * This module is PURE (no React, no DOM). The renderer reads `node.attrs.forEach`
 * to decide whether a child is a template, then calls {@link stampForEach} to get
 * its instances; a node WITHOUT `forEach` renders exactly once in its inherited
 * scope (the non-template path stays in the renderer).
 *
 * @see design/xgui_ta.md — "Repetition and control flow (`forEach`)".
 */

import { isWholeToken } from "./guiBinding";
import type { GuiNode } from "./guiNode";
import type { ScopeStack } from "./guiScope";

/** The attribute name that marks a node as a `forEach` template. */
export const FOR_EACH_ATTR = "forEach";

/**
 * Matches a whole-value `{token}` and captures the token text. `forEach` is a
 * whole-value binding only (`forEach="{items}"`), never interpolation — a
 * surrounding-text form (`forEach="x{items}"`) is not a meaningful collection
 * binding and is treated as "no resolvable collection" (→ zero instances).
 */
const WHOLE_TOKEN = /^\{([^{}]+)\}$/;

/**
 * One stamped instance of a `forEach` template: the template node to render and
 * the scope to render it in (the enclosing scope with this item pushed). All
 * instances share the template's `nodeId`; `instanceKey` disambiguates them in
 * the DOM (`data-instance-key`) and as a React key — it is the array index
 * (positional identity), NOT the authored `key` attribute.
 */
export type ForEachInstance = {
  /** The template node — shared across all instances of this `forEach`. */
  node: GuiNode;
  /** The scope to render this instance in: enclosing scope + this item pushed. */
  scope: ScopeStack;
  /** Positional instance key (`"0"`, `"1"`, …) — the array index, stringified. */
  instanceKey: string;
};

/** Whether a node carries a `forEach` template binding (a non-empty `forEach` attr). */
export function isForEachTemplate(node: GuiNode): boolean {
  const raw = node.attrs[FOR_EACH_ATTR];
  return raw !== undefined && raw.trim() !== "";
}

/**
 * Resolve the `forEach` collection token in the enclosing scope and return the
 * array it binds to, or `null` when it does not resolve to an array.
 *
 * The `forEach` value must be a whole-value `{token}` (per Data binding: typed
 * attributes are whole-value, never interpolated). A non-token literal, an
 * interpolated form, an unresolved token, or a token bound to a non-array value
 * all yield `null` → zero instances. An empty array yields `[]` → also zero
 * instances, but distinguishable for callers that care (the design notes the two
 * read differently in the tree, though both render nothing).
 */
export function resolveCollection(node: GuiNode, enclosing: ScopeStack): unknown[] | null {
  const raw = node.attrs[FOR_EACH_ATTR];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!isWholeToken(trimmed)) return null;
  const token = WHOLE_TOKEN.exec(trimmed)?.[1];
  if (token === undefined) return null;
  const bound = enclosing.lookup(token);
  return Array.isArray(bound) ? bound : null;
}

/**
 * Stamp a `forEach` template into its instances.
 *
 * Resolves the collection in `enclosing` and returns one {@link ForEachInstance}
 * per array element, each carrying a scope with that element pushed as the
 * current item. An unresolved/non-array/empty collection returns `[]` — ZERO
 * instances — which is exactly the design's empty-state render outcome.
 *
 * Callers should invoke this ONLY for nodes where {@link isForEachTemplate} is
 * true; a non-template node renders once in its inherited scope, which is the
 * renderer's plain path, not this function's job.
 */
export function stampForEach(node: GuiNode, enclosing: ScopeStack): ForEachInstance[] {
  const items = resolveCollection(node, enclosing);
  if (items === null) return [];
  return items.map((item, index) => ({
    node,
    scope: enclosing.push(item),
    instanceKey: String(index),
  }));
}
