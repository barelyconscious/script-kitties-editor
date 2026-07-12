/**
 * guiModelScaffold — auto-build the Data Model JSON from a component's `{token}`
 * references (task 482), ADDITIVE.
 *
 * The Data Model panel is a per-session scratch input the preview resolves
 * bindings against. Rather than make the user hand-author it from scratch, this
 * module walks the open {@link GuiNode} tree, collects every `{token}` reference,
 * and produces a JSON value that gives every referenced token a sensible
 * placeholder — so opening a component pre-fills a model whose every binding
 * resolves, and adding a new token grows the model without touching what the user
 * already edited.
 *
 * Tokens obey the XGUI binding GRAMMAR (the same authoritative table the resolver
 * in `guiBinding.ts` binds against — this module is its SECOND consumer). Three
 * scopes, each with a dotted field-access and a whole-object form:
 *
 *   - **View / local** — `$.` prefix. `{$.creature.sprite}` builds NESTED objects in
 *     the model (`{ creature: { sprite: … } }`); `{$.}` is the whole model (a
 *     pass-through — contributes NO field). Valid anywhere.
 *   - **Grid item** — bare (no prefix). `{sprite}` describes a field of the CURRENT
 *     GridLayout item; `{.}` is the whole item (no field). A bare token OUTSIDE a
 *     grid child contributes NOTHING (STRICT engine parity — bare demotes to
 *     grid-only), so it no longer invents a root key.
 *   - **Named** — `$name.` prefix. Recognized but DEFERRED (zero shipped usage): a
 *     `{$app.theme}` token fabricates NO field.
 *
 * A `<GridLayout dataCollection="{$.creatures}">` introduces a ROOT collection: key
 * `creatures` is an ARRAY whose item objects carry the grid's child template's bare
 * item-scope tokens (item shape). Inside a grid child BOTH frames are live — bare
 * `{sprite}` lands in the item, `{$.x}` still lands in the View root. A nested grid's
 * bare `dataCollection="{creatures}"` names an ARRAY-valued field of the enclosing
 * ITEM (item frame), so collections can also live one level down.
 *
 * THREE pure stages, each independently testable:
 *
 *   1. EXTRACT (`extractShape`) — walk the tree into a {@link ModelShape}: scalar
 *      field names, NESTED own-object shapes (from `$.` dotted paths), nested-
 *      `<Component data>` object shapes, and grid collection item shapes. Tokens are
 *      read from the same attribute kinds the resolver binds: `text`/`texture`
 *      (interpolation — every embedded `{name}`), whole-value typed props (colors,
 *      `visible`, `fontSize`, `borderSize`, `textAlign`, `layer`), and each of the
 *      four `position`/`size` fields — every token classified through the shared
 *      grammar via {@link parseScopeRef}.
 *
 *   2. BUILD (`buildModel`) — turn a shape into a JSON value: each scalar field →
 *      a string equal to the token NAME (no braces), e.g. `{$.health}` →
 *      `"health": "health"`; each nested own-object → an object built recursively;
 *      each `<Component data>` object → an object built from the referenced child
 *      component's own shape; each collection → a one-element sample array.
 *
 *   3. MERGE (`mergeModel`) — additively fold a freshly-built scaffold into the
 *      user's CURRENT model: add missing root keys (recursing into plain objects so
 *      nested own-objects grow additively); NEVER overwrite an existing value, NEVER
 *      delete a scalar/array leftover, and leave a key alone when its existing type
 *      conflicts with the scaffold.
 *
 * The wiring (`scaffoldModelText`) composes all three over raw text: it returns a
 * new text ONLY when the merge added something, so a no-op change never reformats
 * the user's JSON.
 *
 * This module is PURE (no React, no DOM). It reuses the grammar classifier
 * ({@link parseScopeRef}) and token-detection helpers in `guiBinding.ts` rather than
 * re-deriving prefix parsing with local regexes.
 *
 * @see design/xgui_ta_view_scope_addendum.md — the scope grammar (normative).
 * @see design/xgui_ta.md — "Data binding".
 */

import { parseScopeRef } from "../../lib/guiBinding";
import { DATA_ATTR, SRC_ATTR, srcBasename } from "../../lib/guiComponentMount";
import type { GuiNode } from "../../lib/guiNode";

/**
 * Resolve a `<Component src="x">` basename to its parsed tree, or `undefined` when
 * it can't be found. Injected into extraction so a `<Component … data="k">` can
 * fold the CHILD component's own token shape into the parent model under `k`
 * (auto-population "from the component"). Kept as a parameter so this module stays
 * PURE — the impure "load every component" registry lives in the React layer and
 * passes a snapshot in.
 */
export type ComponentResolver = (basename: string) => GuiNode | undefined;

/**
 * A model shape: the scalar field names bound, plus the nested-component data
 * objects injected (recursive). The ROOT shape describes the top-level model.
 *
 * Mutable during extraction (the walker accretes into it); callers treat the
 * result as read-only.
 */
export type ModelShape = {
  /** Leaf scalar field names bound in this shape (no braces). */
  scalars: Set<string>;
  /**
   * `field` → the OWN-OBJECT shape a dotted `$.` path implies. `{$.creature.sprite}`
   * records `creature` here holding scalar `sprite`, so the model gets
   * `creature: { sprite: … }`. These are the component's OWN nested model fields
   * (NOT a `<Component data>` mirror): they merge ADDITIVELY and their user-added
   * inner fields are never pruned while the token exists (see {@link reconcileObject}).
   */
  nested: Map<string, ModelShape>;
  /**
   * `dataKey` → the OBJECT shape a nested `<Component … data="{$.dataKey}">` injects.
   * The shape is the referenced child component's own scaffolded shape, so the
   * parent model gets `dataKey: { …child fields… }` auto-populated from the
   * component. Unlike {@link nested}, a data object MIRRORS its component — it is
   * prune-synced to the child shape (stale keys dropped).
   */
  objects: Map<string, ModelShape>;
  /**
   * `collectionKey` → the ITEM shape a `<GridLayout dataCollection="{$.collectionKey}">`
   * implies. The shape is the grid's single child TEMPLATE subtree's item-scope tokens,
   * so the model gets `collectionKey: [{ …item fields… }]` — a one-element sample array
   * auto-populated from the template. Usually lives in the ROOT shape; a NESTED grid's
   * bare `dataCollection="{collectionKey}"` (item frame) seats a collection in the
   * enclosing ITEM shape instead.
   */
  collections: Map<string, ModelShape>;
};

/** Matches a whole-value `{token}` and captures the inner token text. */
const WHOLE_TOKEN = /^\{([^{}]+)\}$/;
/** Matches each embedded `{token}` for interpolated string extraction. */
const EMBEDDED_TOKEN = /\{([^{}]+)\}/g;

/** String-typed attributes — interpolation (every embedded token), not whole-value. */
const STRING_PROPS = new Set(["text", "texture"]);
/** Compound attributes — each of the four comma-separated fields may be a token. */
const COMPOUND_PROPS = new Set(["position", "size"]);
/**
 * Attributes whose value is NEVER a binding (structural / identity / wiring). These
 * are skipped during extraction — mirrors `guiBinding.LITERAL_ONLY_PROPS`, without
 * the compound/string names handled by their own branches.
 */
const LITERAL_ONLY_PROPS = new Set([
  "id",
  "src",
  // `data` is a whole-value grammar token selecting the child's base object; its
  // object shape is folded in separately by `recordComponentData`, so it must not
  // be recorded as an ordinary scalar/nested binding here.
  DATA_ATTR,
  "controller",
  "name",
  "handler",
  "onKeyPressed",
  "onMouseMoved",
  "onMouseEntered",
  "onMouseExited",
  "onMouseClicked",
]);

/**
 * Own-property check that works regardless of the TS lib target. `Object.hasOwn`
 * is es2022; the project's lib target predates it (see `guiBinding.ts`), so we use
 * the prototype-method form, matching that module.
 */
function hasOwn(obj: object, key: string): boolean {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs es2022 lib; the build's tsc target is lower.
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** A fresh, empty shape. */
function emptyShape(): ModelShape {
  return { scalars: new Set(), nested: new Map(), objects: new Map(), collections: new Map() };
}

/**
 * Extract the token BODY (text between the braces) of a WHOLE-value binding, or
 * `undefined` when `raw` is not a single brace-wrapped token. Used to read the
 * grammar out of structural token attributes (`data`, `dataCollection`), which the
 * resolver also treats as whole-value bindings — a bare/literal value (legacy
 * `data="buttonProps"`) yields `undefined`, i.e. UNRESOLVABLE under the strict
 * grammar, matching the resolver's `resolveWholeTokenValue`.
 */
function wholeTokenBody(raw: string): string | undefined {
  const match = WHOLE_TOKEN.exec(raw.trim());
  return match ? match[1].trim() : undefined;
}

/**
 * Record a token's dotted PATH into a shape, building nested structure. An empty path
 * (a whole-object form like `{$.}` / `{.}`) contributes nothing. A single segment is a
 * scalar leaf; a multi-segment path makes every segment but the last a nested own-
 * object, with the last as a scalar leaf: `["creature","sprite"]` → `creature` is a
 * nested object holding scalar `sprite`. A segment already recorded as a scalar is
 * PROMOTED to a nested object when a deeper path needs it (object wins), and a leaf
 * whose name is already a nested object is left as the object (never demoted).
 */
function recordPath(shape: ModelShape, path: readonly string[]): void {
  if (path.length === 0) return;
  const [head, ...rest] = path;
  if (head === "") return; // defensive: empty segment (e.g. a stray leading dot)
  if (rest.length === 0) {
    // Leaf scalar — unless this name is already a nested object (object wins).
    if (!shape.nested.has(head)) shape.scalars.add(head);
    return;
  }
  // Intermediate segment → nested own-object; promote from a prior scalar if needed.
  shape.scalars.delete(head);
  let sub = shape.nested.get(head);
  if (sub === undefined) {
    sub = emptyShape();
    shape.nested.set(head, sub);
  }
  recordPath(sub, rest);
}

/**
 * The bare component identity for a `src` value. {@link srcBasename} path-strips and
 * REQUIRES a `.xml` extension, so `"button.xml"` and `"widgets/button.xml"` key on
 * `"button"` while a non-`.xml` `src` keys on `""` (not a valid reference) — matching
 * how the backend (`get_component`) resolves a component. Kept as a named helper for
 * call-site clarity.
 */
function bareComponentName(src: string | undefined): string {
  return srcBasename(src);
}

/**
 * The walk context threaded through extraction. It carries BOTH live frames so a
 * token routes by its grammar scope, not by where it sits in the tree:
 *
 *   - `root` — the View / local frame (`$.` tokens land here). Always present.
 *   - `item` — the CURRENT GridLayout item frame (bare tokens land here), or
 *     `undefined` outside a grid child. Inside a grid child both `root` and `item`
 *     are live at once (the grid grammar's crux) — `{$.x}` still reaches `root`.
 *
 * `resolve`/`ancestry` are the component-registry loader + include-cycle guard, both
 * unchanged from the flat design.
 */
type WalkCtx = {
  root: ModelShape;
  item: ModelShape | undefined;
  resolve: ComponentResolver | undefined;
  ancestry: ReadonlySet<string>;
};

/**
 * Route one token (the inner text of a `{...}`, no braces) into the right frame by its
 * grammar scope — classified through the SHARED {@link parseScopeRef}:
 *
 *   - VIEW (`$.a.b`) → nested own-object path in the View `root` (whole `{$.}` is a
 *     no-op — empty path).
 *   - ITEM (bare `a.b`) → item-scope path in `item` WHEN inside a grid child; OUTSIDE
 *     a grid there is no item frame, so a bare token contributes NOTHING (STRICT —
 *     no longer invents a root key). Whole `{.}` is a no-op.
 *   - NAMED (`$app.x`) → recognized, DEFERRED — no field fabricated.
 */
function recordToken(ctx: WalkCtx, token: string): void {
  const ref = parseScopeRef(token);
  if (ref.frame === "view") {
    recordPath(ctx.root, ref.path);
  } else if (ref.frame === "item") {
    // Bare token: only resolvable inside a grid item. No item frame → strict miss.
    if (ctx.item !== undefined) recordPath(ctx.item, ref.path);
  }
  // NAMED frame: recognized but deferred — fabricate no field.
}

/**
 * Resolve WHERE a single-segment grammar token seats and under WHAT key, from the frame
 * it names — shared by `data=` (data objects) and `dataCollection=` (collections):
 *
 *   - VIEW single segment (`{$.key}`) → the View `root`.
 *   - ITEM single segment (bare `{key}`, only meaningful inside a grid child) → the
 *     enclosing `item` frame, when one is live.
 *   - anything else (`{$.}`, `{.}`, a dotted or `$name.` path, or a bare/legacy value
 *     with no braces) → `undefined` (deferred / unresolvable under the strict grammar).
 */
function tokenTarget(
  ctx: WalkCtx,
  raw: string | undefined,
): { scope: ModelShape; key: string } | undefined {
  if (raw === undefined) return undefined;
  const body = wholeTokenBody(raw);
  if (body === undefined) return undefined; // bare/legacy value — unresolvable under strict
  const ref = parseScopeRef(body);
  if (ref.frame === "view" && ref.path.length === 1) return { scope: ctx.root, key: ref.path[0] };
  if (ref.frame === "item" && ref.path.length === 1 && ctx.item !== undefined) {
    return { scope: ctx.item, key: ref.path[0] };
  }
  return undefined; // whole-object / dotted / named — deferred
}

/**
 * Fold the referenced child component's shape into the frame a nested
 * `<Component … data="{token}">` names, under that token's key. The `data` attr is a
 * whole-value grammar token (the resolver seats the child's fresh root from it); the
 * scaffold honors the SINGLE-SEGMENT forms and seats the data object in the frame the
 * token names ({@link tokenTarget}): `data="{$.buttonProps}"` → root key `buttonProps`;
 * a bare `data="{badge}"` inside a grid item → the item's `badge` key. Other grammar
 * forms are DEFERRED:
 *   - `data="{$.}"` (whole View) / `data="{.}"` (whole grid item) — pass-throughs that
 *     seat an existing frame, so they add no NEW object;
 *   - a dotted `data="{$.a.b}"` or a `$name.` form — no shipped usage; left for the
 *     author (mirroring the conservative spirit of the resolver);
 *   - a bare/legacy `data="buttonProps"` (no braces) — UNRESOLVABLE under the strict
 *     grammar (matches the resolver's `resolveWholeTokenValue`), so it is skipped.
 *
 * The child's shape is extracted RECURSIVELY (so a child that itself nests components
 * via `data=` contributes its nested objects too), guarded by the ancestor set against
 * include cycles. A missing/cyclic/unresolvable child still registers the key as a
 * present-but-empty object, so the model surfaces the binding rather than dropping it.
 */
function recordComponentData(ctx: WalkCtx, node: GuiNode): void {
  if (node.tag !== "Component") return;
  const target = tokenTarget(ctx, node.attrs[DATA_ATTR]);
  if (target === undefined) return;

  let objShape = target.scope.objects.get(target.key);
  if (objShape === undefined) {
    objShape = emptyShape();
    target.scope.objects.set(target.key, objShape);
  }

  if (ctx.resolve === undefined) return; // no registry yet → present-but-empty
  // Component identity is the BARE basename — the picker writes a bare `src` and the
  // backend resolves by bare name; strip a hand-authored `.xml` so both forms match.
  const basename = bareComponentName(node.attrs[SRC_ATTR]);
  if (basename === "" || ctx.ancestry.has(basename)) return; // missing src / include cycle
  const childRoot = ctx.resolve(basename);
  if (childRoot === undefined) return;
  // Recurse into the child with this basename added to the ancestor set, then merge
  // the child's shape into the object so repeated keys accumulate rather than clash.
  const childShape = extractShape(childRoot, ctx.resolve, new Set([...ctx.ancestry, basename]));
  mergeShapeInto(objShape, childShape);
}

/** Accrete `source`'s fields into `target` (scalars ∪; nested/objects/collections merged). */
function mergeShapeInto(target: ModelShape, source: ModelShape): void {
  for (const s of source.scalars) target.scalars.add(s);
  for (const [name, sub] of source.nested) {
    const existing = target.nested.get(name);
    if (existing) mergeShapeInto(existing, sub);
    else target.nested.set(name, sub);
  }
  for (const [name, sub] of source.objects) {
    const existing = target.objects.get(name);
    if (existing) mergeShapeInto(existing, sub);
    else target.objects.set(name, sub);
  }
  for (const [name, sub] of source.collections) {
    const existing = target.collections.get(name);
    if (existing) mergeShapeInto(existing, sub);
    else target.collections.set(name, sub);
  }
}

/**
 * Record a whole-value attribute (`backgroundColor="{$.barColor}"`, etc.): if the raw
 * value is a single `{token}`, route it by grammar; otherwise it is a literal and
 * contributes nothing.
 */
function recordWholeValue(ctx: WalkCtx, raw: string): void {
  const body = wholeTokenBody(raw);
  if (body !== undefined) recordToken(ctx, body);
}

/**
 * Record an interpolated string attribute (`text`, `texture`): every embedded
 * `{token}` is a binding, so each is routed by grammar into the shape.
 */
function recordInterpolated(ctx: WalkCtx, raw: string): void {
  EMBEDDED_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null = EMBEDDED_TOKEN.exec(raw);
  while (match !== null) {
    recordToken(ctx, match[1]);
    match = EMBEDDED_TOKEN.exec(raw);
  }
}

/**
 * Record a compound attribute (`position`, `size`): each comma-separated field is
 * independently a whole-value `{token}` or a literal.
 */
function recordCompound(ctx: WalkCtx, raw: string): void {
  for (const field of raw.split(",")) {
    recordWholeValue(ctx, field);
  }
}

/** The attribute naming a `<GridLayout>`'s iterable collection (a whole-value grammar token). */
const DATA_COLLECTION_ATTR = "dataCollection";

/**
 * Fold a grid template `<Component src="x">`'s OWN shape directly into the item shape.
 * Unlike a nested `<Component data="{$.k}">` (which folds the child under sub-key `k`
 * via {@link recordComponentData}), a GridLayout's `<Component>` child uses the ITEM as
 * its full data root (locked decision: data=/overrides are ignored under a grid) — so
 * the component's fields land flat IN the item, not under a key. A missing/cyclic/
 * unresolvable component contributes nothing (the item is still seeded by other cells'
 * fields or stays empty). Recursion is guarded by the ancestor set against include
 * cycles, mirroring {@link recordComponentData}.
 */
function recordGridComponentTemplate(
  itemShape: ModelShape,
  template: GuiNode,
  resolve: ComponentResolver | undefined,
  ancestry: ReadonlySet<string>,
): void {
  if (resolve === undefined) return; // no registry yet → item gets no component fields
  const basename = bareComponentName(template.attrs[SRC_ATTR]);
  if (basename === "" || ancestry.has(basename)) return; // missing src / include cycle
  const childRoot = resolve(basename);
  if (childRoot === undefined) return;
  const childShape = extractShape(childRoot, resolve, new Set([...ancestry, basename]));
  mergeShapeInto(itemShape, childShape);
}

/**
 * Record a `<GridLayout dataCollection="{$.k}">`'s implied collection. `k` names an
 * ARRAY whose item objects carry the grid's single child template's item-scope tokens.
 * The collection seats in the frame its token names ({@link tokenTarget}): a VIEW token
 * (`{$.creatures}`) → a ROOT collection (the common case); a bare ITEM token
 * (`{creatures}`, a NESTED grid) → an array-valued field of the ENCLOSING item. The
 * GridLayout's OWN attrs (rows/columns/gutter/dataCollection) are structural, not
 * bindings, so they contribute nothing.
 *
 * The grid always holds exactly one template child (parse guarantees ≤ 1). The template
 * is walked with a FRESH item frame (this grid's item shape) so its bare tokens describe
 * the item while its `{$.x}` tokens still reach the View root. A `<Component>` template
 * folds its component's own shape flat into the item (the item is the component's data
 * root). A grid with no resolvable `dataCollection` (bare/legacy or a whole-object form)
 * or no child yet (mid-authoring) records no collection — the template is still walked
 * so any `$.` tokens survive, with bare tokens absorbed by a throwaway item shape.
 */
function recordGridCollection(ctx: WalkCtx, node: GuiNode): void {
  const target = tokenTarget(ctx, node.attrs[DATA_COLLECTION_ATTR]);

  // The item shape this grid's template records into. When the collection is
  // unresolvable, a throwaway shape absorbs (and discards) the template's bare tokens
  // while its `$.` tokens still route to the live root.
  let itemShape: ModelShape;
  if (target !== undefined) {
    itemShape = target.scope.collections.get(target.key) ?? emptyShape();
    target.scope.collections.set(target.key, itemShape);
  } else {
    itemShape = emptyShape();
  }

  const template = node.children[0];
  if (template === undefined) return; // grid not yet given a child

  if (template.tag === "Component") {
    // The item IS the component's data root: fold the component's own fields flat.
    // The template's own attrs are still ignored by the renderer (geometry is grid-
    // owned), and a grid <Component> uses the item wholesale, so we record only the
    // referenced component's shape — not the template node's attrs.
    recordGridComponentTemplate(itemShape, template, ctx.resolve, ctx.ancestry);
    return;
  }
  // A bare Panel/Text template: walk its subtree with this grid's item frame live, so
  // bare tokens land in the item and `$.` tokens still reach the View root.
  walkNode({ ...ctx, item: itemShape }, template);
}

/** Walk one node's attributes and route every token into the shape by grammar. */
function recordNodeAttrs(ctx: WalkCtx, attrs: Record<string, string>): void {
  for (const [name, raw] of Object.entries(attrs)) {
    if (LITERAL_ONLY_PROPS.has(name)) continue;
    if (STRING_PROPS.has(name)) {
      recordInterpolated(ctx, raw);
    } else if (COMPOUND_PROPS.has(name)) {
      recordCompound(ctx, raw);
    } else {
      // Whole-value typed/color props.
      recordWholeValue(ctx, raw);
    }
  }
}

/**
 * Walk a node (and its subtree) accreting tokens into the context's frames. Every node
 * records its attrs (routed by grammar) and descends into its children.
 */
function walkNode(ctx: WalkCtx, node: GuiNode): void {
  // A `<GridLayout>` introduces a collection rather than contributing its own attrs to
  // the current scope: its attrs are structural (no bindings) and its template child's
  // tokens belong to a fresh ITEM frame, not this one. So divert wholesale here and do
  // NOT descend the GridLayout normally — recordGridCollection walks the template with
  // the right item frame (and handles a nested grid by seating a collection in the
  // enclosing item).
  if (node.tag === "GridLayout") {
    recordGridCollection(ctx, node);
    return;
  }
  recordNodeAttrs(ctx, node.attrs);
  recordComponentData(ctx, node);
  for (const c of node.children) walkNode(ctx, c);
}

/**
 * Extract the {@link ModelShape} from a GUI tree: the scalars and nested-component
 * data objects every `{token}` / `<Component data>` in the tree implies. Pure — does
 * not touch any model.
 *
 * `resolve` (optional) loads a nested `<Component src>`'s tree so its shape can be
 * folded under the `data=` key; without it, data objects register as present-but-
 * empty. `ancestry` is the set of `src` basenames already on the include path (the
 * cycle guard for `data=` nesting) — seed it with the component's OWN basename to
 * catch a top-level A→…→A loop.
 */
export function extractShape(
  root: GuiNode,
  resolve?: ComponentResolver,
  ancestry: ReadonlySet<string> = new Set(),
): ModelShape {
  const rootShape = emptyShape();
  walkNode({ root: rootShape, item: undefined, resolve, ancestry }, root);
  return rootShape;
}

/**
 * Build a JSON value from a shape: each scalar field → a string equal to the token
 * name (its placeholder), each nested own-object (`$.` path) → a recursively-built
 * object, each nested `<Component data>` object → an object built from the child's
 * shape, each `<GridLayout dataCollection>` → a one-element ARRAY holding a single
 * sample item built from the item shape. Field insertion order is scalars, then
 * nested own-objects, then data objects, then collections — matching extraction order
 * for stable output.
 */
export function buildModel(shape: ModelShape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of shape.scalars) {
    out[name] = name;
  }
  // Nested own-objects (from `$.a.b` dotted paths): a recursively-built object.
  for (const [name, sub] of shape.nested) {
    out[name] = buildModel(sub);
  }
  // Nested `<Component data>` objects: one object built from the child's shape.
  for (const [name, objShape] of shape.objects) {
    out[name] = buildModel(objShape);
  }
  // `<GridLayout dataCollection>` collections: a one-element sample array (the
  // default seed) built from the item shape.
  for (const [name, itemShape] of shape.collections) {
    out[name] = [buildModel(itemShape)];
  }
  return out;
}

/** Whether a value is a plain (non-array, non-null) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Additively merge a scaffold object into a target object IN-PLACE-ish (returns a
 * new object; never mutates `target`), reporting whether anything was added.
 *
 *   - A scaffold key MISSING from the target is added (its built value).
 *   - A scaffold key PRESENT in the target is preserved as-is UNLESS both sides are
 *     plain objects, in which case the merge recurses to add missing nested fields.
 *   - Any TYPE CONFLICT (scaffold wants an object but the user put a scalar, or vice
 *     versa) leaves the user's value ALONE — defensive, never overwrite.
 *
 * `added` is set true whenever a key or nested field is introduced, so the caller
 * can skip re-serializing when nothing changed.
 */
function mergeInto(
  target: Record<string, unknown>,
  scaffold: Record<string, unknown>,
  report: { added: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, scaffoldValue] of Object.entries(scaffold)) {
    if (!hasOwn(out, key)) {
      // Brand-new key — add it wholesale.
      out[key] = scaffoldValue;
      report.added = true;
      continue;
    }
    const existing = out[key];

    // Both plain objects → recurse to add missing nested fields.
    if (isPlainObject(existing) && isPlainObject(scaffoldValue)) {
      out[key] = mergeInto(existing, scaffoldValue, report);
    }

    // Type conflict or matching scalar — never overwrite the user's value.
  }
  return out;
}

/**
 * Additively merge the scaffold built from `shape` into the user's current model.
 * Returns the merged model plus whether anything was added. The current model is
 * preserved entirely: existing keys/values are never changed or removed, only
 * missing scaffold keys/fields are introduced. A non-object current model (the user
 * replaced the whole model with an array/scalar) is left ALONE — there is no
 * top-level object to add root keys to — and reports nothing added.
 */
export function mergeModel(
  current: unknown,
  shape: ModelShape,
): { model: unknown; added: boolean } {
  const scaffold = buildModel(shape);
  if (!isPlainObject(current)) {
    // Defensive: a scalar/array/null root has nowhere to add named root keys. Leave
    // it untouched rather than clobbering the user's deliberate non-object model.
    return { model: current, added: false };
  }
  const report = { added: false };
  const merged = mergeInto(current, scaffold, report);
  return { model: report.added ? merged : current, added: report.added };
}

/**
 * Prune-SYNC a `data=` object (and everything nested in it) to EXACTLY `shape`:
 * keep the user's value for any key still in the shape, add a placeholder for a new
 * key, and DROP any key the shape no longer carries. Unlike the additive root merge,
 * a data object MIRRORS its source component — a token the child stopped using is a
 * stale key here and is pruned. Returns the synced object plus whether it differs
 * from `current` (so a no-op sync never forces a rewrite).
 *
 * A non-object `current` (or a type the shape disagrees with) is rebuilt wholesale
 * from the shape — the data object is owned by the component, not hand-authored.
 */
function syncDataObject(
  current: unknown,
  shape: ModelShape,
): { value: Record<string, unknown>; changed: boolean } {
  if (!isPlainObject(current)) {
    return { value: buildModel(shape), changed: true };
  }
  const out: Record<string, unknown> = {};
  let changed = false;

  for (const name of shape.scalars) {
    if (hasOwn(current, name)) out[name] = current[name];
    else {
      out[name] = name;
      changed = true;
    }
  }
  // Nested own-objects (`$.a.b`) the child component itself uses: prune-synced like the
  // rest of the data object (it mirrors its component), preserving user values within.
  for (const [name, sub] of shape.nested) {
    const r = syncDataObject(current[name], sub);
    out[name] = r.value;
    if (r.changed || !hasOwn(current, name)) changed = true;
  }
  for (const [name, sub] of shape.objects) {
    const r = syncDataObject(current[name], sub);
    out[name] = r.value;
    if (r.changed || !hasOwn(current, name)) changed = true;
  }
  // A data-object component may itself contain a GridLayout → a collection within the
  // synced object. Reconcile each per element (additive into existing items, seed one
  // when absent), so the data object mirrors the component including its grids.
  for (const [name, itemShape] of shape.collections) {
    const r = reconcileCollectionArray(current[name], itemShape);
    out[name] = r.value;
    if (r.changed || !hasOwn(current, name)) changed = true;
  }

  // PRUNE: any key on `current` the shape no longer has is stale — drop it.
  for (const key of Object.keys(current)) {
    if (!hasOwn(out, key)) changed = true;
  }
  return { value: out, changed };
}

/**
 * Reconcile a `<GridLayout dataCollection>` ARRAY against its item shape. The array
 * is OWNED by the user (they may have authored several items); reconciliation is
 * additive PER ELEMENT — each existing item object is reconciled against the item
 * shape exactly as a root object is ({@link reconcileObject}: additive own scalars,
 * prune-sync nested data objects, drop orphaned data objects). New item fields thus
 * land in EVERY existing element; the user's per-item values are never overwritten.
 *
 * An ABSENT or EMPTY array is seeded with ONE sample item (the default). A non-array
 * `current` (the user replaced the collection with a scalar/object) is rebuilt to the
 * one-item seed — the key is owned by the grid binding, so a type the shape disagrees
 * with is corrected. A non-object array ELEMENT (a primitive item, which the spec
 * explicitly allows for collections of non-objects) is left ALONE — there are no
 * fields to merge into it.
 */
function reconcileCollectionArray(
  current: unknown,
  itemShape: ModelShape,
): { value: unknown[]; changed: boolean } {
  if (!Array.isArray(current) || current.length === 0) {
    // Absent / empty / wrong-type → seed exactly one sample item.
    return { value: [buildModel(itemShape)], changed: true };
  }
  let changed = false;
  const out = current.map((element) => {
    if (!isPlainObject(element)) return element; // primitive item — nothing to merge
    const r = reconcileObject(element, itemShape);
    if (r.changed) changed = true;
    return r.model;
  });
  return { value: out, changed };
}

/**
 * Reconcile one plain object against a shape — the shared body for the ROOT model and
 * each grid ITEM. Applies the ownership split: additive own scalars AND nested own-
 * objects (via {@link mergeModel} — its `mergeInto` recurses into plain objects, so a
 * `$.a.b` nested object grows additively and keeps the user's extra inner fields),
 * prune-sync nested `<Component data>` objects (via {@link syncDataObject}), per-element
 * collection reconcile (via {@link reconcileCollectionArray}), and dropping ORPHANED
 * plain objects (a renamed/removed `data=`/`dataCollection` key). Scalars are never
 * pruned.
 */
function reconcileObject(
  current: Record<string, unknown>,
  shape: ModelShape,
): { model: Record<string, unknown>; changed: boolean } {
  const { model: mergedRaw, added } = mergeModel(current, shape);
  const merged = isPlainObject(mergedRaw) ? mergedRaw : current;
  const out: Record<string, unknown> = { ...merged };
  let changed = added;

  // Data objects: prune-sync to the child shape.
  for (const [name, sub] of shape.objects) {
    const r = syncDataObject(out[name], sub);
    if (r.changed) {
      out[name] = r.value;
      changed = true;
    }
  }
  // Collections: reconcile the array per element (additive own fields into each).
  for (const [name, itemShape] of shape.collections) {
    const r = reconcileCollectionArray(out[name], itemShape);
    if (r.changed) {
      out[name] = r.value;
      changed = true;
    }
  }
  // Drop ORPHANED plain objects: a key holding a plain object the tree references
  // nowhere (a `data=` binding renamed or removed). Pruning makes a `data` key rename
  // REPLACE rather than accumulate. NESTED own-objects (`$.a.b`) are referenced while
  // their token exists (so they are kept and merged additively above); like the existing
  // design, a leftover OBJECT whose token is gone is pruned — scalars and arrays are
  // never pruned here (an own token's scalar leftover stays; a renamed-away collection
  // ARRAY is a harmless leftover, mirroring scalar treatment); referenced keys stay.
  const referenced = new Set<string>([
    ...shape.scalars,
    ...shape.nested.keys(),
    ...shape.objects.keys(),
    ...shape.collections.keys(),
  ]);
  for (const key of Object.keys(out)) {
    if (!referenced.has(key) && isPlainObject(out[key])) {
      delete out[key];
      changed = true;
    }
  }
  return { model: changed ? out : current, changed };
}

/**
 * Reconcile the user's current model against `shape`, returning the next model and
 * whether anything changed. Ownership rules (applied by {@link reconcileObject} at the
 * root and within each grid item):
 *
 *   - The component's OWN tokens (scalars and `$.a.b` nested own-objects) merge
 *     ADDITIVELY — add what's missing, never overwrite, keep the user's extra inner
 *     fields (a removed scalar/array token leaves a harmless leftover). This is
 *     {@link mergeModel}'s long-standing behavior, extended to nested objects.
 *   - A nested-component `data=` OBJECT is prune-SYNCED to the child's shape (see
 *     {@link syncDataObject}) — it mirrors the component, so stale keys are removed.
 *   - A `<GridLayout dataCollection>` ARRAY is reconciled PER ELEMENT (see
 *     {@link reconcileCollectionArray}): new item fields land in EVERY user item;
 *     an absent/empty array is seeded with one sample item. The array itself, like a
 *     scalar leftover, is never pruned when its binding is removed.
 *   - An ORPHANED data object — a key holding a plain OBJECT the tree no longer
 *     references — is dropped, so renaming a `data` key REPLACES it rather than leaving
 *     the old one behind. Only objects are pruned this way; scalar/array leftovers stay.
 *
 * Pruning is confined to data objects (their fields, and orphaned objects); a
 * component's own scalar model and grid arrays are never pruned.
 */
export function reconcileModel(
  current: unknown,
  shape: ModelShape,
): { model: unknown; changed: boolean } {
  if (!isPlainObject(current)) {
    // No top-level object to reconcile against — leave the user's value alone.
    return { model: current, changed: false };
  }
  return reconcileObject(current, shape);
}

/**
 * Compose the full scaffold-into-text pipeline (the wiring contract):
 *
 *   parse current text → extract shape from the tree → additively merge → if and
 *   ONLY IF the merge added something, re-serialize; otherwise return `null`.
 *
 * Returning `null` for "nothing new" is what lets the caller leave the user's exact
 * text untouched (no reformatting churn) while they edit. A current text that does
 * not parse as JSON is treated as having no mergeable model: we do not stomp it
 * (return `null`), because rewriting unparseable text would discard the user's
 * in-progress edit. The re-serialization uses 2-space indentation (matching the
 * panel's JSON formatting).
 *
 * @param currentText the Data Model panel's current raw text.
 * @param root the open component's node tree.
 * @param resolve (optional) loads a nested `<Component src>`'s tree so its shape is
 *   folded under the `data=` key. Omit it to scaffold tokens only (data objects
 *   register present-but-empty until the component registry has loaded).
 * @param selfBasename (optional) the open component's own `.xml` basename, seeded
 *   into the include-cycle guard so a component that (transitively) nests itself
 *   via `data=` doesn't recurse forever.
 */
export function scaffoldModelText(
  currentText: string,
  root: GuiNode,
  resolve?: ComponentResolver,
  selfBasename?: string,
): string | null {
  const trimmed = currentText.trim();
  let current: unknown;
  if (trimmed === "") {
    current = {};
  } else {
    try {
      current = JSON.parse(currentText);
    } catch {
      // Unparseable in-progress text — don't stomp the user's editing.
      return null;
    }
  }
  const ancestry = selfBasename ? new Set([selfBasename]) : new Set<string>();
  const shape = extractShape(root, resolve, ancestry);
  const { model, changed } = reconcileModel(current, shape);
  if (!changed) return null;
  return JSON.stringify(model, null, 2);
}
