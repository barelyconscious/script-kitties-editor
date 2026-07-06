/**
 * guiInteraction — the pure, unit-testable derivation of an element's
 * INTERACTION CAPABILITIES (hit-testable / focusable / modal), mirroring the
 * `worlds-cpp` XGUI runtime VERBATIM so the editor's badges and preview report
 * exactly what the shipped engine will do at runtime.
 *
 * This is the single definition consumed by the structure tree (per-node
 * badges) and, optionally, the preview — the `guiZOrder` pattern: no React, no
 * IO, no schema dependency. It reads RAW `GuiNode.attrs` strings only, so it is
 * independent of the binding/schema layers.
 *
 * ── Ground truth (sibling repo `worlds-cpp`, branch `xgui`) ────────────────
 * The rules below are pinned to ENGINE SOURCE, not design-doc prose. If the
 * engine changes, the cited line moves and the unit tests here should fail.
 *
 * Handler presence — `XWidget::On*()` accessors (GUILoader.cpp:815-883):
 *   each reads `Node.attribute("onX").value()` and returns `nullopt` when the
 *   string `.empty()`, else the string. So a handler "counts" IFF its attribute
 *   value is NON-EMPTY. A MISSING attribute (`.value()` → `""`) and an EXPLICIT
 *   empty (`onMouseClicked=""`) both read empty → do NOT count. The engine does
 *   NOT trim: a whitespace-only value (`onMouseClicked=" "`) is non-empty →
 *   DOES count. We mirror `.empty()` exactly (non-empty ⟺ length > 0, no trim).
 *
 * SupportsMouseEvents — `FInputHandlers` ctor (XGUI.h:58-61):
 *   `OnMouseMoved || OnMouseEntered || OnMouseExited || OnMouseClicked`.
 *
 * bReceivesFocus (the handler part of focus) — ctor (XGUI.h:62-65):
 *   `bSupportsKeyEvents(=OnKeyPressed) || OnFocus || OnBlur`. Mouse handlers do
 *   NOT imply focus.
 *
 * Modal — `XWidget::Modal()` (GUILoader.cpp:810-813):
 *   `Node.attribute("modal").as_bool()`, read PRE-binding (straight off the XML
 *   attribute, never through the runtime binding system). So `modal` is a
 *   LITERAL boolean — a `{token}` never resolves here. pugixml `as_bool`
 *   (`get_value_bool`) inspects ONLY the first character and is truthy for
 *   `'1' | 't' | 'T' | 'y' | 'Y'` (covers `1`, `true`/`True`, `yes`/`Yes`, and
 *   bare `t`/`T`/`y`/`Y`). NOTE: the task/design prose mentioned `"on"` as
 *   truthy — pugixml does NOT accept it (`'o'` is not in the set), and we mirror
 *   the ENGINE, so `modal="on"` is NOT modal.
 *
 * HasTooltip — `Element::HasTooltip()` (XGUI.h:150) is `Tooltip.get()`, which is
 *   non-null only when the tooltip element was built, and that build is gated on
 *   a NON-EMPTY `tooltip` attribute (GUILoader.cpp:354-355). So hit-test's
 *   tooltip clause ⟺ non-empty `tooltip` attr.
 *
 * Hit-test — `FindTopmostElement` (XGUI.cpp:20):
 *   `SupportsMouseEvents() || HasTooltip() || IsModal()`. The non-obvious
 *   clause: a Panel with ONLY a `tooltip` (no handlers) is STILL hit-testable.
 *
 * Focus — `Element::ReceivesFocus()` (XGUI.h:155):
 *   `bModal || Handlers.bReceivesFocus`. Modal ALSO implies focusable in the
 *   engine, so {@link isFocusable} includes it. (The tree's keyboard badge is
 *   instead driven by {@link hasFocusHandlers} — the handler-only signal — so a
 *   modal-only element reads as modal, not spuriously "keyboard".)
 *
 * @see design/xgui_ta.md — interaction attributes; but the ENGINE files above
 *   are the source of truth when they disagree.
 */

import type { GuiNode } from "./guiNode";

/** The mouse-input handler attributes that feed `SupportsMouseEvents` (XGUI.h:58-61). */
export const MOUSE_HANDLER_ATTRS = [
  "onMouseMoved",
  "onMouseEntered",
  "onMouseExited",
  "onMouseClicked",
] as const;

/**
 * The handler attributes that feed `bReceivesFocus` (XGUI.h:62-65):
 * `onKeyPressed` (also `bSupportsKeyEvents`), `onFocus`, `onBlur`. Mouse
 * handlers are deliberately absent — they do not imply focus.
 */
export const FOCUS_HANDLER_ATTRS = ["onKeyPressed", "onFocus", "onBlur"] as const;

/** The attribute naming a tooltip component ref; non-empty ⟺ the element has a tooltip. */
export const TOOLTIP_ATTR = "tooltip";

/** The literal boolean attribute declaring an element modal (read pre-binding via `as_bool`). */
export const MODAL_ATTR = "modal";

/**
 * Mirror the engine's `!HandlerName.empty()` test: an attribute "counts" iff its
 * value is a non-empty string. A missing attribute (`undefined`) and an explicit
 * empty string both read as empty. Whitespace is NOT trimmed — a whitespace-only
 * value is non-empty and counts, exactly as the engine's `.empty()` would.
 */
function hasNonEmptyAttr(node: GuiNode, attr: string): boolean {
  const raw = node.attrs[attr];
  return raw !== undefined && raw !== "";
}

/**
 * `SupportsMouseEvents()` — any mouse handler attribute is non-empty (XGUI.h:58-61
 * via GUILoader.cpp:815-853).
 */
export function supportsMouseEvents(node: GuiNode): boolean {
  return MOUSE_HANDLER_ATTRS.some((attr) => hasNonEmptyAttr(node, attr));
}

/**
 * `bReceivesFocus` (the HANDLER part of focus) — any of `onKeyPressed` /
 * `onFocus` / `onBlur` is non-empty (XGUI.h:62-65). Does NOT include modal; use
 * {@link isFocusable} for the engine's full `ReceivesFocus()`.
 */
export function hasFocusHandlers(node: GuiNode): boolean {
  return FOCUS_HANDLER_ATTRS.some((attr) => hasNonEmptyAttr(node, attr));
}

/**
 * `HasTooltip()` — the `tooltip` attribute is non-empty (the runtime only builds
 * the tooltip element for a non-empty ref; GUILoader.cpp:354-355).
 */
export function hasTooltip(node: GuiNode): boolean {
  return hasNonEmptyAttr(node, TOOLTIP_ATTR);
}

/**
 * `IsModal()` — pugixml `as_bool` of the LITERAL `modal` attribute
 * (GUILoader.cpp:810-813). Truthy iff the first character is one of
 * `'1' | 't' | 'T' | 'y' | 'Y'` (pugixml `get_value_bool`). Read pre-binding, so
 * a `{token}` value is never resolved — it simply isn't truthy.
 */
export function isModal(node: GuiNode): boolean {
  const first = node.attrs[MODAL_ATTR]?.[0];
  return first === "1" || first === "t" || first === "T" || first === "y" || first === "Y";
}

/**
 * `FindTopmostElement`'s hit test (XGUI.cpp:20):
 * `SupportsMouseEvents() || HasTooltip() || IsModal()`. A tooltip-only or
 * modal-only element (no handlers) is still hit-testable.
 */
export function isHitTestable(node: GuiNode): boolean {
  return supportsMouseEvents(node) || hasTooltip(node) || isModal(node);
}

/**
 * `Element::ReceivesFocus()` (XGUI.h:155): `bModal || bReceivesFocus`. Modal
 * elements receive focus even without focus handlers; mouse handlers never grant
 * focus. See {@link hasFocusHandlers} for the handler-only signal the tree badge
 * uses.
 */
export function isFocusable(node: GuiNode): boolean {
  return isModal(node) || hasFocusHandlers(node);
}
