/**
 * guiBinding — the pure, unit-testable render-time value resolver for the XGUI
 * preview (F3).
 *
 * A `GuiNode`'s attributes are stored verbatim as raw strings (see `guiNode.ts`):
 * a value may be a LITERAL (`"0.5"`, `"185,178,165,255"`, `"TextDefault"`) or a
 * BINDING (`"{healthRatio}"`, `"Health: {health}/{maxHealth}"`). This module
 * turns those raw strings into the concrete values the renderer paints, applying
 * the design's resolution order:
 *
 *   1. a `{token}` binds from the data model
 *        - whole-value for TYPED props (colors, numbers, booleans, a single
 *          position/size field): the token must be the ENTIRE value, e.g.
 *          `backgroundColor="{barColor}"`, `visible="{isOpen}"`;
 *        - interpolation for STRING props (`text`, `texture`): tokens embedded
 *          in a string are substituted in place, e.g.
 *          `text="Health: {health}/{maxHealth}"` → `"Health: 15/25"`.
 *   2. a PALETTE NAME (a bare identifier matching a palette key) resolves to its
 *      color code — applies to color props only.
 *   3. otherwise the value is a LITERAL, passed through unchanged.
 *
 * Compound `position`/`size` resolve PER FIELD: each of the four comma-separated
 * fields is independently a `{token}` (whole-value bind) or a literal, e.g.
 * `size="{healthRatio},1,0,0"` binds scale-x and leaves the rest literal.
 *
 * UNRESOLVED tokens (a `{token}` with no matching model field, or a palette name
 * that the palette doesn't define) render LITERALLY-BUT-STYLED — the "waiting for
 * a binding" affordance. This module's job is to REPORT whether a value resolved;
 * the styling lives in the renderer.
 *
 * SCOPE: resolution follows the XGUI binding grammar (three scopes, each with a
 * dotted field-access and a whole-object form):
 *
 *   - **View / local** — `$.` prefix. `{$.creature.sprite}` walks the component's
 *     model by dotted path; `{$.}` is the whole model. Valid anywhere (see
 *     {@link viewScope}).
 *   - **Grid item** — bare (no prefix). `{sprite}` reads the CURRENT GridLayout
 *     item; `{.}` is the whole item. Valid ONLY inside a GridLayout child — a bare
 *     token anywhere else is STRICT-unresolved (engine parity: bare demotes to
 *     grid-only). Inside a grid child the item and View frames are BOTH live at
 *     once, so `{sprite}` hits the item AND `{$.x}` still reaches the View model
 *     (see {@link gridItemScope}).
 *   - **Named** — `$name.` prefix. `{$app.theme}` / `{$app.}` reach an ancestor
 *     frame published under `name`. Recognized but DEFERRED (zero shipped usage,
 *     no ancestor to resolve against in an isolated preview) — always unresolved,
 *     never a crash.
 *
 * Every resolve entry point takes a {@link ResolveScope} — an opaque lookup of
 * token → value — rather than a bare object, so the resolution rules stay
 * independent of how the lookup is sourced (View frame, grid item, or a composite
 * of the two).
 *
 * This module is PURE (no React, no DOM, no palette fetching). Palette fetching
 * is the caller's job (it passes a resolved palette map in); see `guiPalette.ts`
 * for the module-cached fetch hook.
 *
 * @see design/xgui_ta.md — "Data binding (`{token}` on properties)" and
 *   "Colors and the palette".
 */

/**
 * A resolution scope: the lookup a `{token}` resolves against — a View frame (see
 * {@link viewScope}), a composite grid-item frame ({@link gridItemScope}), or an
 * empty-cell frame ({@link emptyItemScope}). The resolver only ever calls
 * `lookup(token)`, so the rules here stay independent of how the lookup is sourced.
 *
 * `lookup` returns the bound value for a token body (the text BETWEEN the braces,
 * e.g. `"$.creature.name"` for `{$.creature.name}`), or `undefined` when the token
 * is unbound. The scope interprets the binding grammar (`$.`/bare/`.`/`$name.`); the
 * returned value is stringified by the resolver for interpolation/whole-value use.
 */
export type ResolveScope = {
  lookup(token: string): unknown;
};

/** A resolved palette: a flat `name → "r,g,b,a"` color-code map. */
export type Palette = Record<string, string>;

/** Own-property check that works regardless of the TS lib target (`Object.hasOwn` is es2022). */
function hasOwn(obj: object, key: string): boolean {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs es2022 lib; the build's tsc target is lower.
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * The binding grammar parsed from the text BETWEEN a token's braces: which frame it
 * names (`view`/`item`/`named`) and the dotted path into that frame (an empty path
 * is the whole-object form).
 *
 * Exported so the model scaffold (`guiModelScaffold.ts`) classifies tokens through
 * the SAME grammar the resolver binds against — one grammar, one classifier.
 */
export type ScopeRef =
  | { frame: "view"; path: string[] }
  | { frame: "item"; path: string[] }
  | { frame: "named"; name: string; path: string[] };

/**
 * Parse a token body into a {@link ScopeRef}. Pure string grammar — no model access:
 *
 *   `$.`              → view, whole   (path `[]`)
 *   `$.creature.name` → view, path `["creature","name"]`
 *   `$app.theme`      → named "app", path `["theme"]`
 *   `$app.`           → named "app", whole (path `[]`)
 *   `.`               → item, whole   (path `[]`)
 *   `sprite`          → item, path `["sprite"]`
 *
 * `$.` (view) is distinguished from `$name.` (named) by the character after `$`: a
 * dot means the anonymous View frame, anything else starts a scope name.
 */
export function parseScopeRef(token: string): ScopeRef {
  const t = token.trim();
  if (t.startsWith("$.")) return { frame: "view", path: splitPath(t.slice(2)) };
  if (t.startsWith("$")) {
    const rest = t.slice(1);
    const dot = rest.indexOf(".");
    if (dot === -1) return { frame: "named", name: rest, path: [] };
    return { frame: "named", name: rest.slice(0, dot), path: splitPath(rest.slice(dot + 1)) };
  }
  if (t === ".") return { frame: "item", path: [] };
  return { frame: "item", path: splitPath(t) };
}

/** Split a dotted path body into keys; `""` (the whole-object form) → `[]`. */
function splitPath(body: string): string[] {
  return body === "" ? [] : body.split(".");
}

/**
 * Walk `root` by a dotted path (own-properties only; array indices work). An empty
 * path yields `root` itself (the whole-object form). A missing key or a non-object
 * value mid-walk yields `undefined` (→ unresolved).
 */
function walkPath(root: unknown, path: string[]): unknown {
  let cur = root;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (!hasOwn(cur as object, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Build a {@link ResolveScope} for a `<View>` frame — the component's own data
 * model. This is the default scope for every component and for anything OUTSIDE a
 * GridLayout child.
 *
 *   - `{$.a.b}` → `model.a.b` (dotted walk); `{$.}` → the whole model.
 *   - bare `{x}` / `{.}` → UNRESOLVED. STRICT engine-parity: a bare token only
 *     resolves inside a grid item (see {@link gridItemScope}); at the View level it
 *     is a miss (the bare-at-root lint lives in a separate task).
 *   - `{$name.x}` → UNRESOLVED (named scopes are recognized but deferred — there is
 *     no ancestor to resolve against in an isolated preview).
 */
export function viewScope(model: unknown): ResolveScope {
  return {
    lookup(token: string): unknown {
      const ref = parseScopeRef(token);
      return ref.frame === "view" ? walkPath(model, ref.path) : undefined;
    },
  };
}

/**
 * Build a COMPOSITE {@link ResolveScope} for a GridLayout child: the current grid
 * `item` frame layered OVER the enclosing `view` frame. Both frames are live at
 * once — the crux of the grid grammar:
 *
 *   - bare `{x}` / `{.}` → the grid ITEM (`item.x` / the whole item);
 *   - `{$.x}` / `{$.}` and `{$name.x}` → DELEGATE to the enclosing View frame. The
 *     item does NOT shadow `$.`, so a grid child can still read the component model.
 *
 * `view` is the enclosing {@link viewScope} (delegating to it — rather than
 * re-reading a raw model — keeps the two-frame layering explicit and composable).
 */
export function gridItemScope(item: unknown, view: ResolveScope): ResolveScope {
  return {
    lookup(token: string): unknown {
      const ref = parseScopeRef(token);
      return ref.frame === "item" ? walkPath(item, ref.path) : view.lookup(token);
    },
  };
}

/**
 * Build a {@link ResolveScope} for an EMPTY grid cell (a `null` grid item — e.g. an
 * empty inventory slot).
 *
 * Every token resolves to the EMPTY STRING (`""`) rather than `undefined`. That
 * distinction is the whole point: a `""` is a successful resolution, so
 * resolveStringProp/resolveTypedProp/resolveColorProp/resolveCompoundProp all
 * report `resolved: true` and the cell does NOT render the amber waiting-for-binding
 * affordance. The cell renders the template's LITERAL chrome only, with every
 * `{token}` collapsing to "" (e.g. `text="{name}"` → "", `texture="{sprite}"` → ""
 * with no load, `backgroundColor="{c}"` → "" → no fill). Non-token literal attrs
 * (e.g. a slot's `backgroundColor="50,50,50,255"`) are untouched and still paint.
 *
 * Contrast with a live `viewScope`/`gridItemScope`, whose `lookup` returns
 * `undefined` for an unbound token — that marks each token UNRESOLVED, which is
 * exactly the waiting affordance an empty cell must NOT show. Every token form
 * (`{sprite}`, `{$.x}`, `{.}`) collapses to "" here. See
 * design/gridLayout_element_design_prompt.md (caveat 5): missing cells render
 * template chrome with tokens resolving to "".
 */
export function emptyItemScope(): ResolveScope {
  return {
    lookup(): unknown {
      return "";
    },
  };
}

/** Matches a whole-value binding: the entire string is a single `{token}`. */
const WHOLE_TOKEN = /^\{([^{}]+)\}$/;

/** Matches each embedded `{token}` for string interpolation. */
const EMBEDDED_TOKEN = /\{([^{}]+)\}/g;

/**
 * Whether a raw value is a whole-value `{token}` binding (the entire string is a
 * single brace-wrapped token, no surrounding text). `"{x}"` is; `"a {x}"` and
 * `"{x}{y}"` are not.
 */
export function isWholeToken(raw: string): boolean {
  return WHOLE_TOKEN.test(raw.trim());
}

/** Whether a raw value contains at least one `{token}` anywhere. */
export function hasToken(raw: string): boolean {
  EMBEDDED_TOKEN.lastIndex = 0;
  return EMBEDDED_TOKEN.test(raw);
}

/**
 * Resolve a whole-value `{token}` to its BOUND VALUE (unstringified) — for the
 * object-valued consumers that need the raw bound object/array rather than a
 * rendered string: a `<Component data="{$.x}">` base model and a
 * `<GridLayout dataCollection="{$.items}">` collection.
 *
 * Returns the bound value, or `undefined` when `raw` is not a single whole `{token}`
 * or the token is unbound. Unlike {@link resolveStringProp} it does NOT stringify,
 * so an object/array binding survives intact. The token body obeys the full binding
 * grammar, so `data="{$.creature}"`, `data="{.}"` (whole grid item), and
 * `dataCollection="{$.creatures}"` all resolve through the passed scope.
 */
export function resolveWholeTokenValue(raw: string, scope: ResolveScope): unknown {
  const whole = WHOLE_TOKEN.exec(raw.trim());
  return whole ? scope.lookup(whole[1]) : undefined;
}

/**
 * Stringify a bound model value for substitution into a string-typed property.
 *
 * Numbers and booleans render as their natural string form (`15`, `true`).
 * Strings pass through. Objects/arrays are JSON-stringified (a defensive fallback
 * — authors are expected to supply scalar bindings for string props). `null` and
 * `undefined` render as the empty string.
 */
function stringifyBound(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * The outcome of resolving one raw value: the concrete `value` to render plus
 * whether every token in it resolved.
 *
 * - `resolved: true` — the value is fully concrete (a literal, a fully-bound
 *   token, or a string whose every embedded token bound). Render it normally.
 * - `resolved: false` — at least one token did not bind (or a color value matched
 *   neither a palette key nor a literal code). The renderer paints `value` but
 *   styles it as a waiting-for-binding affordance. `value` is the best-effort
 *   literal: the raw text with bound tokens substituted and unbound tokens left
 *   as their literal `{token}` form.
 */
export type Resolved = {
  value: string;
  resolved: boolean;
};

/**
 * Resolve a STRING-typed property (`text`, `texture`) via interpolation.
 *
 * Every embedded `{token}` is replaced by its bound value; literal text around
 * the tokens is preserved. A token with no binding is left as the literal
 * `{token}` and marks the whole value unresolved (styled-but-literal).
 *
 * Examples (model `{health:15,maxHealth:25}`):
 *   `"Health: {health}/{maxHealth}"` → `{ value: "Health: 15/25", resolved: true }`
 *   `"icon_{type}.png"` (no `type`)  → `{ value: "icon_{type}.png", resolved: false }`
 *   `"Bag"` (no tokens)              → `{ value: "Bag", resolved: true }`
 */
export function resolveStringProp(raw: string, scope: ResolveScope): Resolved {
  let allResolved = true;
  const value = raw.replace(EMBEDDED_TOKEN, (_match, token: string) => {
    const bound = scope.lookup(token);
    if (bound === undefined) {
      allResolved = false;
      return `{${token}}`; // leave the literal token in place, styled by the caller
    }
    return stringifyBound(bound);
  });
  return { value, resolved: allResolved };
}

/**
 * Resolve a TYPED non-color property (`visible`, `fontSize`, `layer`, a single
 * `position`/`size` field, `borderSize`, `textAlign`) — WHOLE-VALUE only.
 *
 * If the raw value is a single `{token}`, it must bind to the entire value; the
 * bound value is stringified for the renderer to parse (it stays a string here so
 * geometry/number/boolean parsing remains one code path in the renderer). An
 * unbound whole-token is unresolved. A value that is not a whole token is a
 * literal, passed through unchanged. (An embedded token in a typed prop —
 * `fontSize="x{n}"` — is NOT interpolated: typed props are whole-value only, so
 * it is treated as the literal string it is.)
 */
export function resolveTypedProp(raw: string, scope: ResolveScope): Resolved {
  const trimmed = raw.trim();
  const whole = WHOLE_TOKEN.exec(trimmed);
  if (whole) {
    const bound = scope.lookup(whole[1]);
    if (bound === undefined) {
      // Unresolved: keep the literal token form so it renders styled-but-literal.
      return { value: raw, resolved: false };
    }
    return { value: stringifyBound(bound), resolved: true };
  }
  // No whole token → literal pass-through (typed props don't interpolate).
  return { value: raw, resolved: true };
}

/**
 * Resolve a COLOR property (`backgroundColor`, `borderColor`, `color`) to an
 * `r,g,b,a` code string, applying the full three-step rule:
 *
 *   1. `{token}` → bind from the model (whole-value). The bound value is taken as
 *      the color code (a `"r,g,b,a"` string) — or, if it is itself a palette name,
 *      it is NOT re-resolved here (the model supplies finished codes; that mirrors
 *      the "no format specifiers, controller pre-formats" stance). Unbound → unresolved.
 *   2. else a PALETTE NAME — a bare identifier matching a palette key — resolves
 *      to that key's color code.
 *   3. else a LITERAL color code (`"185,178,165,255"`), passed through.
 *
 * Palette keys are identifiers and codes are numeric, so a value that is neither a
 * token, a known palette key, nor a numeric code (e.g. an unknown palette name) is
 * UNRESOLVED — it renders styled-but-literal, surfacing a typo'd/removed palette
 * reference rather than silently painting nothing.
 *
 * @param palette the resolved `name → code` map (empty map = no named colors).
 */
export function resolveColorProp(
  raw: string,
  scope: ResolveScope,
  palette: Readonly<Palette>,
): Resolved {
  const trimmed = raw.trim();

  // (1) Whole-value token binding.
  const whole = WHOLE_TOKEN.exec(trimmed);
  if (whole) {
    const bound = scope.lookup(whole[1]);
    if (bound === undefined) return { value: raw, resolved: false };
    return { value: stringifyBound(bound), resolved: true };
  }

  // (2) Palette-name lookup. Palette keys are identifiers; a numeric code can't
  // be a key, so a numeric value falls straight through to the literal branch.
  if (hasOwn(palette, trimmed)) {
    return { value: palette[trimmed], resolved: true };
  }

  // (3) Literal color code, or an UNRESOLVED palette reference.
  if (isColorCode(trimmed)) {
    return { value: trimmed, resolved: true };
  }
  // A non-numeric, non-token value that didn't match a palette key is a dangling
  // palette reference (renamed/removed/typo) — styled-but-literal.
  return { value: raw, resolved: false };
}

/** Whether a trimmed string is an `r,g,b,a` (or `r,g,b`) numeric color code. */
function isColorCode(value: string): boolean {
  if (value === "") return false;
  const parts = value.split(",");
  if (parts.length < 3 || parts.length > 4) return false;
  return parts.every((p) => {
    const n = Number(p.trim());
    return Number.isFinite(n);
  });
}

/**
 * Convert a resolved `r,g,b,a` (or `r,g,b`) color code into a CSS `rgba(...)`
 * string the renderer can apply directly.
 *
 * - `"185,178,165,255"` → `"rgba(185,178,165,1)"` (alpha 0–255 → 0–1).
 * - `"0,0,0"` (no alpha) → `"rgba(0,0,0,1)"` (opaque).
 * - `undefined`/empty/non-code (e.g. a still-unresolved `{token}` left literal) →
 *   `undefined`, so the caller leaves the property unset (transparent default).
 *
 * Kept here next to {@link isColorCode} so color parsing lives in one place; the
 * renderer never hand-parses codes.
 */
export function colorCodeToCss(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!isColorCode(trimmed)) return undefined;
  const parts = trimmed.split(",").map((p) => Number(p.trim()));
  const [r, g, b, a = 255] = parts;
  const alpha = Math.max(0, Math.min(1, a / 255));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Resolve a COMPOUND `position`/`size` value PER FIELD.
 *
 * The four comma-separated fields (`relX,relY,absX,absY`) each resolve
 * independently as a whole-value typed field: a field that is a `{token}` binds
 * from the model; any other field is a literal. This is what makes data-driven
 * sizing work — `size="{healthRatio},1,0,0"` binds scale-x and fixes the rest.
 *
 * Returns the re-joined comma string (with bound fields substituted and unbound
 * `{token}` fields left literal) plus whether EVERY field resolved. The renderer
 * feeds the joined string into the existing geometry parser (`parseUDim2`), so an
 * unbound field's literal `{token}` falls back to `0` for layout while the value
 * is flagged unresolved for styling.
 *
 * Examples (model `{healthRatio:0.5}`):
 *   `"{healthRatio},1,0,0"`        → `{ value: "0.5,1,0,0", resolved: true }`
 *   `"{missing},1,0,0"`            → `{ value: "{missing},1,0,0", resolved: false }`
 *   `"0.5,1,0,0"` (all literal)    → `{ value: "0.5,1,0,0", resolved: true }`
 */
export function resolveCompoundProp(raw: string, scope: ResolveScope): Resolved {
  const fields = raw.split(",");
  let allResolved = true;
  const resolvedFields = fields.map((field) => {
    const trimmed = field.trim();
    const whole = WHOLE_TOKEN.exec(trimmed);
    if (!whole) return field; // literal field — preserve verbatim (whitespace too)
    const bound = scope.lookup(whole[1]);
    if (bound === undefined) {
      allResolved = false;
      return field; // leave the literal {token} so geometry falls back + styling triggers
    }
    return stringifyBound(bound);
  });
  return { value: resolvedFields.join(","), resolved: allResolved };
}

/**
 * The set of attribute names that are COLOR-typed — resolved via the palette
 * three-step rule rather than as plain typed values.
 */
const COLOR_PROPS = new Set(["backgroundColor", "borderColor", "color"]);

/** The set of attribute names that are STRING-typed — interpolation, not whole-value. */
const STRING_PROPS = new Set(["text", "texture"]);

/** The set of COMPOUND attribute names — per-field resolution. */
const COMPOUND_PROPS = new Set(["position", "size"]);

/**
 * The set of LITERAL-ONLY (structural / identity) attributes — never resolved,
 * always passed through verbatim. Binding these would change WHO an element is or
 * WHAT it is wired to, not how it looks (see design "presentation vs. structure").
 */
const LITERAL_ONLY_PROPS = new Set([
  "id",
  "src",
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
 * Resolve a single attribute by NAME, dispatching to the right resolution rule:
 * literal-only → verbatim; color prop → palette three-step; string prop →
 * interpolation; compound prop → per-field; everything else → whole-value typed.
 *
 * This is the one entry point the renderer calls per attribute; the per-kind
 * functions above are exported for direct unit testing and reuse.
 */
export function resolveAttr(
  name: string,
  raw: string,
  scope: ResolveScope,
  palette: Readonly<Palette>,
): Resolved {
  if (LITERAL_ONLY_PROPS.has(name)) return { value: raw, resolved: true };
  if (COLOR_PROPS.has(name)) return resolveColorProp(raw, scope, palette);
  if (STRING_PROPS.has(name)) return resolveStringProp(raw, scope);
  if (COMPOUND_PROPS.has(name)) return resolveCompoundProp(raw, scope);
  return resolveTypedProp(raw, scope);
}

/**
 * A node's attributes resolved into the concrete strings the renderer paints,
 * plus the names of any attributes that did not fully resolve (so the renderer
 * can apply the waiting-for-binding affordance where it matters — e.g. dimmed
 * text, a styled box).
 *
 * Resolving the whole attribute bag in one pass (rather than per-consumer) keeps
 * the renderer thin: it reads `attrs.position` etc. exactly as before, but off the
 * resolved bag instead of the raw one.
 */
export type ResolvedAttrs = {
  /** Resolved attribute values, keyed by attribute name. */
  attrs: Record<string, string>;
  /** Attribute names that contained at least one unresolved token/reference. */
  unresolved: Set<string>;
};

/**
 * Resolve every attribute of a node against the scope + palette, returning the
 * concrete attribute bag plus the set of attributes that didn't fully resolve.
 *
 * Pure and order-preserving: the returned `attrs` has the same keys as the input.
 */
export function resolveAttrs(
  rawAttrs: Readonly<Record<string, string>>,
  scope: ResolveScope,
  palette: Readonly<Palette>,
): ResolvedAttrs {
  const attrs: Record<string, string> = {};
  const unresolved = new Set<string>();
  for (const [name, raw] of Object.entries(rawAttrs)) {
    const result = resolveAttr(name, raw, scope, palette);
    attrs[name] = result.value;
    if (!result.resolved) unresolved.add(name);
  }
  return { attrs, unresolved };
}
