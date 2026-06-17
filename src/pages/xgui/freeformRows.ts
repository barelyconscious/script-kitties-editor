/**
 * freeformRows — the pure, unit-testable core behind the Properties panel's
 * FREEFORM OVERRIDE rows (task 486). A `<Component>`'s arbitrary override props
 * (and any unrecognized attribute) render as editable name→value pairs. This
 * module owns the LOCAL-ROW model those inputs are driven from and the
 * reconciliation between that model and the node's `attrs` map.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A LOCAL-ROW MODEL (the focus bug, task 486)
 * ─────────────────────────────────────────────────────────────────────────────
 * The previous panel re-derived rows from `node.attrs` every render and keyed
 * each row by its (EDITABLE) attribute name. Typing in the name input renamed the
 * attr, which changed the row's React key, which REMOUNTED the `<input>` — focus
 * lost after every keystroke. Worse, clearing a value to empty went through the
 * generic "set or clear" write, so Cmd/Ctrl+Backspace (which empties the field)
 * DELETED the whole property.
 *
 * The fix: each override row carries a STABLE generated id ({@link OverrideRow.id})
 * that survives renames and value edits. The panel drives its inputs off local
 * rows keyed by that id, so the input never remounts while you type; renaming a
 * key only mutates the row's `name`, never its identity. Commit to `attrs`
 * rebuilds the freeform region from the rows ({@link rowsToAttrs}) — a blank-named
 * row is simply not committed (it's an in-progress add), and an empty VALUE is
 * preserved as `name=""` rather than triggering a remove. Removal happens ONLY via
 * the explicit remove button (drop the row from local state, then commit).
 *
 * No React, no IO here — {@link PropertiesPanel} reads and dispatches off these,
 * mirroring {@link import("./guiProperties")}.
 */

import type { GuiNode } from "../../lib/guiNode";
import { fieldsForTag } from "./guiProperties";

/**
 * One freeform override row in the Properties panel's LOCAL state.
 *
 * - `id` is an editor-internal, session-only handle minted when the row first
 *   appears (derived from an existing attr, or created by "Add property"). It is
 *   the React key the row's inputs are keyed by, so it MUST survive name/value
 *   edits — that stability is the whole point (task 486). Never serialized.
 * - `name` / `value` are the editable attribute name and value, verbatim. Either
 *   may be transiently empty while editing without the row being removed.
 */
export type OverrideRow = {
  id: string;
  name: string;
  value: string;
};

/** Monotonic counter backing {@link mintRowId}; session-only. */
let rowIdCounter = 0;

/**
 * Mint a fresh, session-only override-row id. Stable for the row's lifetime in
 * the panel; never serialized. Distinct from the attribute NAME (which the user
 * edits) so a rename never changes a row's React identity.
 */
export function mintRowId(): string {
  rowIdCounter += 1;
  return `row${rowIdCounter}`;
}

/**
 * The freeform override attribute NAMES on a node, in authored order: attributes
 * it carries that are neither in the well-known schema for its tag nor handled
 * specially (`id`, and `src` on `<Component>`). Mirrors
 * {@link import("./guiProperties").freeformAttrs} but is re-derived here against
 * the schema so this module owns one notion of "which attrs are freeform".
 */
function freeformNames(node: GuiNode): string[] {
  const known = new Set(fieldsForTag(node.tag).map((f) => f.name));
  // `id` is special for every tag that has one; `src` is special on Component.
  // (We keep this in lockstep with guiProperties.specialAttrs — both exclude the
  // same set so a known/special attr never leaks into the freeform rows.)
  const special = new Set<string>(node.tag === "Event" ? [] : ["id"]);
  if (node.tag === "Component") special.add("src");
  return Object.keys(node.attrs).filter((name) => !known.has(name) && !special.has(name));
}

/**
 * Derive a fresh local-row list from a node's freeform attrs, minting a new
 * stable id per row. Used for the FIRST sync of a newly-selected node (no prior
 * rows to preserve ids from); subsequent external changes go through
 * {@link reconcileRows}, which keeps existing ids so focus survives.
 */
export function deriveRows(node: GuiNode): OverrideRow[] {
  return freeformNames(node).map((name) => ({
    id: mintRowId(),
    name,
    value: node.attrs[name] ?? "",
  }));
}

/**
 * Reconcile the local rows against the node's CURRENT freeform attrs, preserving
 * row ids wherever the name still matches so the input does not remount.
 *
 * This is the resync path for EXTERNAL changes to `attrs` (undo/redo, another
 * panel, a file reload) — NOT for the user's own keystrokes (those stay purely
 * local until commit). The rule:
 *  - For each current freeform attr (in authored order), reuse an existing row
 *    with the same `name` (keeping its id) if one exists; otherwise mint a row.
 *  - Blank-named rows in `prev` (an in-progress "Add property" with no name yet)
 *    are CARRIED THROUGH at the end — they have no attr to match but represent a
 *    row the user is still filling in, so dropping them would yank the add row out
 *    from under them.
 *  - Rows whose name no longer matches any current attr (e.g. the attr was
 *    removed externally) are dropped.
 *
 * When the rows already mirror the attrs (the common case — our own commit just
 * wrote them), the returned list is identity-equal in content, so callers can
 * skip a state update.
 */
export function reconcileRows(prev: readonly OverrideRow[], node: GuiNode): OverrideRow[] {
  const names = freeformNames(node);
  // Index existing non-blank rows by name (first wins) so we can reuse ids.
  const byName = new Map<string, OverrideRow>();
  for (const row of prev) {
    if (row.name !== "" && !byName.has(row.name)) byName.set(row.name, row);
  }
  const next: OverrideRow[] = names.map((name) => {
    const existing = byName.get(name);
    const value = node.attrs[name] ?? "";
    if (existing) return existing.value === value ? existing : { ...existing, value };
    return { id: mintRowId(), name, value };
  });
  // Carry through in-progress blank-named rows (the "Add property" affordance).
  for (const row of prev) {
    if (row.name === "") next.push(row);
  }
  return next;
}

/**
 * Whether two row lists are equal in content (id + name + value, in order). Lets
 * the panel skip a redundant state update when {@link reconcileRows} produced a
 * list equivalent to what it already holds.
 */
export function rowsEqual(a: readonly OverrideRow[], b: readonly OverrideRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.name !== y.name || x.value !== y.value) return false;
  }
  return true;
}

/**
 * Rebuild a node's attrs map from the current local rows, to COMMIT an edit.
 * Preserves every non-freeform attr (schema fields, `id`, `src`) in its authored
 * position, and replaces the freeform region with the rows — IN ROW ORDER.
 *
 * Rules that make typing safe (task 486):
 *  - A blank-NAMED row is skipped: it's an in-progress "Add property" with no
 *    attribute name yet, so it contributes nothing to the serialized attrs.
 *  - An empty VALUE is preserved as `name=""` (NOT dropped): clearing a value
 *    field must not delete the property — only the explicit remove button does.
 *  - A duplicate name (two rows renamed to the same key) keeps the LAST row's
 *    value, matching how a single attrs map can hold one value per key. The panel
 *    surfaces the collision visually; this stays a deterministic merge.
 *
 * Non-freeform attrs are emitted in their original authored order first-seen,
 * then any freeform rows that don't correspond to a pre-existing key append in
 * row order — so a freshly-added override lands at the end, and a renamed
 * existing override moves to wherever its row sits relative to the others.
 */
export function rowsToAttrs(node: GuiNode, rows: readonly OverrideRow[]): Record<string, string> {
  const freeform = new Set(freeformNames(node));
  const next: Record<string, string> = {};
  // 1. Keep all non-freeform attrs (schema/id/src) in authored order. These are
  //    the PROTECTED keys — a row renamed onto one must not clobber it.
  const protectedNames = new Set<string>();
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!freeform.has(name)) {
      next[name] = value;
      protectedNames.add(name);
    }
  }
  // 2. Append freeform rows in row order. Blank names skipped; empty values kept.
  for (const row of rows) {
    const name = row.name.trim();
    if (name === "") continue;
    // Never clobber a protected (schema/id/src) key — a row renamed to e.g.
    // `position` is ignored rather than overwriting the typed field (the panel
    // disallows it visually; this guards the data). A duplicate OVERRIDE name
    // across rows is allowed and the later row wins (one value per key).
    if (protectedNames.has(name)) continue;
    next[name] = row.value;
  }
  return next;
}
