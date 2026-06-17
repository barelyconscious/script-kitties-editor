import { describe, expect, it } from "vitest";
import { deleteComponentArgs, shouldCloseOpen } from "./deleteComponent";
import type { GuiComponentRef } from "./guiTree";

/** A component ref with overridable fields for the args tests. */
function ref(over: Partial<GuiComponentRef> = {}): GuiComponentRef {
  return {
    name: "bag",
    fileName: "bag.xml",
    path: "widgets/bag.xml",
    kind: "widget",
    controllerFileName: null,
    ...over,
  };
}

describe("deleteComponentArgs", () => {
  it("passes the controller hint through when present", () => {
    const args = deleteComponentArgs(ref({ controllerFileName: "bag_controller.lua" }));
    expect(args).toEqual({ name: "bag", controllerFileName: "bag_controller.lua" });
  });

  it("sends a null controller hint for a controller-less component", () => {
    const args = deleteComponentArgs(ref({ name: "plain", controllerFileName: null }));
    expect(args).toEqual({ name: "plain", controllerFileName: null });
  });

  it("normalizes an undefined controller hint to null", () => {
    // A ref missing the field entirely must not send `undefined` over the bridge.
    const bare = { name: "x", fileName: "x.xml", path: "x.xml", kind: "view" } as GuiComponentRef;
    expect(deleteComponentArgs(bare).controllerFileName).toBeNull();
  });
});

describe("shouldCloseOpen", () => {
  it("closes when the deleted component is the open one", () => {
    expect(shouldCloseOpen("bag", "bag")).toBe(true);
  });

  it("does not close when a different component is open", () => {
    expect(shouldCloseOpen("other", "bag")).toBe(false);
  });

  it("does not close when nothing is open", () => {
    expect(shouldCloseOpen(null, "bag")).toBe(false);
  });
});
