/**
 * openComponent — the pure open-flow core: turn a component's XML text (from
 * `get_component`, B5) plus its list-time ref into the {@link OpenComponent} the
 * shared editor store seats. Kept separate from the React panel so the parse +
 * controller-reconciliation logic is unit-testable without rendering.
 *
 * Controller reconciliation: the list ref carries a sibling-convention guess
 * (`{name}_controller.lua` if present); the authoritative reference is the
 * `<View controller=…>` attribute, available only once the file is parsed. This
 * builder prefers the parsed attribute and falls back to the ref's guess —
 * implementing the design's "the open-time parse reconciles the actual
 * controller attr."
 *
 * @see design/xgui_ta.md — subsection (2): controllerFileName resolution.
 */

import { type GuiNode, parseGui } from "../../lib/guiNode";
import type { OpenComponent } from "./editorState";
import type { GuiComponentRef } from "./guiTree";

/**
 * Build an {@link OpenComponent} from a component ref and its raw XML text.
 *
 * Parses the XML (throwing {@link GuiParseError} on malformed input — the caller
 * surfaces it), then reconciles the controller filename: the parsed
 * `<View controller=…>` attribute wins; absent that, the ref's sibling-convention
 * guess is used; otherwise `null`. The Data Model text defaults to an empty
 * object so the preview renders with no bindings until the user supplies one.
 */
export function buildOpenComponent(ref: GuiComponentRef, xml: string): OpenComponent {
  const root = parseGui(xml);
  return {
    name: ref.name,
    path: ref.path,
    controllerFileName: resolveControllerName(root, ref),
    root,
    modelText: "{}",
  };
}

/**
 * Reconcile the controller filename: the `<View controller=…>` attribute is
 * authoritative; fall back to the ref's sibling-convention guess; else `null`.
 * A blank/whitespace-only attribute is treated as absent.
 */
export function resolveControllerName(root: GuiNode, ref: GuiComponentRef): string | null {
  const attr = root.tag === "View" ? root.attrs.controller : undefined;
  if (attr && attr.trim().length > 0) return attr.trim();
  return ref.controllerFileName ?? null;
}
