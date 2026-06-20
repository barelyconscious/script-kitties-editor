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
 * a controller as `controller(view)` and expects it to return its handler table,
 * so we scaffold that shape (an empty table) rather than an empty file — the
 * author fills in the table instead of remembering the wrapper.
 */
export const NEW_CONTROLLER_TEMPLATE = `return function(view)
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
