/**
 * controllerScript — pure helpers for the Controller tab's Add-script flow (F10).
 * Kept free of React and Monaco so the filename logic is unit-testable without
 * pulling in the editor (Monaco needs a DOM `window` at import time).
 *
 * @see design/xgui_ta.md — section 4 "Main content — tabbed (View / Controller)".
 */

import { toComponentBasename } from "./guiTree";

/**
 * The starter body a freshly-added controller is seeded with. The runtime calls
 * a controller as `controller(view, model)` — `model` is optional (Lua has no
 * optional-param syntax, so `function(view, model)` *is* the optional form; the
 * runtime may pass one arg or two) — and expects it to return its handler table.
 * Controllers commonly call `view:setModel(...)` to set/project the model, so we
 * scaffold that shape (the wrapper, a commented `setModel` hint, and an empty
 * handler table) rather than an empty file — the author fills in the table
 * instead of remembering the wrapper.
 */
export const NEW_CONTROLLER_TEMPLATE = `return function(view, model)
    -- view:setModel(...)
    return {}
end
`;

/**
 * The sensible default controller filename for a component: its snake_case name
 * with a `_controller.lua` suffix (design section 4: default name
 * `{component_name_in_snake_case}_controller.lua`). The user may edit it before
 * adding.
 */
export function defaultControllerFileName(componentName: string): string {
  return `${toComponentBasename(componentName)}_controller.lua`;
}

/**
 * Normalize a user-entered controller name into a `.lua` filename. A name that
 * already ends in `.lua` is kept as-is (so a hand-typed name is not double-
 * suffixed); a blank input yields an empty string (the Add button is disabled).
 */
export function normalizeControllerFileName(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  return trimmed.endsWith(".lua") ? trimmed : `${trimmed}.lua`;
}

/**
 * The controller-function names a controller source EXPORTS — the candidate
 * handler names the Properties panel's `handler` dropdown offers (#504) and the
 * handler-exists lint checks (B4). A controller is shaped as
 * `return function(view) … return { name = function(self, mouse) … end, … } end`,
 * so its exports are the keys of the returned table literal.
 *
 * This is a REGEX-level parse, deliberately not a Lua parser: it matches every
 * `name = function(…)` assignment in the source and returns the `name`s in
 * source order, de-duplicated. That captures the returned-table keys (the real
 * exports) AND any handler assigned to a named local (`local onClick =
 * function…`) — both are plausible handler targets, and this powers a dropdown +
 * a warn-only hint, not correctness, so a superset of names is acceptable and
 * safe. `return function(view)` (the outer wrapper) is NOT matched, since it has
 * no `name =` before `function`.
 */
export function exportedFunctionNames(source: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const re = /(\w+)\s*=\s*function\b/g;
  let match: RegExpExecArray | null = re.exec(source);
  while (match !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    match = re.exec(source);
  }
  return names;
}
