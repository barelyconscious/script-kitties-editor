import { describe, expect, it } from "vitest";
import {
  FOCUS_HANDLER_ATTRS,
  hasFocusHandlers,
  hasTooltip,
  isFocusable,
  isHitTestable,
  isModal,
  MOUSE_HANDLER_ATTRS,
  supportsMouseEvents,
} from "./guiInteraction";
import type { GuiNode } from "./guiNode";

/** Build a minimal Panel {@link GuiNode} carrying just the given attributes. */
function panel(attrs: Record<string, string>): GuiNode {
  return { nodeId: "n1", tag: "Panel", attrs, children: [] };
}

describe("supportsMouseEvents", () => {
  it("is false with no handlers", () => {
    expect(supportsMouseEvents(panel({}))).toBe(false);
  });

  it.each(MOUSE_HANDLER_ATTRS)("is true when %s is a non-empty handler", (attr) => {
    expect(supportsMouseEvents(panel({ [attr]: "onClick" }))).toBe(true);
  });

  it("ignores non-mouse handlers", () => {
    expect(supportsMouseEvents(panel({ onKeyPressed: "onKey", onFocus: "f" }))).toBe(false);
  });

  it("treats an explicit empty handler as absent (mirrors engine .empty())", () => {
    expect(supportsMouseEvents(panel({ onMouseClicked: "" }))).toBe(false);
  });

  it("treats a whitespace-only handler as present (engine does NOT trim)", () => {
    expect(supportsMouseEvents(panel({ onMouseClicked: " " }))).toBe(true);
  });
});

describe("hasFocusHandlers", () => {
  it("is false with no handlers", () => {
    expect(hasFocusHandlers(panel({}))).toBe(false);
  });

  it.each(FOCUS_HANDLER_ATTRS)("is true when %s is a non-empty handler", (attr) => {
    expect(hasFocusHandlers(panel({ [attr]: "handler" }))).toBe(true);
  });

  it("ignores mouse handlers — they do NOT imply focus", () => {
    for (const attr of MOUSE_HANDLER_ATTRS) {
      expect(hasFocusHandlers(panel({ [attr]: "m" }))).toBe(false);
    }
  });

  it("treats an explicit empty focus handler as absent", () => {
    expect(hasFocusHandlers(panel({ onFocus: "" }))).toBe(false);
  });
});

describe("hasTooltip", () => {
  it("is true for a non-empty tooltip ref", () => {
    expect(hasTooltip(panel({ tooltip: "tip.xml" }))).toBe(true);
  });

  it("is false when absent or empty", () => {
    expect(hasTooltip(panel({}))).toBe(false);
    expect(hasTooltip(panel({ tooltip: "" }))).toBe(false);
  });
});

describe("isModal (pugixml as_bool, first-char only)", () => {
  it.each([
    "1",
    "t",
    "T",
    "true",
    "True",
    "y",
    "Y",
    "yes",
    "Yes",
  ])("treats %s as modal (first char in 1/t/T/y/Y)", (value) => {
    expect(isModal(panel({ modal: value }))).toBe(true);
  });

  it.each(["0", "f", "false", "no", "n", "off", ""])("treats %s as NOT modal", (value) => {
    expect(isModal(panel({ modal: value }))).toBe(false);
  });

  it("does NOT accept 'on' — pugixml checks first char only, 'o' is not truthy", () => {
    // The task/design prose called 'on' truthy; the ENGINE (pugixml as_bool) does not.
    expect(isModal(panel({ modal: "on" }))).toBe(false);
  });

  it("is not modal when the attribute is absent", () => {
    expect(isModal(panel({}))).toBe(false);
  });

  it("does not resolve a bound token — modal is read pre-binding as a literal", () => {
    expect(isModal(panel({ modal: "{isModal}" }))).toBe(false);
  });
});

describe("isHitTestable (SupportsMouseEvents || HasTooltip || IsModal — XGUI.cpp:20)", () => {
  it("is false for an inert element", () => {
    expect(isHitTestable(panel({ id: "x" }))).toBe(false);
  });

  it("mouse-only element is hit-testable", () => {
    expect(isHitTestable(panel({ onMouseClicked: "click" }))).toBe(true);
  });

  it("tooltip-only element is hit-testable (no handlers needed)", () => {
    expect(isHitTestable(panel({ tooltip: "tip.xml" }))).toBe(true);
  });

  it("modal-only element is hit-testable", () => {
    expect(isHitTestable(panel({ modal: "true" }))).toBe(true);
  });

  it("focus-handler-only element is NOT hit-testable (focus does not grant hit-test)", () => {
    expect(isHitTestable(panel({ onKeyPressed: "key" }))).toBe(false);
    expect(isHitTestable(panel({ onFocus: "f" }))).toBe(false);
    expect(isHitTestable(panel({ onBlur: "b" }))).toBe(false);
  });
});

describe("isFocusable (ReceivesFocus = bModal || bReceivesFocus — XGUI.h:155)", () => {
  it("mouse-only element is NOT focusable", () => {
    expect(isFocusable(panel({ onMouseClicked: "click" }))).toBe(false);
  });

  it.each(FOCUS_HANDLER_ATTRS)("is focusable with a %s handler", (attr) => {
    expect(isFocusable(panel({ [attr]: "handler" }))).toBe(true);
  });

  it("modal element is focusable even without focus handlers", () => {
    expect(isFocusable(panel({ modal: "true" }))).toBe(true);
  });

  it("tooltip-only element is NOT focusable (hit-testable but not focus)", () => {
    expect(isFocusable(panel({ tooltip: "tip.xml" }))).toBe(false);
  });

  it("inert element is not focusable", () => {
    expect(isFocusable(panel({}))).toBe(false);
  });
});
