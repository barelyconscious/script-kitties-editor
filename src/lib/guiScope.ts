/**
 * guiScope — the pure, unit-testable SCOPE STACK that powers `forEach`'s scoped
 * data context (F4).
 *
 * F3 resolved every `{token}` against a single flat root model
 * ({@link import("./guiBinding").flatRootScope}). F4 adds repetition: a node
 * carrying `forEach="{collection}"` is STAMPED once per item, and inside a
 * repeated subtree bare tokens must resolve against the *current item*, not the
 * root. This module supplies the {@link import("./guiBinding").ResolveScope}
 * that makes that work, WITHOUT touching the resolver's logic — the resolver
 * only ever calls `scope.lookup(token)`.
 *
 * The locked semantics (design/xgui_ta.md — "forEach semantics resolved (c)"):
 *
 *   - **Bare token `{name}`** resolves against the NEAREST enclosing item scope
 *     ONLY. If the item has no such field, it stays UNRESOLVED — there is NO
 *     fall-through to the root model. (Silent root fall-through is the accidental
 *     coupling the design explicitly rejects: a typo'd item field must not
 *     quietly grab unrelated root data.)
 *   - **`$.` prefix** (`{$.currency}`) reaches the ROOT model — the stack bottom —
 *     irrespective of nesting depth. There is exactly one root. A bare `$` (no
 *     dot, no path) denotes the root object itself.
 *   - **Nesting composes by LEXICAL SHADOWING:** entering a `forEach` subtree
 *     PUSHES the current item; leaving POPS it. The nearest enclosing item wins;
 *     there is NO `parent`/`..` escape to an intermediate scope — only the
 *     current item (bare) and the root (`$.`) are reachable.
 *
 * The stack is IMMUTABLE/persistent: {@link ScopeStack.push} returns a new stack
 * sharing structure with its parent, so the renderer can descend without mutating
 * shared state (each child branch gets its own derived stack). The bottom frame is
 * the root model; every pushed frame is a `forEach` item.
 *
 * This module is PURE (no React, no DOM). Stamping (turning a template node + a
 * bound collection into N instance render-units) lives in `guiForEach.ts`, which
 * consumes this stack.
 *
 * @see design/xgui_ta.md — "Repetition and control flow (`forEach`)" and
 *   "`forEach` semantics resolved (c) Scoped data context".
 */

import type { ResolveScope } from "./guiBinding";

/**
 * Own-property check that works regardless of the TS lib target. `Object.hasOwn`
 * is es2022; the project's lib target predates it (see `guiBinding.ts`), so we use
 * the prototype-method form, matching that module.
 */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * The `$` root-escape prefix. `{$.currency}` reaches the root model's `currency`;
 * a bare `{$}` denotes the root object itself.
 */
const ROOT_PREFIX = "$";

/**
 * Read a (possibly dotted) field path off a value. `path` is the text after the
 * `$.` prefix, e.g. `"currency"` for `{$.currency}` or `"theme.accent"` for
 * `{$.theme.accent}`. An empty path (`{$}`) returns the value itself.
 *
 * Each segment is an OWN-property hit only — no prototype walking, no array index
 * coercion beyond what `hasOwn` allows. A miss anywhere along the path returns
 * `undefined` (→ unresolved). A non-object encountered mid-path is also a miss.
 */
function readPath(value: unknown, path: string): unknown {
  if (path === "") return value;
  let current = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    const obj = current as Record<string, unknown>;
    if (!hasOwn(obj, segment)) return undefined;
    current = obj[segment];
  }
  return current;
}

/**
 * Look a BARE token up on a single item scope — an own-property hit only, no
 * fall-through. A non-object item (a scalar/array/null item) has no bindable
 * NAMED fields, so every bare token misses (→ unresolved). Arrays are excluded
 * for the same reason F3's `flatRootScope` excludes them: a bare `{token}` is a
 * field name, not a numeric index. This is the per-frame rule; the stack chooses
 * WHICH frame a token reads from.
 */
function lookupBare(item: unknown, token: string): unknown {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
  const obj = item as Record<string, unknown>;
  return hasOwn(obj, token) ? obj[token] : undefined;
}

/**
 * An immutable scope stack: the root model at the bottom, a `forEach` item per
 * pushed frame. Bare tokens read the TOP frame (current item); `$.`-prefixed
 * tokens read the BOTTOM frame (root). Pushing returns a new stack that shares
 * the parent's frames — descending the tree never mutates a shared stack.
 */
export class ScopeStack {
  /** Stack frames, bottom (root) first, current item last. Never empty. */
  private readonly frames: ReadonlyArray<unknown>;

  private constructor(frames: ReadonlyArray<unknown>) {
    this.frames = frames;
  }

  /**
   * Start a stack at the ROOT model (the Data Model panel's parsed JSON). With no
   * `forEach` pushed, the current item IS the root, so bare tokens resolve against
   * the root exactly as F3's flat-root scope did — F4 is a strict superset.
   */
  static root(model: unknown): ScopeStack {
    return new ScopeStack([model]);
  }

  /**
   * Enter a `forEach` subtree: push `item` as the new current scope, returning a
   * NEW stack (the parent is untouched). Bare tokens inside the returned stack
   * resolve against `item`; `$.` still reaches the original root. Repeated pushes
   * shadow lexically — the most-recently-pushed item is the current one.
   */
  push(item: unknown): ScopeStack {
    return new ScopeStack([...this.frames, item]);
  }

  /** The current item scope (top frame) — what bare tokens resolve against. */
  get current(): unknown {
    return this.frames[this.frames.length - 1];
  }

  /** The root model (bottom frame) — what `$.`-prefixed tokens resolve against. */
  get root(): unknown {
    return this.frames[0];
  }

  /** Stack depth (1 = root only, no `forEach` entered). */
  get depth(): number {
    return this.frames.length;
  }

  /**
   * Resolve a token under the F4 rules. `token` is the text BETWEEN the braces:
   *
   *   - `"$"` / `"$.path"` → read `path` off the ROOT model (`""` → the root
   *     object itself). The `$` escape is depth-independent.
   *   - any other `"name"` / `"name.path"` → read off the CURRENT item ONLY, with
   *     NO fall-through to the root. A miss stays `undefined` (→ unresolved).
   *
   * A bare token may itself be dotted (`{stats.hp}`) — it walks the path on the
   * current item. (The `forEach` collection token is resolved this same way, so
   * `forEach="{a.b}"` reads `a.b` off the enclosing scope.)
   */
  lookup(token: string): unknown {
    if (token === ROOT_PREFIX) return this.root;
    if (token.startsWith(`${ROOT_PREFIX}.`)) {
      return readPath(this.root, token.slice(ROOT_PREFIX.length + 1));
    }
    // Bare token — current item only, no root fall-through. Dotted bare tokens
    // walk a path on the item; a plain name is the one-segment case.
    if (token.includes(".")) {
      const [head, ...rest] = token.split(".");
      const headValue = lookupBare(this.current, head);
      return readPath(headValue, rest.join("."));
    }
    return lookupBare(this.current, token);
  }

  /**
   * Adapt this stack to the F3 {@link ResolveScope} the binding resolver consumes.
   * The resolver only calls `lookup`, so this is a thin pass-through that lets the
   * existing `resolveAttrs`/`resolveAttr` code work unchanged against item scopes.
   */
  asScope(): ResolveScope {
    return { lookup: (token: string) => this.lookup(token) };
  }
}
