/**
 * guiModelScaffold — auto-build the Data Model JSON from a component's `{token}`
 * references (task 482), SCOPE-AWARE and ADDITIVE.
 *
 * The Data Model panel is a per-session scratch input the preview resolves
 * bindings against. Rather than make the user hand-author it from scratch, this
 * module walks the open {@link GuiNode} tree, collects every `{token}` reference
 * (respecting `forEach` item scoping), and produces a JSON value that gives every
 * referenced token a sensible placeholder — so opening a component pre-fills a
 * model whose every binding resolves, and adding a new token grows the model
 * without touching what the user already edited.
 *
 * THREE pure stages, each independently testable:
 *
 *   1. EXTRACT (`extractShape`) — walk the tree into a nested {@link ModelShape}:
 *      a set of scalar field names + a map of collection-name → child item-shape,
 *      recursive. Scoping mirrors the resolver (`guiScope.ts`/`guiForEach.ts`):
 *        - a bare `{token}` is a field of the CURRENT scope;
 *        - `{$.x}` / `{$}` reaches the ROOT scope at any nesting depth;
 *        - `forEach="{coll}"` resolves `coll` in the CURRENT scope (a collection
 *          there) and opens a CHILD item-scope for that node's subtree; nested
 *          `forEach` nests; `key` is item-scoped.
 *      Tokens are read from the same attribute kinds the resolver binds: `text`
 *      and `texture` (interpolation — every embedded `{name}`), whole-value typed
 *      props (colors, `visible`, `fontSize`, `borderSize`, `textAlign`, `layer`),
 *      each of the four `position`/`size` fields, `forEach`, and `key`.
 *
 *   2. BUILD (`buildModel`) — turn a shape into a JSON value: each scalar field →
 *      a string equal to the token NAME (no braces), e.g. `{health}` →
 *      `"health": "health"`; each collection → an array with ONE sample item
 *      object built from its item-shape (so `forEach` renders one instance).
 *
 *   3. MERGE (`mergeModel`) — additively fold a freshly-built scaffold into the
 *      user's CURRENT model: add missing root keys; add missing fields to the
 *      sample object(s) inside an existing collection array; NEVER overwrite an
 *      existing value, NEVER delete (removed tokens leave harmless leftovers), and
 *      leave a key alone when its existing type conflicts with the scaffold.
 *
 * The wiring (`scaffoldModelText`) composes all three over raw text: it returns a
 * new text ONLY when the merge added something, so a no-op change never reformats
 * the user's JSON.
 *
 * This module is PURE (no React, no DOM). It reuses the token-detection helpers in
 * `guiBinding.ts` rather than re-inventing brace parsing.
 *
 * @see design/xgui_ta.md — "Data binding", "Repetition and control flow (forEach)".
 */

import { isWholeToken } from "../../lib/guiBinding";
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
 * A nested model shape: the scalar field names bound in a scope, plus the
 * collections (`forEach` bindings) opened in that scope, each mapped to its child
 * item-shape (recursive). The ROOT shape describes the top-level model; each
 * collection's shape describes one sample item.
 *
 * Mutable during extraction (the walker accretes into it); callers treat the
 * result as read-only.
 */
export type ModelShape = {
  /** Bare scalar field names bound in this scope (no braces, no `$.` prefix). */
  scalars: Set<string>;
  /** `collectionName` → the item-shape opened by a `forEach` in this scope. */
  collections: Map<string, ModelShape>;
  /**
   * `dataKey` → the OBJECT shape a nested `<Component … data="dataKey">` injects in
   * this scope. The shape is the referenced child component's own scaffolded shape,
   * so the parent model gets `dataKey: { …child fields… }` auto-populated from the
   * component (the v1 binding is a bare key in the current scope).
   */
  objects: Map<string, ModelShape>;
};

/** Matches a whole-value `{token}` and captures the inner token text. */
const WHOLE_TOKEN = /^\{([^{}]+)\}$/;
/** Matches each embedded `{token}` for interpolated string extraction. */
const EMBEDDED_TOKEN = /\{([^{}]+)\}/g;

/** The `$` root-escape prefix — mirrors `guiScope.ts`. */
const ROOT_PREFIX = "$";

/** String-typed attributes — interpolation (every embedded token), not whole-value. */
const STRING_PROPS = new Set(["text", "texture"]);
/** Compound attributes — each of the four comma-separated fields may be a token. */
const COMPOUND_PROPS = new Set(["position", "size"]);
/** The `forEach` template attribute — opens a child item scope. */
const FOR_EACH_ATTR = "forEach";
/**
 * Attributes whose value is NEVER a binding (structural / identity / wiring). These
 * are skipped during extraction — mirrors `guiBinding.LITERAL_ONLY_PROPS`, but
 * WITHOUT `key`, which IS scaffolded (it is an item-scoped data field), and without
 * the compound/string/forEach names handled by their own branches.
 */
const LITERAL_ONLY_PROPS = new Set([
  "id",
  "src",
  // `data` names a model KEY (a literal identifier), not a parent `{token}`; its
  // object shape is folded in separately by `recordComponentData`, so it must not
  // be mistaken for a scalar binding here.
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
 * is es2022; the project's lib target predates it (see `guiBinding.ts`/`guiScope.ts`),
 * so we use the prototype-method form, matching those modules.
 */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** A fresh, empty shape. */
function emptyShape(): ModelShape {
  return { scalars: new Set(), collections: new Map(), objects: new Map() };
}

/** A simple bare model key (the only `data=` form supported in v1 — no `.`/`$`). */
function isBareKey(key: string): boolean {
  return key !== "" && !key.includes(".") && !key.includes("$");
}

/**
 * Fold the referenced child component's shape into the current scope under a nested
 * `<Component … data="k">`'s key. The child's shape is extracted RECURSIVELY (so a
 * child that itself nests components via `data=` contributes its nested objects
 * too), guarded by the ancestor set against include cycles. A missing/cyclic/
 * unresolvable child still registers the key as a present-but-empty object, so the
 * model surfaces the binding rather than dropping it silently.
 *
 * v1 only honors a BARE data key in the CURRENT scope; `$.`/dotted forms are left
 * for the author (mirroring the conservative spirit of `recordToken`).
 */
function recordComponentData(
  stack: ModelShape[],
  node: GuiNode,
  resolve: ComponentResolver | undefined,
  ancestry: ReadonlySet<string>,
): void {
  if (node.tag !== "Component") return;
  const dataKey = node.attrs[DATA_ATTR]?.trim();
  if (dataKey === undefined || !isBareKey(dataKey)) return;

  const scope = stack[stack.length - 1];
  let objShape = scope.objects.get(dataKey);
  if (objShape === undefined) {
    objShape = emptyShape();
    scope.objects.set(dataKey, objShape);
  }

  if (resolve === undefined) return; // no registry yet → present-but-empty
  const basename = srcBasename(node.attrs[SRC_ATTR]);
  if (basename === "" || ancestry.has(basename)) return; // missing src / include cycle
  const childRoot = resolve(basename);
  if (childRoot === undefined) return;
  // Recurse into the child with this basename added to the ancestor set, then merge
  // the child's shape into the object so repeated keys accumulate rather than clash.
  const childShape = extractShape(childRoot, resolve, new Set([...ancestry, basename]));
  mergeShapeInto(objShape, childShape);
}

/** Accrete `source`'s fields into `target` (scalars ∪, objects/collections merged). */
function mergeShapeInto(target: ModelShape, source: ModelShape): void {
  for (const s of source.scalars) target.scalars.add(s);
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
 * Record a token reference into the shape stack. `token` is the inner text of a
 * `{...}` (no braces). Scoping mirrors the resolver:
 *
 *   - `$` / `$.path` → the ROOT scope (stack bottom), regardless of depth. A bare
 *     `$` (the root object itself) is not a named field, so it records nothing.
 *   - any other `name` / `name.path` → the CURRENT scope (stack top).
 *
 * A DOTTED path (`stats.hp`, `$.theme.accent`) records a NESTED object: the head
 * segment is a scalar field whose value the resolver walks into, so the scaffold
 * must make it an object, not a string. We model that by promoting the head into
 * the scope's collections-as-nesting? No — a dotted path is an object field, not a
 * `forEach` array. We record only the HEAD segment as a scalar placeholder; deeper
 * segments would need an object value the builder can't infer a shape for cheaply.
 * Recording the head keeps the key present (the binding resolves to a string, which
 * stringifies fine for interpolation) without inventing nested structure the author
 * may not want — the user refines dotted bindings by hand. This matches the
 * conservative, additive spirit: present-but-simple beats absent or over-built.
 */
function recordToken(stack: ModelShape[], token: string): void {
  const trimmed = token.trim();
  if (trimmed === "") return;

  let scope: ModelShape;
  let path: string;
  if (trimmed === ROOT_PREFIX) {
    // `{$}` denotes the whole root object — not a named field; nothing to record.
    return;
  }
  if (trimmed.startsWith(`${ROOT_PREFIX}.`)) {
    scope = stack[0];
    path = trimmed.slice(ROOT_PREFIX.length + 1);
  } else {
    scope = stack[stack.length - 1];
    path = trimmed;
  }

  if (path === "") return;
  // Record only the head segment of a (possibly dotted) path as a scalar field —
  // see the doc comment above for why deeper segments are left to the user.
  const head = path.split(".")[0];
  if (head !== "") scope.scalars.add(head);
}

/**
 * Record a whole-value attribute (`backgroundColor="{barColor}"`, `key="{id}"`,
 * etc.): if the raw value is a single `{token}`, record it; otherwise it is a
 * literal and contributes nothing.
 */
function recordWholeValue(stack: ModelShape[], raw: string): void {
  const trimmed = raw.trim();
  if (!isWholeToken(trimmed)) return;
  const match = WHOLE_TOKEN.exec(trimmed);
  if (match) recordToken(stack, match[1]);
}

/**
 * Record an interpolated string attribute (`text`, `texture`): every embedded
 * `{token}` is a binding, so each is recorded into the appropriate scope.
 */
function recordInterpolated(stack: ModelShape[], raw: string): void {
  EMBEDDED_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null = EMBEDDED_TOKEN.exec(raw);
  while (match !== null) {
    recordToken(stack, match[1]);
    match = EMBEDDED_TOKEN.exec(raw);
  }
}

/**
 * Record a compound attribute (`position`, `size`): each comma-separated field is
 * independently a whole-value `{token}` or a literal.
 */
function recordCompound(stack: ModelShape[], raw: string): void {
  for (const field of raw.split(",")) {
    recordWholeValue(stack, field);
  }
}

/**
 * Walk one node's attributes (EXCEPT `forEach`, handled by the caller so it can
 * open the child scope) and record every token into the current shape stack.
 */
function recordNodeAttrs(stack: ModelShape[], attrs: Record<string, string>): void {
  for (const [name, raw] of Object.entries(attrs)) {
    if (name === FOR_EACH_ATTR) continue; // the caller opens the child scope
    if (LITERAL_ONLY_PROPS.has(name)) continue;
    if (STRING_PROPS.has(name)) {
      recordInterpolated(stack, raw);
    } else if (COMPOUND_PROPS.has(name)) {
      recordCompound(stack, raw);
    } else {
      // Whole-value typed/color props, plus `key` (item-scoped data field).
      recordWholeValue(stack, raw);
    }
  }
}

/**
 * The collection-name a `forEach="{coll}"` opens, resolved in the scope it sits in
 * — bare → current scope, `$.x` → root — or `null` when the value is not a usable
 * whole-value token (a literal, an interpolated form, or a dotted path the scaffold
 * doesn't nest). Returns the scope the collection belongs to alongside its name so
 * the child item-shape is registered on the RIGHT scope.
 */
function resolveForEachTarget(
  stack: ModelShape[],
  raw: string,
): { scope: ModelShape; name: string } | null {
  const trimmed = raw.trim();
  if (!isWholeToken(trimmed)) return null;
  const token = WHOLE_TOKEN.exec(trimmed)?.[1]?.trim();
  if (token === undefined || token === "" || token === ROOT_PREFIX) return null;

  let scope: ModelShape;
  let path: string;
  if (token.startsWith(`${ROOT_PREFIX}.`)) {
    scope = stack[0];
    path = token.slice(ROOT_PREFIX.length + 1);
  } else {
    scope = stack[stack.length - 1];
    path = token;
  }
  // A dotted collection path (`{a.b}`) would need a nested object holding an array;
  // the scaffold stays flat and records only single-segment collections. A dotted
  // forEach still renders (zero instances) and the user can author the nesting.
  if (path === "" || path.includes(".")) return null;
  return { scope, name: path };
}

/**
 * Walk a node (and its subtree) accreting tokens into `stack`. A `forEach` node
 * opens a CHILD item-scope: its own non-`forEach` attrs are recorded in that child
 * scope (the template's bindings are item-scoped), and its children descend under
 * it. A plain node records in the current scope and descends without pushing.
 */
function walkNode(
  stack: ModelShape[],
  node: GuiNode,
  resolve: ComponentResolver | undefined,
  ancestry: ReadonlySet<string>,
): void {
  const forEachRaw = node.attrs[FOR_EACH_ATTR];
  const target =
    forEachRaw !== undefined && forEachRaw.trim() !== ""
      ? resolveForEachTarget(stack, forEachRaw)
      : null;

  if (target) {
    // Open (or reuse) the child item-shape for this collection, then record this
    // node's OWN attrs and its subtree inside that child scope — the template's
    // bare tokens and its `key` are fields of the collection's item.
    let child = target.scope.collections.get(target.name);
    if (child === undefined) {
      child = emptyShape();
      target.scope.collections.set(target.name, child);
    }
    const childStack = [...stack, child];
    recordNodeAttrs(childStack, node.attrs);
    recordComponentData(childStack, node, resolve, ancestry);
    for (const c of node.children) walkNode(childStack, c, resolve, ancestry);
    return;
  }

  // Plain node: record in the current scope, descend without pushing.
  recordNodeAttrs(stack, node.attrs);
  recordComponentData(stack, node, resolve, ancestry);
  for (const c of node.children) walkNode(stack, c, resolve, ancestry);
}

/**
 * Extract the scope-aware {@link ModelShape} from a GUI tree: the root scalars,
 * collection item-shapes, and nested-component data objects every `{token}` /
 * `<Component data>` in the tree implies, honoring `forEach` scoping. Pure — does
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
  walkNode([rootShape], root, resolve, ancestry);
  return rootShape;
}

/**
 * Build a JSON value from a shape: each scalar field → a string equal to the token
 * name (its placeholder), each collection → a single-element array holding ONE
 * sample item object built from the collection's item-shape. Field insertion order
 * is scalars-first then collections, matching extraction order for stable output.
 */
export function buildModel(shape: ModelShape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of shape.scalars) {
    out[name] = name;
  }
  // Nested `<Component data>` objects: one object built from the child's shape.
  for (const [name, objShape] of shape.objects) {
    out[name] = buildModel(objShape);
  }
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
 *     mergeable in the same way:
 *       · both plain objects → recurse;
 *       · both arrays whose first element is a plain object → merge the scaffold's
 *         sample item into the target's FIRST item (the sample), leaving any extra
 *         user items untouched. This is how new `forEach` item-fields reach an
 *         existing collection without disturbing user-authored sample data.
 *   - Any TYPE CONFLICT (scaffold wants an object/array but the user put a scalar,
 *     or vice versa) leaves the user's value ALONE — defensive, never overwrite.
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
      continue;
    }

    // Both arrays-of-object → merge the sample item into the user's first item.
    if (Array.isArray(existing) && Array.isArray(scaffoldValue)) {
      const sample = scaffoldValue[0];
      const userFirst = existing[0];
      if (isPlainObject(sample) && isPlainObject(userFirst)) {
        const mergedFirst = mergeInto(userFirst, sample, report);
        if (mergedFirst !== userFirst) {
          const nextArr = existing.slice();
          nextArr[0] = mergedFirst;
          out[key] = nextArr;
        }
      } else if (isPlainObject(sample) && existing.length === 0) {
        // User emptied the array — seed the sample so the collection renders one.
        out[key] = [sample];
        report.added = true;
      }
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
  for (const [name, sub] of shape.objects) {
    const r = syncDataObject(current[name], sub);
    out[name] = r.value;
    if (r.changed || !hasOwn(current, name)) changed = true;
  }
  for (const [name, sub] of shape.collections) {
    const existing = current[name];
    if (Array.isArray(existing)) {
      // Preserve the user's items; prune-sync each one's fields to the item-shape.
      out[name] = existing.map((item) => {
        const r = syncDataObject(item, sub);
        if (r.changed) changed = true;
        return r.value;
      });
    } else {
      out[name] = [buildModel(sub)];
      changed = true;
    }
  }

  // PRUNE: any key on `current` the shape no longer has is stale — drop it.
  for (const key of Object.keys(current)) {
    if (!hasOwn(out, key)) changed = true;
  }
  return { value: out, changed };
}

/**
 * Reconcile the user's current model against `shape`, returning the next model and
 * whether anything changed. TWO different rules apply, by ownership:
 *
 *   - The component's OWN tokens (root scalars + `forEach` collections) merge
 *     ADDITIVELY — add what's missing, never overwrite, never prune (a removed token
 *     leaves a harmless leftover). This is {@link mergeModel}'s long-standing behavior.
 *   - A nested-component `data=` OBJECT is prune-SYNCED to the child's shape (see
 *     {@link syncDataObject}) — it mirrors the component, so stale keys are removed —
 *     wherever it appears: at the root, or inside a `forEach` item.
 *
 * Pruning is confined to the data objects; a component's own model is never pruned.
 */
export function reconcileModel(current: unknown, shape: ModelShape): { model: unknown; changed: boolean } {
  if (!isPlainObject(current)) {
    // No top-level object to reconcile against — leave the user's value alone.
    return { model: current, changed: false };
  }
  const { model: mergedRaw, added } = mergeModel(current, shape);
  const merged = isPlainObject(mergedRaw) ? mergedRaw : current;
  const out: Record<string, unknown> = { ...merged };
  let changed = added;

  // Root-level data objects: prune-sync to the child shape.
  for (const [name, sub] of shape.objects) {
    const r = syncDataObject(out[name], sub);
    if (r.changed) {
      out[name] = r.value;
      changed = true;
    }
  }
  // Data objects living inside the component's own `forEach` items.
  for (const [name, itemShape] of shape.collections) {
    if (itemShape.objects.size === 0) continue;
    const arr = out[name];
    if (!Array.isArray(arr)) continue;
    let arrChanged = false;
    const items = arr.map((item) => {
      if (!isPlainObject(item)) return item;
      const copy = { ...item };
      for (const [objName, objShape] of itemShape.objects) {
        const r = syncDataObject(copy[objName], objShape);
        if (r.changed) {
          copy[objName] = r.value;
          arrChanged = true;
        }
      }
      return copy;
    });
    if (arrChanged) {
      out[name] = items;
      changed = true;
    }
  }
  return { model: changed ? out : current, changed };
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
