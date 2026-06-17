import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri bridge so saveOpenComponent's invoke("save_component", …) is
// observable and never touches a real backend.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type GuiNode, parseGui, serializeGui } from "../../lib/guiNode";
import type { OpenComponent } from "./editorState";
import { buildSaveArgs, saveOpenComponent } from "./saveComponent";

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
});
