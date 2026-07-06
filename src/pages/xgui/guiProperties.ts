/**
 * guiProperties — the pure, unit-testable core behind the structure column's
 * PROPERTIES slice (F9b): the computed hierarchical-id derivation, the
 * four-field ↔ comma-string transform for `position`/`size`, literal-vs-token
 * detection, and the per-tag field schema the panel renders. No React, no IO —
 * the {@link PropertiesPanel} reads and dispatches off these.
 *
 * WHY a pure module: the panel's tricky bits are all data transforms — deriving
 * `view.stats.statText` from the parent chain, splitting `relX,relY,absX,absY`
 * into four editable fields and re-joining verbatim, and knowing which props an
 * element exposes. Keeping them here lets each be unit-tested without mounting a
 * component, mirroring `guiTreeEdit.ts`.
 *
 * @see design/xgui_ta.md — "Structure column" (Properties slice), "Data binding"
 *   (per-field tokens, literal-vs-binding), "Colors and the palette".
 */

import { isWholeToken, parseScopeRef } from "../../lib/guiBinding";
import type { GuiNode, GuiTag } from "../../lib/guiNode";

// ---------------------------------------------------------------------------
// Computed hierarchical id
// ---------------------------------------------------------------------------

/**
 * Derive the READ-ONLY computed hierarchical id for the node at the end of
 * `path` (root → … → target, as {@link nodePath} returns). The design's
 * reference path (`view.stats.statText`) is the dot-joined chain of authored
 * `id` attrs from the root down to the node.
 *
 * Rules:
 *  - Each ancestor (and the node itself) contributes its authored `id` attr,
 *    trimmed. The root `<View>` typically authors `id="view"`, so the chain
 *    reads `view.stats.statText`.
 *  - A node with NO `id` (or a blank one) contributes nothing — it is skipped,
 *    so an unnamed wrapper Panel doesn't inject an empty `..` segment. This
 *    matches the runtime, where only id'd elements are addressable.
 *  - An empty path (or one where no node has an id) yields `""` — the panel
 *    shows a "—" placeholder for an as-yet-unnamed element.
 */
export function computedId(path: readonly GuiNode[]): string {
  const segments: string[] = [];
  for (const node of path) {
    const id = node.attrs.id?.trim();
    if (id) segments.push(id);
  }
  return segments.join(".");
}

// ---------------------------------------------------------------------------
// Four-field ↔ comma-string transform (position / size)
// ---------------------------------------------------------------------------

/** The four labeled fields a `position`/`size` value splits into, in order. */
export type CompoundFields = {
  /** relX — scale-x: a fraction of the parent width (or a `{token}`). */
  scaleX: string;
  /** relY — scale-y: a fraction of the parent height (or a `{token}`). */
  scaleY: string;
  /** absX — offset-x: a pixel offset (or a `{token}`). */
  offsetX: string;
  /** absY — offset-y: a pixel offset (or a `{token}`). */
  offsetY: string;
};

/** The display label for each compound field, in serialized order. */
export const COMPOUND_FIELD_LABELS: ReadonlyArray<{ key: keyof CompoundFields; label: string }> = [
  { key: "scaleX", label: "Relative X" },
  { key: "scaleY", label: "Relative Y" },
  { key: "offsetX", label: "Absolute X" },
  { key: "offsetY", label: "Absolute Y" },
];

/**
 * Split a raw `relX,relY,absX,absY` string into its four editable fields,
 * VERBATIM — each field keeps exactly what was authored (a literal `0.5` or a
 * `{healthRatio}` token), so the panel round-trips bindings untouched. Missing
 * fields (a short or empty value) become empty strings rather than throwing, so
 * a half-authored value still edits.
 */
export function parseCompound(raw: string | undefined): CompoundFields {
  const parts = (raw ?? "").split(",");
  return {
    scaleX: (parts[0] ?? "").trim(),
    scaleY: (parts[1] ?? "").trim(),
    offsetX: (parts[2] ?? "").trim(),
    offsetY: (parts[3] ?? "").trim(),
  };
}

/**
 * Re-join the four fields into the serialized `relX,relY,absX,absY` comma form
 * the attrs store (and the XML) keep. A blank field serializes as `0` so the
 * value always has four well-formed segments — the geometry parser and the
 * runtime both expect four — while a `{token}` field is written through
 * verbatim so the binding survives the round-trip.
 */
export function formatCompound(fields: CompoundFields): string {
  const norm = (v: string) => {
    const t = v.trim();
    return t === "" ? "0" : t;
  };
  return [
    norm(fields.scaleX),
    norm(fields.scaleY),
    norm(fields.offsetX),
    norm(fields.offsetY),
  ].join(",");
}

/**
 * Whether a single field value is a `{token}` binding (the whole field is a
 * brace-wrapped token) versus a literal number. The panel styles a bound field
 * distinctly. Delegates to the render-time {@link isWholeToken} so the editor's
 * "is this bound" test is the SAME predicate the preview resolves against —
 * there is one definition of "bound".
 */
export function isBoundField(value: string): boolean {
  return isWholeToken(value);
}

/**
 * Whether a node of `tag` shows id rows in the Properties panel — i.e. whether the
 * panel should render the computed read-only id + the editable local id.
 *
 * `<Panel>`/`<Text>`/`<Component>` do. `<Event>` does NOT (task 471 — events are
 * addressed by `name`/`handler`, not a hierarchical id). `<GridLayout>` does NOT
 * either: it is a non-visual control element with no `id` and cannot be referenced
 * by Lua (the design's req 2) — keeping it id-less also keeps the missing-id
 * TriangleAlert from firing on it in the tree. The root `<View>` does NOT either:
 * it is the component itself, its `id` is auto-set on create, and the panel shows
 * it no editable properties at all (its `controller` is wired via the Controller
 * tab). Each still carries its `id` on the node where it has one — it's just not
 * edited here, and {@link computedId} still reads it to prefix descendants.
 */
export function nodeHasId(tag: GuiTag): boolean {
  return tag !== "Event" && tag !== "View" && tag !== "GridLayout";
}

// ---------------------------------------------------------------------------
// Per-tag field schema
// ---------------------------------------------------------------------------

/** How the Properties panel should render a given attribute. */
export type FieldKind =
  /** A plain text/number input that also accepts a `{token}`. */
  | "text"
  /**
   * A whole-value BINDING expression (`data`/`dataCollection`/`tooltipData`). The
   * field EDITS the inner model path (the author types `creatures` or `$.creatures`)
   * while the STORED attr is normalized to the grammar's whole-value token form
   * (`{$.creatures}`) — the only form the strict resolver + scaffold accept (a bare
   * key resolves to nothing). Committed on BLUR/Enter, not per keystroke: every
   * prefix of a path is itself a valid path, so a per-keystroke commit would spam the
   * additive scaffold with a throwaway model entry for each character. See
   * {@link normalizeBinding} / {@link bindingDisplayValue}.
   */
  | "binding"
  /** A `position`/`size` value rendered as four labeled inputs. */
  | "compound"
  /** A color value: palette swatch picker + custom code + `{token}`. */
  | "color"
  /** A sprite name chosen via the sprite selector (also accepts a `{token}`). */
  | "sprite"
  /** A boolean-ish value (true/false) that also accepts a `{token}`. */
  | "boolean"
  /**
   * An interaction HANDLER name (`onMouseClicked`, `onFocus`, …): a LITERAL-only
   * string naming a controller function — NO `{token}` affordance (binding a handler
   * would change WHICH function fires, not how the element looks; a `{}` here is a
   * lint, not a binding). Rendered as a dropdown of the open component's controller
   * function names ({@link import("./controllerScript").exportedFunctionNames}) that
   * still allows free typing (hot reload may add the function later), with a
   * soft-warning state for an unknown name (#504).
   */
  | "handler"
  /**
   * A COMPONENT reference (the `tooltip` attr): a component chosen via the shared
   * {@link import("./ComponentPicker").ComponentPicker}. Literal-only (structural).
   * The stored value is the canonical `.xml`-suffixed ref the engine resolves on
   * (`tooltip="gui.kittypacks-tooltip.xml"`), exactly what the picker emits (#504).
   */
  | "componentRef";

/** One field in the per-tag schema. */
export type PropertyField = {
  /** The attribute name written into `attrs`. */
  name: string;
  /** Human label shown beside the input. */
  label: string;
  /** How to render the field. */
  kind: FieldKind;
  /**
   * Optional grouping key. Fields with no `group` (the default) render inline as
   * before; fields sharing a `group` render together under a collapsible section
   * (e.g. {@link INTERACTION_GROUP}). The group HEADER/collapse UI is the panel's
   * concern (#504) — the schema only tags the membership.
   */
  group?: string;
  /**
   * When set, the field NEVER offers a `{token}` affordance — it is a plain
   * literal. Used for `modal`: the engine reads it via `as_bool` PRE-binding, so a
   * `{token}` there is a lint, not a binding (#504). A generic flag rather than
   * name-matching, so any future literal-only boolean opts in the same way.
   */
  literalOnly?: boolean;
};

/**
 * The group key for the mouse/keyboard/tooltip interaction fields. The panel renders
 * these under a collapsible "Interaction" section (#504); the schema just tags them.
 */
export const INTERACTION_GROUP = "Interaction";

/**
 * The shared interaction-attribute schema appended to `<Panel>`, `<Text>`, and
 * `<Component>` (the hit-testable widgets). Mirrors the engine's parsed interaction
 * surface (worlds-cpp@xgui `GUILoader.cpp`/`XGUI.cpp`; ground truth
 * `gui.kittypacks.xml`):
 *
 *  - the seven input HANDLERS — literal-only controller-function names (a `{token}`
 *    in one is a lint, not a binding);
 *  - `modal` — a plain boolean hit policy. The engine reads it via `as_bool`
 *    PRE-binding, so a `{token}` here never resolves (a lint); the panel drops the
 *    token affordance for it in #504. Kept `boolean` at the schema layer.
 *  - `tooltip` — a `<Component>` basename (a `.xml` ref), chosen via the picker;
 *  - `tooltipData` — the whole-value BINDING seeding the tooltip's model
 *    (`tooltipData="{$.creature}"`), same value-boundary semantics as `data=`.
 */
const INTERACTION_FIELDS: readonly PropertyField[] = [
  { name: "onMouseClicked", label: "onMouseClicked", kind: "handler", group: INTERACTION_GROUP },
  { name: "onMouseEntered", label: "onMouseEntered", kind: "handler", group: INTERACTION_GROUP },
  { name: "onMouseExited", label: "onMouseExited", kind: "handler", group: INTERACTION_GROUP },
  { name: "onMouseMoved", label: "onMouseMoved", kind: "handler", group: INTERACTION_GROUP },
  { name: "onKeyPressed", label: "onKeyPressed", kind: "handler", group: INTERACTION_GROUP },
  { name: "onFocus", label: "onFocus", kind: "handler", group: INTERACTION_GROUP },
  { name: "onBlur", label: "onBlur", kind: "handler", group: INTERACTION_GROUP },
  { name: "modal", label: "modal", kind: "boolean", group: INTERACTION_GROUP, literalOnly: true },
  { name: "tooltip", label: "tooltip", kind: "componentRef", group: INTERACTION_GROUP },
  { name: "tooltipData", label: "tooltipData", kind: "binding", group: INTERACTION_GROUP },
];

// ---------------------------------------------------------------------------
// Binding normalization (data / dataCollection / tooltipData)
// ---------------------------------------------------------------------------

/**
 * Normalize a user-typed model PATH into the whole-value `{token}` the strict binding
 * grammar accepts — the STORED form for a `binding` field (`data`/`dataCollection`/
 * `tooltipData`). The resolver (`resolveWholeTokenValue`) and scaffold (`tokenTarget`)
 * both reject a bare key, so the panel must never store one:
 *
 *   - `""`            → `""`            (clearing removes the attr)
 *   - `creatures`     → `{$.creatures}` (a bare key defaults to the View/local scope)
 *   - `creature.name` → `{$.creature.name}`
 *   - `$.creatures`   → `{$.creatures}` (an explicit `$.`/`$name.` prefix is wrapped)
 *   - `.`             → `{.}`           (the grid-item whole-object shorthand)
 *   - `{$.x}` / `{.}` / `{$.}` / any hand-typed `{…}` → VERBATIM (the author already
 *     wrote grammar — including the whole-object forms and grid-item/named scopes)
 *
 * Uses the shared token predicate so "is this already a token" is the SAME test the
 * resolver applies.
 */
export function normalizeBinding(input: string): string {
  const t = input.trim();
  if (t === "") return "";
  // A hand-typed whole token (incl. `{$.}` / `{.}` whole-object and `{$name.x}`) →
  // verbatim: the author already wrote grammar.
  if (isWholeToken(t)) return t;
  // The grid-item whole-object shorthand typed unbraced.
  if (t === ".") return "{.}";
  // An explicit scope prefix (`$.foo`, `$app.bar`) is wrapped verbatim; a bare key
  // (`foo`, `foo.bar`) defaults to the View/local scope (`$.foo`).
  if (t.startsWith("$")) return `{${t}}`;
  return `{$.${t}}`;
}

/**
 * The value a `binding` field SHOWS for a stored attr — the inverse of
 * {@link normalizeBinding} for the common case. A simple View-scope path
 * (`{$.creature}` / `{$.a.b}`) displays its inner dotted path (`creature` / `a.b`), so
 * the field reads as "edit the path" and round-trips through `normalizeBinding`. Every
 * OTHER form shows VERBATIM so the author edits exactly what is stored: a whole-object
 * `{$.}` / `{.}`, a bare grid-item `{sprite}`, a named `{$app.x}`, or a non-token
 * literal (e.g. a legacy bare `creatures` — shown as-is until re-committed).
 *
 * Classifies the token through the shared {@link parseScopeRef}, so display and the
 * resolver read the grammar the same way.
 */
export function bindingDisplayValue(stored: string): string {
  const t = stored.trim();
  if (!isWholeToken(t)) return stored;
  const ref = parseScopeRef(t.slice(1, -1));
  if (ref.frame === "view" && ref.path.length > 0) return ref.path.join(".");
  return stored;
}

/**
 * The ordered list of well-known property fields a node of the given tag
 * exposes, BEYOND the always-present `id` (which the panel renders specially as
 * the computed read-only id + the editable local id). `src` on `<Component>` is
 * also handled specially (read-only basename + picker), so it is excluded here.
 *
 * These are the design's documented properties per element. Any attribute the
 * node carries that is NOT in this schema is still editable as a freeform
 * override row (see {@link freeformAttrs}) — this list just gives the common
 * ones first-class, labeled, correctly-typed inputs.
 *
 * `parentTag` lets a child suppress fields its parent OWNS. A child of a
 * `<GridLayout>` does not own its own `position`/`size` — the grid lays its
 * repeated child out (the design's req 4) — so those two rows are filtered out
 * for any node whose parent is a GridLayout. (The {@link makeChildNode} factory
 * also omits the default geometry when inserting under a grid, so a grid child
 * carries no `position`/`size` attr to begin with.)
 */
export function fieldsForTag(tag: GuiTag, parentTag?: GuiTag): PropertyField[] {
  const fields = fieldsForTagInner(tag);
  if (parentTag === "GridLayout") {
    return fields.filter((f) => f.name !== "position" && f.name !== "size");
  }
  return fields;
}

function fieldsForTagInner(tag: GuiTag): PropertyField[] {
  switch (tag) {
    case "View":
      // `scopeName` publishes the View's frame under a name so descendants (and
      // sibling components) can reach it via `{$name.x}` — the engine parses it on
      // the root <View> (worlds-cpp GUILoader.cpp:154). It is a plain literal,
      // stored verbatim, and is the FIRST panel field the View row shows (the B1
      // interaction schema extends this with onKeyPressed later). The View's `id`
      // (auto-set on create) and `controller` (wired via the Controller tab) are
      // still handled elsewhere and stay preserved-only (see specialAttrs).
      // scopeName (a plain literal) is the FIRST field; the View is ALSO a real
      // onKeyPressed target (the engine dispatches unfocused key events to Root —
      // XGUI.cpp:138), so it gains an Interaction group carrying that ONE handler.
      // id (auto-set) and controller (Controller tab) stay handled elsewhere.
      return [
        { name: "scopeName", label: "scopeName", kind: "text" },
        { name: "onKeyPressed", label: "onKeyPressed", kind: "handler", group: INTERACTION_GROUP },
      ];
    case "Panel":
      return [
        { name: "position", label: "position", kind: "compound" },
        { name: "size", label: "size", kind: "compound" },
        { name: "texture", label: "texture", kind: "sprite" },
        { name: "backgroundColor", label: "Background Color", kind: "color" },
        { name: "borderColor", label: "Border Color", kind: "color" },
        { name: "borderSize", label: "Border Size", kind: "text" },
        { name: "visible", label: "Visible", kind: "boolean" },
        { name: "layer", label: "Layer", kind: "text" },
        ...INTERACTION_FIELDS,
      ];
    case "Text":
      return [
        { name: "position", label: "position", kind: "compound" },
        { name: "size", label: "size", kind: "compound" },
        { name: "text", label: "text", kind: "text" },
        { name: "color", label: "Text Color", kind: "color" },
        { name: "textAlign", label: "Text Align", kind: "text" },
        { name: "fontSize", label: "Font Size", kind: "text" },
        { name: "visible", label: "Visible", kind: "boolean" },
        { name: "layer", label: "Layer", kind: "text" },
        ...INTERACTION_FIELDS,
      ];
    case "Component":
      // `src` and `id` are handled specially by the panel; the rest of the
      // documented <Component> props plus freeform overrides cover the body.
      // `data` seats the mounted child's root model — a whole-value binding (its
      // stored form is the grammar token, NOT a bare key; see `binding`). `layer`
      // is exposed (like Panel/Text) so a Component's z-order among its siblings is
      // editable — a Component renders as a leaf in the parent tree, so the global
      // F5b z-order already applies its layer (task 486).
      return [
        { name: "data", label: "data", kind: "binding" },
        { name: "position", label: "position", kind: "compound" },
        { name: "size", label: "size", kind: "compound" },
        { name: "visible", label: "visible", kind: "boolean" },
        { name: "layer", label: "layer", kind: "text" },
        ...INTERACTION_FIELDS,
      ];
    case "Event":
      // The `handler` names a controller function (fired with the event payload at
      // call time), so it gets the SAME controller-function dropdown as the element
      // interaction handlers (#504) — a literal-only name, warn-on-unknown. `name` is
      // the event key the runtime dispatches on, a plain literal.
      return [
        { name: "name", label: "name", kind: "text" },
        { name: "handler", label: "handler", kind: "handler" },
      ];
    case "GridLayout":
      // A non-visual control element: no id, no position/size of its OWN (the grid
      // fills its parent). `dataCollection` is a whole-value BINDING
      // (`dataCollection="{$.creatures}"`) — the field edits the path and stores the
      // grammar token (a bare key is unresolvable under the strict grammar).
      // rows/columns/gutter/cellSize are `literalOnly` LITERALS: grid structure is
      // stamped once at load, OUTSIDE the runtime binding system, so a `{token}` in any
      // of them can never resolve (it is an ERROR lint). `cellSize` is a full UDim2
      // `"relX,relY,absX,absY"` — the system's ONE dimension grammar, edited through the
      // same four-input `compound` UI as `position`/`size` (literalOnly suppresses the
      // per-field token affordance) — that fixes each cell's size; absent/blank, the grid
      // divides its parent's content box evenly. Only `dataCollection` is grammar (a scope
      // path resolved at stamp time). All of this is layout policy on the one element that
      // IS the layout (design req 5 + design/gridlayout_cell_geometry.md, "Grid structure
      // is LITERAL-ONLY").
      return [
        { name: "dataCollection", label: "dataCollection", kind: "binding" },
        { name: "rows", label: "rows", kind: "text", literalOnly: true },
        { name: "columns", label: "columns", kind: "text", literalOnly: true },
        { name: "gutter", label: "gutter", kind: "text", literalOnly: true },
        { name: "cellSize", label: "cellSize", kind: "compound", literalOnly: true },
      ];
    default: {
      const _never: never = tag;
      return _never;
    }
  }
}

/**
 * The interaction HANDLER fields a node of `tag` exposes — the mouse/key/focus
 * handlers grouped under {@link INTERACTION_GROUP} in the per-tag schema. Derived
 * FROM the schema (not a re-listed set of attr names) so the structure tree's
 * "Add handler" menu and the Properties panel never drift: whatever handlers a tag
 * shows in the panel are exactly the ones the menu offers. Excludes the `<Event>`
 * `handler` (it is ungrouped — the event's own handler, not an interaction attr),
 * so `<Event>`/`<GridLayout>` return an empty list.
 */
export function interactionHandlerFields(tag: GuiTag): PropertyField[] {
  return fieldsForTag(tag).filter((f) => f.kind === "handler" && f.group === INTERACTION_GROUP);
}

/**
 * The attribute names a node of `tag` handles SPECIALLY (rendered outside the
 * schema-driven field list): always `id`; plus `src` on `<Component>`. Used to
 * compute {@link freeformAttrs} — anything not in the schema and not special is
 * a freeform override.
 */
function specialAttrs(tag: GuiTag): Set<string> {
  // `id` is special only for tags that HAVE an id row (475): an `<Event>` shows no
  // id rows, so a stray `id` attr on one should surface as a freeform row rather
  // than vanish.
  const special = new Set<string>(nodeHasId(tag) ? ["id"] : []);
  if (tag === "Component") {
    special.add("src");
    // NB: `data` is now a first-class schema field (kind `binding`), so it is already
    // excluded from freeform via the known-field set — it no longer needs to be listed
    // special here. The interaction attrs (handlers/modal/tooltip/tooltipData) are
    // schema fields too, so they likewise stay out of the freeform rows automatically.
  }
  if (tag === "View") {
    // The View shows no fields at all, but its structural attrs are managed
    // elsewhere (id auto-set on create; controller via the Controller tab). Mark
    // them special so they are PRESERVED on the node rather than leaking into the
    // freeform "other properties" rows.
    special.add("id");
    special.add("controller");
  }
  return special;
}

/**
 * The freeform override attribute names on a node: attributes it carries that
 * are neither in the well-known schema for its tag nor handled specially. These
 * render as editable name→value rows so a `<Component>`'s arbitrary override
 * props (per the design — "other properties … translate to overrides") and any
 * unrecognized attribute remain editable rather than hidden.
 *
 * Returned in authored order (the `attrs` insertion order) so the panel is
 * stable and matches the XML.
 */
export function freeformAttrs(node: GuiNode): string[] {
  const known = new Set(fieldsForTag(node.tag).map((f) => f.name));
  const special = specialAttrs(node.tag);
  return Object.keys(node.attrs).filter((name) => !known.has(name) && !special.has(name));
}

/**
 * The basename shown read-only for a `<Component>`'s `src` (the attr stores the
 * bare basename already; this just trims any path/extension defensively so the
 * panel shows a clean name even if an authored value carried a folder or `.xml`).
 */
export function srcBasename(src: string | undefined): string {
  if (!src) return "";
  const noPath = src.split("/").pop() ?? src;
  return noPath.replace(/\.xml$/i, "");
}

// ---------------------------------------------------------------------------
// Attr write helpers (immutable, for the panel's dispatch)
// ---------------------------------------------------------------------------

/**
 * Return a NEW attrs map with `name` set to `value`. An empty `value` REMOVES
 * the attribute (so clearing a field doesn't churn the XML with `attr=""`),
 * EXCEPT for attributes that are structurally required to exist — which the
 * panel decides; this helper is the generic "set or clear" primitive. The
 * authored key ORDER is preserved (a re-set keeps its slot; a new key appends).
 */
export function withAttr(
  attrs: Readonly<Record<string, string>>,
  name: string,
  value: string,
): Record<string, string> {
  const next: Record<string, string> = { ...attrs };
  if (value === "") {
    delete next[name];
  } else {
    next[name] = value;
  }
  return next;
}

/**
 * Rename a freeform override key from `oldName` to `newName`, preserving its
 * value and its POSITION in the authored order (so renaming an override row
 * doesn't reshuffle the XML). A blank `newName`, or one that collides with an
 * existing different key, leaves the map unchanged (the panel surfaces the
 * collision; this stays a pure no-op rather than clobbering).
 */
export function renameAttr(
  attrs: Readonly<Record<string, string>>,
  oldName: string,
  newName: string,
): Record<string, string> {
  const trimmed = newName.trim();
  if (trimmed === "" || trimmed === oldName) return { ...attrs };
  if (trimmed in attrs) return { ...attrs }; // collision → no-op
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    next[k === oldName ? trimmed : k] = v;
  }
  return next;
}

/** Remove an attribute entirely, returning a new map. */
export function removeAttr(
  attrs: Readonly<Record<string, string>>,
  name: string,
): Record<string, string> {
  const next = { ...attrs };
  delete next[name];
  return next;
}
