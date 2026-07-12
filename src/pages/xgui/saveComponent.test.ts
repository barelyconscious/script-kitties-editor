import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri bridge so saveOpenComponent's invoke("save_component", …) is
// observable and never touches a real backend.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type GuiNode, parseGui, serializeGui } from "../../lib/guiNode";
import type { OpenComponent } from "./editorState";
import {
  buildSaveArgs,
  isOwnControllerSaveEcho,
  isOwnSaveEcho,
  recordSavedComponentXml,
  recordSavedController,
  saveOpenComponent,
} from "./saveComponent";

const SAMPLE_XML = `<View controller="bag_controller.lua">
  <Panel id="root" position="1,0,0,5">
    <Text id="title" text="Bag"/>
  </Panel>
</View>`;

function openComponent(overrides: Partial<OpenComponent> = {}): OpenComponent {
  const root: GuiNode = parseGui(SAMPLE_XML);
  return {
    name: "bag",
    path: "widgets/bag.xml",
    controllerFileName: "bag_controller.lua",
    root,
    modelText: "{}",
    controllerText: "function refresh() end",
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildSaveArgs", () => {
  it("serializes the GuiNode tree to XML (lossless round-trip from the open root)", () => {
    const open = openComponent();
    const args = buildSaveArgs(open);
    // The XML it ships is exactly what serializeGui produces for the open tree.
    expect(args.xml).toBe(serializeGui(open.root));
    // Sanity: a verbatim authored attribute survives into the serialized XML.
    expect(args.xml).toContain('position="1,0,0,5"');
    expect(args.name).toBe("bag");
  });

  it("pairs [controllerFileName, controllerText] when a controller buffer exists", () => {
    const args = buildSaveArgs(
      openComponent({ controllerFileName: "bag_controller.lua", controllerText: "x = 1" }),
    );
    expect(args.controller).toEqual(["bag_controller.lua", "x = 1"]);
  });

  it("pairs an EMPTY controller text (Add-script: empty buffer still creates the file)", () => {
    const args = buildSaveArgs(
      openComponent({ controllerFileName: "new_controller.lua", controllerText: "" }),
    );
    // "" is a real, persistable value — not coerced to null.
    expect(args.controller).toEqual(["new_controller.lua", ""]);
  });

  it("sends a null controller when the buffer is not loaded (controllerText null)", () => {
    const args = buildSaveArgs(
      openComponent({ controllerFileName: "bag_controller.lua", controllerText: null }),
    );
    expect(args.controller).toBeNull();
  });

  it("sends a null controller when the component has no controller filename", () => {
    const args = buildSaveArgs(openComponent({ controllerFileName: null, controllerText: null }));
    expect(args.controller).toBeNull();
  });
});

describe("saveOpenComponent", () => {
  it("invokes save_component with name, serialized xml, and the controller pair", async () => {
    const open = openComponent({ controllerText: "y = 2" });
    await saveOpenComponent(open);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("save_component", {
      name: "bag",
      xml: serializeGui(open.root),
      controller: ["bag_controller.lua", "y = 2"],
    });
  });

  it("passes null controller through to the command when there is no buffer", async () => {
    const open = openComponent({ controllerFileName: null, controllerText: null });
    await saveOpenComponent(open);
    expect(invokeMock).toHaveBeenCalledWith(
      "save_component",
      expect.objectContaining({ name: "bag", controller: null }),
    );
  });

  it("rejects (propagates the backend error) so the caller can keep dirty set", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(saveOpenComponent(openComponent())).rejects.toThrow("disk full");
  });

  it("records the written XML for echo suppression, keyed by component path", async () => {
    const open = openComponent({ path: "widgets/echo_test.xml" });
    await saveOpenComponent(open);
    // The watcher echoes our own write back as a gui-changed event; the recorded
    // bytes let the live-reload listener recognize and ignore it.
    expect(isOwnSaveEcho("widgets/echo_test.xml", serializeGui(open.root))).toBe(true);
    expect(isOwnSaveEcho("widgets/echo_test.xml", "<View/>")).toBe(false);
    expect(isOwnSaveEcho("widgets/never_saved.xml", serializeGui(open.root))).toBe(false);
  });
});

describe("recordSavedController / isOwnControllerSaveEcho", () => {
  it("records the controller text and matches it back as our own echo", () => {
    recordSavedController("widgets/bag.xml", "function refresh() end");
    expect(isOwnControllerSaveEcho("widgets/bag.xml", "function refresh() end")).toBe(true);
    // Different content (a genuine external edit) is not suppressed.
    expect(isOwnControllerSaveEcho("widgets/bag.xml", "function refresh() print(1) end")).toBe(
      false,
    );
    // Unknown path never matches.
    expect(isOwnControllerSaveEcho("widgets/other.xml", "function refresh() end")).toBe(false);
  });

  it("clears the record when saving with no controller (null) so it no longer echoes", () => {
    recordSavedController("widgets/clear.xml", "x = 1");
    expect(isOwnControllerSaveEcho("widgets/clear.xml", "x = 1")).toBe(true);
    // A subsequent save that writes NO controller must drop the stale record — a
    // later external controller edit at this path is then a genuine change.
    recordSavedController("widgets/clear.xml", null);
    expect(isOwnControllerSaveEcho("widgets/clear.xml", "x = 1")).toBe(false);
  });

  it("saveOpenComponent records the controller text for echo suppression", async () => {
    const open = openComponent({
      path: "widgets/ctrl_echo.xml",
      controllerFileName: "bag_controller.lua",
      controllerText: "y = 2",
    });
    await saveOpenComponent(open);
    expect(isOwnControllerSaveEcho("widgets/ctrl_echo.xml", "y = 2")).toBe(true);
  });

  it("saveOpenComponent with no controller clears any prior controller echo record", async () => {
    recordSavedController("widgets/no_ctrl.xml", "stale = 1");
    const open = openComponent({
      path: "widgets/no_ctrl.xml",
      controllerFileName: null,
      controllerText: null,
    });
    await saveOpenComponent(open);
    expect(isOwnControllerSaveEcho("widgets/no_ctrl.xml", "stale = 1")).toBe(false);
  });
});

describe("isOwnSaveEcho", () => {
  it("matches only the exact last-recorded XML for that path", () => {
    recordSavedComponentXml("a.xml", "<View id=\"a\"/>");
    recordSavedComponentXml("b.xml", "<View id=\"b\"/>");
    expect(isOwnSaveEcho("a.xml", "<View id=\"a\"/>")).toBe(true);
    expect(isOwnSaveEcho("b.xml", "<View id=\"b\"/>")).toBe(true);
    // Cross-path content must not match — suppression is per component.
    expect(isOwnSaveEcho("a.xml", "<View id=\"b\"/>")).toBe(false);
  });

  it("tracks only the most recent write per path", () => {
    recordSavedComponentXml("c.xml", "<View id=\"v1\"/>");
    recordSavedComponentXml("c.xml", "<View id=\"v2\"/>");
    expect(isOwnSaveEcho("c.xml", "<View id=\"v1\"/>")).toBe(false);
    expect(isOwnSaveEcho("c.xml", "<View id=\"v2\"/>")).toBe(true);
  });
});
