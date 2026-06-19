/**
 * guiComponentMount — the pure, unit-testable MOUNT step for nested
 * `<Component>` rendering (F6b).
 *
 * A `<Component src="child.xml" .../>` is a reference: the preview resolves its
 * `src` to a sibling component file, parses it (F1), and mounts that subtree in
 * place of the `<Component>` box. This module owns the two pure decisions that
 * make the mount correct and safe — it does NOT fetch (that is the async cache,
 * `guiComponentCache.ts`) and it does NOT render (that is `GuiPreview.tsx`):
 *
 *   1. The CHILD-DATA-SCOPE rule (locked in F6a, design/xgui_ta.md "Component
 *      child data scope resolved (architect)"). A mounted child resolves its
 *      `{token}`s against its OVERRIDE ATTRIBUTES ONLY, as a FRESH MODEL — no
 *      parent data. The parent PRE-RESOLVES each override value in its own scope
 *      and hands the child concrete values. The override boundary is a VALUE
 *      boundary, not a token boundary. {@link resolveOverrides} does that
 *      pre-resolution; the renderer seats the result as a fresh
 *      `flatRootScope(...)`.
 *
 *   2. The CYCLE GUARD (ancestor-set). Nested mount is recursive: A→B→A would
 *      infinite-loop. {@link mountDecision} carries the SET of `src` basenames on
 *      the current mount path; before mounting a child whose `src` is already in
 *      that set, it returns a `recursive` placeholder decision instead of
 *      recursing. Ancestor-set is EXACT — it catches A→B→A and A→A with no false
 *      positives, unlike a depth cap.
 *
 * Both the missing-`src` and recursive-`src` outcomes share ONE placeholder in
 * the renderer (parameterized by reason). This module classifies the reason; the
 * placeholder box is drawn in `GuiPreview.tsx`.
 *
 * PURE: no React, no DOM, no Tauri. The override RESOLUTION reuses the binding
 * resolver unchanged — the child-root model is built from the SAME
 * `resolveStringProp`/`lookup` the renderer already trusts.
 *
 * @see design/xgui_ta.md — "Component child data scope resolved (architect)" and
 *   "(3) `<Component src>` resolution … Missing/recursive placeholders".
 */

import { type ResolveScope, resolveStringProp } from "./guiBinding";
import type { GuiNode } from "./guiNode";

/** The attribute naming the child component file (a bare basename, e.g. `bag_slot.xml`). */
export const SRC_ATTR = "src";

/**
 * The attribute naming a DATA OBJECT in the PARENT's model to seat as the mounted
 * child's whole fresh ROOT (e.g. `<Component src="button" data="buttonProps"/>`).
 * A bare model key (v1) resolved in the parent's current scope; the looked-up
 * object becomes the child's root, and any explicit override attributes on the same
 * `<Component>` layer ON TOP of it (see {@link resolveChildRoot}). Structural, so it
 * is excluded from the flat overrides — it selects the base, it is not itself a prop.
 */
export const DATA_ATTR = "data";

/**
 * Attribute names on a `<Component>` that are STRUCTURAL/instance-level, not data
 * overrides handed to the child. These are consumed by the PARENT's render of the
 * `<Component>` element (its own geometry/repetition/identity) and must NOT leak
 * into the child's fresh root as bindable props.
 *
 * - `src` selects the child file; `position`/`size`/`layer`/`visible` are the
 *   instance box's own geometry/order/visibility (they live on the `<Component>`,
 *   not the child — see design (3): the placeholder occupies "the component
 *   instance's own position/size").
 * - `id` is the element's local identity in the parent tree.
 *
 * Everything else on the `<Component>` is a freeform OVERRIDE passed to the child.
 */
const NON_OVERRIDE_ATTRS = new Set([
  SRC_ATTR,
  DATA_ATTR,
  "id",
  "position",
  "size",
  "layer",
  "visible",
]);

/**
 * Normalize a `src` value to the basename key the manifest/cache resolves against.
 * `src` is a bare basename by design (folders are not a resolution namespace —
 * design (3)), but we defensively strip any path segments and trim whitespace so a
 * stray `widgets/bag_slot.xml` still keys on `bag_slot.xml`. An empty/whitespace
 * `src` normalizes to `""` (→ treated as missing by the renderer).
 */
export function srcBasename(src: string | undefined): string {
  if (src === undefined) return "";
  const trimmed = src.trim();
  if (trimmed === "") return "";
  // Split on both separators; the last non-empty segment is the basename.
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] ?? trimmed;
}

/**
 * Pre-resolve a `<Component>`'s OVERRIDE attributes in the PARENT scope, returning
 * the concrete `{ name → value }` object that becomes the child's FRESH ROOT model
 * (F6a). This is the linchpin of the locked rule:
 *
 *   - Each override is resolved with the SAME `resolveStringProp` the renderer uses,
 *     in the PARENT's scope — so `label="{name}"` becomes `label = "Bitlynx"`
 *     (the parent model's name).
 *   - The result is a VALUE boundary: the child receives DATA, never tokens to
 *     re-resolve. A child `{label}` reads the concrete pre-resolved value.
 *   - An override that did NOT resolve in the parent (a missing parent field) is
 *     passed in its unresolved literal form (`"{name}"`) so the miss surfaces
 *     VISIBLY at the boundary inside the child rather than silently re-binding.
 *
 * Overrides are resolved by STRING INTERPOLATION ({@link resolveStringProp}) — the
 * most capable rule, and a strict superset of whole-value binding for this purpose:
 *   - a whole `{token}` (`label="{name}"`) interpolates to its stringified bound
 *     value — identical to a whole-value bind;
 *   - an embedded form (`caption="Item {n}"`) interpolates each token in place, so
 *     the author can build a value from several fields;
 *   - a literal (`actionText="Sell"`) passes straight through;
 *   - an unresolved token (`{missing}`) is left as its literal `{token}` form, so
 *     the parent-side miss surfaces VISIBLY at the boundary inside the child rather
 *     than silently re-resolving against the child's own data.
 *
 * Color/palette resolution is intentionally NOT applied to an override — an
 * override is DATA, not a styled color prop on this element. A child that consumes
 * an override as a color resolves the palette in ITS OWN scope, where it belongs.
 *
 * STRUCTURAL attrs (`src`, geometry, …) are excluded — they belong to the
 * parent's render of the `<Component>` box, not the child's data.
 */
export function resolveOverrides(
  component: GuiNode,
  parentScope: ResolveScope,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [name, raw] of Object.entries(component.attrs)) {
    if (NON_OVERRIDE_ATTRS.has(name)) continue;
    // String interpolation in the PARENT scope — the value crossing into the child
    // is concrete data; an unresolved token keeps its literal `{token}` form.
    overrides[name] = resolveStringProp(raw, parentScope).value;
  }
  return overrides;
}

/** Whether a value is a plain (non-array, non-null) object usable as a data base. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolve the `data="key"` BASE object for a `<Component>`: look the bare key up in
 * the PARENT's scope and return a SHALLOW COPY of the found object.
 *
 * Returns an empty object when there is no `data` attr, or the named key is absent /
 * resolves to a non-object — a miss leaves the child's `{token}`s unresolved (a
 * VISIBLE miss inside the child) rather than silently inheriting parent data, the
 * same boundary posture {@link resolveOverrides} takes for a missing override. The
 * copy is shallow because the override layer ({@link resolveChildRoot}) only sets
 * top-level fields; nested objects are shared read-only with the parent model.
 */
function resolveDataBase(component: GuiNode, parentScope: ResolveScope): Record<string, unknown> {
  const raw = component.attrs[DATA_ATTR];
  if (raw === undefined || raw.trim() === "") return {};
  const found = parentScope.lookup(raw.trim());
  return isPlainObject(found) ? { ...found } : {};
}

/**
 * Build the mounted child's fresh ROOT model (F6a, extended): the `data="key"` base
 * object from the parent model with the `<Component>`'s explicit override attributes
 * LAYERED ON TOP (each pre-resolved in the parent scope, overriding that top-level
 * field). With no `data` attr this reduces to {@link resolveOverrides} (the original
 * flat-overrides behavior); with no overrides it is just the base object.
 *
 * The child still resolves its `{token}`s as a FRESH MODEL — no parent fall-through.
 * `data` selects WHICH parent object seeds that model; overrides patch individual
 * fields on it. The result is seated by the renderer as
 * `flatRootScope(resolveChildRoot(...))`.
 */
export function resolveChildRoot(
  component: GuiNode,
  parentScope: ResolveScope,
): Record<string, unknown> {
  return {
    ...resolveDataBase(component, parentScope),
    ...resolveOverrides(component, parentScope),
  };
}

/** Why a `<Component>` renders as a placeholder instead of its mounted subtree. */
export type PlaceholderReason = "missing" | "recursive";

/**
 * The decision for one `<Component>` mount, computed purely (no fetch, no render):
 *
 *   - `{ kind: "placeholder", reason }` — render the shared placeholder box at the
 *     `<Component>`'s own geometry. `reason` is `"recursive"` when the cycle guard
 *     trips (src already on the mount path) or `"missing"` when `src` is blank.
 *   - `{ kind: "mount", basename, childAncestry }` — fetch+parse the child and
 *     mount it. `childAncestry` is the ancestor-set to carry INTO the child (the
 *     parent's set plus this basename), so a deeper A→…→A is caught.
 *
 * Note the cache layer still produces a `"missing"` placeholder when a non-blank
 * `src` does not resolve to a file (deleted/renamed) — that outcome needs the
 * async fetch, so it is decided in the renderer after the fetch settles, reusing
 * the SAME placeholder. This pure step settles the two decisions that need no I/O:
 * blank src, and the cycle guard.
 */
export type MountDecision =
  | { kind: "placeholder"; reason: PlaceholderReason }
  | { kind: "mount"; basename: string; childAncestry: ReadonlySet<string> };

/**
 * Decide how to render a `<Component>` given the set of `src` basenames already on
 * the mount path (the ANCESTOR SET — F6b cycle guard).
 *
 *   1. A blank/absent `src` → a `missing` placeholder (nothing to resolve).
 *   2. A `src` already in `ancestry` → a `recursive` placeholder (would loop).
 *   3. Otherwise → a `mount` decision carrying `ancestry ∪ {basename}` for the
 *      child to descend with.
 *
 * `ancestry` defaults to empty (a top-level `<Component>` has no component
 * ancestors). The set holds NORMALIZED basenames (see {@link srcBasename}).
 */
export function mountDecision(
  component: GuiNode,
  ancestry: ReadonlySet<string> = new Set(),
): MountDecision {
  const basename = srcBasename(component.attrs[SRC_ATTR]);
  if (basename === "") {
    return { kind: "placeholder", reason: "missing" };
  }
  if (ancestry.has(basename)) {
    return { kind: "placeholder", reason: "recursive" };
  }
  const childAncestry = new Set(ancestry);
  childAncestry.add(basename);
  return { kind: "mount", basename, childAncestry };
}
