import { describe, expect, it } from "vitest";
import { GuiParseError } from "../../lib/guiNode";
import type { GuiComponentRef } from "./guiTree";
import { buildOpenComponent, resolveControllerName } from "./openComponent";

function ref(overrides: Partial<GuiComponentRef> = {}): GuiComponentRef {
  return {
    name: "bag",
    fileName: "bag.xml",
    path: "widgets/bag.xml",
    kind: "view",
    controllerFileName: null,
    ...overrides,
  };
}

describe("buildOpenComponent", () => {
  it("parses the XML into a root and carries name/path from the ref", () => {
    const open = buildOpenComponent(ref(), '<View>\n  <Panel id="root"/>\n</View>');
    expect(open.name).toBe("bag");
    expect(open.path).toBe("widgets/bag.xml");
    expect(open.root.tag).toBe("View");
    expect(open.root.children).toHaveLength(1);
    expect(open.root.children[0].attrs.id).toBe("root");
    // Defaults to an empty data model so the preview starts unbound.
    expect(open.modelText).toBe("{}");
  });

  it("propagates a parse error for malformed XML", () => {
    expect(() => buildOpenComponent(ref(), "<Panel/>")).toThrow(GuiParseError);
  });

  it("prefers the parsed <View controller> attribute over the ref guess", () => {
    const open = buildOpenComponent(
      ref({ controllerFileName: "bag_controller.lua" }),
      '<View controller="custom_ctrl.lua"><Panel/></View>',
    );
    expect(open.controllerFileName).toBe("custom_ctrl.lua");
  });

  it("falls back to the ref's sibling-convention guess when no attr is present", () => {
    const open = buildOpenComponent(
      ref({ controllerFileName: "bag_controller.lua" }),
      "<View><Panel/></View>",
    );
    expect(open.controllerFileName).toBe("bag_controller.lua");
  });

  it("yields null when neither the attribute nor the ref names a controller", () => {
    const open = buildOpenComponent(ref({ controllerFileName: null }), "<View/>");
    expect(open.controllerFileName).toBeNull();
  });
});

describe("resolveControllerName", () => {
  it("treats a blank/whitespace controller attribute as absent", () => {
    const root = { nodeId: "n1", tag: "View" as const, attrs: { controller: "   " }, children: [] };
    expect(resolveControllerName(root, ref({ controllerFileName: "fallback.lua" }))).toBe(
      "fallback.lua",
    );
  });
});
