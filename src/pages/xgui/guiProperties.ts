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

import { isWholeToken } from "../../lib/guiBinding";
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
 * addressed by `name`/`handler`, not a hierarchical id). The root `<View>` does NOT
 * either: it is the component itself, its `id` is auto-set on create, and the panel
 * shows it no editable properties at all (its `controller` is wired via the
 * Controller tab). Both still carry their `id` on the node — it's just not edited
 * here, and {@link computedId} still reads it to prefix descendants.
 */
export function nodeHasId(tag: GuiTag): boolean {
  return tag !== "Event" && tag !== "View";
}

// ---------------------------------------------------------------------------
// Per-tag field schema
// ---------------------------------------------------------------------------

/** How the Properties panel should render a given attribute. */
export type FieldKind =
  /** A plain text/number input that also accepts a `{token}`. */
  | "text"
  /** A `position`/`size` value rendered as four labeled inputs. */
  | "compound"
  /** A color value: palette swatch picker + custom code + `{token}`. */
  | "color"
  /** A sprite name chosen via the sprite selector (also accepts a `{token}`). */
  | "sprite"
  /** A boolean-ish value (true/false) that also accepts a `{token}`. */
  | "boolean";

/** One field in the per-tag schema. */
export type PropertyField = {
  /** The attribute name written into `attrs`. */
  name: string;
  /** Human label shown beside the input. */
  label: string;
  /** How to render the field. */
  kind: FieldKind;
};

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
 */
export function fieldsForTag(tag: GuiTag): PropertyField[] {
  switch (tag) {
    case "View":
      // The root View has NO editable properties in the panel. Its `id` is
      // auto-set on create, and its `controller` is wired through the Controller
      // tab's "Add script" flow — neither belongs here. Both attrs are preserved
      // on the node (see specialAttrs) so they don't surface as freeform rows.
      return [];
    case "Panel":
      return [
        { name: "position", label: "position", kind: "compound" },
        { name: "size", label: "size", kind: "compound" },
        { name: "texture", label: "texture", kind: "sprite" },
        { name: "backgroundColor", label: "backgroundColor", kind: "color" },
        { name: "borderColor", label: "borderColor", kind: "color" },
        { name: "borderSize", label: "borderSize", kind: "text" },
        { name: "visible", label: "visible", kind: "boolean" },
        { name: "layer", label: "layer", kind: "text" },
      ];
    case "Text":
      return [
        { name: "position", label: "position", kind: "compound" },
        { name: "size", label: "size", kind: "compound" },
        { name: "text", label: "text", kind: "text" },
        { name: "textColor", label: "Text Color", kind: "color" },
        { name: "textAlign", label: "Text Align", kind: "text" },
        { name: "fontSize", label: "Font Size", kind: "text" },
        { name: "visible", label: "Visible?", kind: "boolean" },
        { name: "layer", label: "Layer", kind: "text" },
      ];
    case "Component":
      // `src` and `id` are handled specially by the panel; the rest of the
      // documented <Component> props plus freeform overrides cover the body.
      // `layer` is exposed (like Panel/Text) so a Component's z-order among its
      // siblings is editable — a Component renders as a leaf in the parent tree,
      // so the global F5b z-order already applies its layer (task 486).
      return [
        { name: "position", label: "position", kind: "compound" },
        { name: "size", label: "size", kind: "compound" },
        { name: "visible", label: "visible", kind: "boolean" },
        { name: "layer", label: "layer", kind: "text" },
      ];
    case "Event":
      return [
        { name: "name", label: "name", kind: "text" },
        { name: "handler", label: "handler", kind: "text" },
      ];
    default: {
      const _never: never = tag;
      return _never;
    }
  }
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
  if (tag === "Component") special.add("src");
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
