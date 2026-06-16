import { describe, expect, it } from "vitest";
import type { GuiNode } from "../../lib/guiNode";
import { type EditorState, editorReducer, type OpenComponent } from "./editorState";

function node(tag: GuiNode["tag"] = "View"): GuiNode {
  return { nodeId: "n1", tag, attrs: {}, children: [] };
}

function openDoc(overrides: Partial<OpenComponent> = {}): OpenComponent {
  return {
    name: "bag",
    path: "widgets/bag.xml",
    controllerFileName: null,
    root: node(),
    modelText: "{}",
    controllerText: null,
    ...overrides,
  };
}

const CLEAN: EditorState = {
  open: null,
  selectedNodeId: null,
  activeTab: "view",
  dirty: false,
};

describe("editorReducer", () => {
  it("open seats the component and resets selection/tab/dirty", () => {
    const dirtyState: EditorState = {
      open: openDoc({ name: "old" }),
      selectedNodeId: "n9",
      activeTab: "controller",
      dirty: true,
    };
    const next = editorReducer(dirtyState, { type: "open", component: openDoc({ name: "bag" }) });
    expect(next.open?.name).toBe("bag");
    expect(next.selectedNodeId).toBeNull();
    expect(next.activeTab).toBe("view");
    expect(next.dirty).toBe(false);
  });

  it("close returns to the empty state", () => {
    const state: EditorState = {
      open: openDoc(),
      selectedNodeId: "n1",
      activeTab: "view",
      dirty: true,
    };
    expect(editorReducer(state, { type: "close" })).toEqual(CLEAN);
  });

  it("select updates the shared selection without touching dirty", () => {
    const state: EditorState = { ...CLEAN, open: openDoc() };
    const next = editorReducer(state, { type: "select", nodeId: "n5" });
    expect(next.selectedNodeId).toBe("n5");
    expect(next.dirty).toBe(false);
    // Clearing the selection is supported.
    expect(editorReducer(next, { type: "select", nodeId: null }).selectedNodeId).toBeNull();
  });

  it("setTab switches the active tab", () => {
    const state: EditorState = { ...CLEAN, open: openDoc() };
    expect(editorReducer(state, { type: "setTab", tab: "controller" }).activeTab).toBe(
      "controller",
    );
  });

  it("setModelText updates the model text but does NOT mark dirty", () => {
    const state: EditorState = { ...CLEAN, open: openDoc() };
    const next = editorReducer(state, { type: "setModelText", text: '{"health":5}' });
    expect(next.open?.modelText).toBe('{"health":5}');
    expect(next.dirty).toBe(false);
  });

  it("setModelText is a no-op when nothing is open", () => {
    expect(editorReducer(CLEAN, { type: "setModelText", text: "{}" })).toBe(CLEAN);
  });

  it("replaceRoot swaps the tree and marks dirty", () => {
    const state: EditorState = { ...CLEAN, open: openDoc() };
    const fresh = node("View");
    const next = editorReducer(state, { type: "replaceRoot", root: fresh });
    expect(next.open?.root).toBe(fresh);
    expect(next.dirty).toBe(true);
  });

  it("replaceRoot is a no-op when nothing is open", () => {
    expect(editorReducer(CLEAN, { type: "replaceRoot", root: node() })).toBe(CLEAN);
  });

  it("markSaved clears dirty after a save", () => {
    const state: EditorState = { ...CLEAN, open: openDoc(), dirty: true };
    expect(editorReducer(state, { type: "markSaved" }).dirty).toBe(false);
  });

  it("addChildNode appends under the parent, selects the new node, and marks dirty", () => {
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }) };
    const child: GuiNode = { nodeId: "new", tag: "Panel", attrs: {}, children: [] };
    const next = editorReducer(state, { type: "addChildNode", parentNodeId: "root", child });
    expect(next.open?.root.children[0]).toBe(child);
    expect(next.selectedNodeId).toBe("new");
    expect(next.dirty).toBe(true);
  });

  it("addChildNode is a no-op (no dirty, no selection move) when the parent is missing", () => {
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }), selectedNodeId: "root" };
    const child: GuiNode = { nodeId: "new", tag: "Panel", attrs: {}, children: [] };
    const next = editorReducer(state, { type: "addChildNode", parentNodeId: "ghost", child });
    expect(next).toBe(state);
  });

  it("addChildNode is a no-op when nothing is open", () => {
    const child: GuiNode = { nodeId: "new", tag: "Panel", attrs: {}, children: [] };
    expect(editorReducer(CLEAN, { type: "addChildNode", parentNodeId: "x", child })).toBe(CLEAN);
  });

  it("setNodeAttrs replaces the node's attrs and marks dirty", () => {
    const child: GuiNode = { nodeId: "c", tag: "Panel", attrs: { id: "old" }, children: [] };
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [child] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }) };
    const next = editorReducer(state, {
      type: "setNodeAttrs",
      nodeId: "c",
      attrs: { id: "new", position: "0,0,0,0" },
    });
    expect(next.open?.root.children[0].attrs).toEqual({ id: "new", position: "0,0,0,0" });
    expect(next.dirty).toBe(true);
  });

  it("setNodeAttrs is a no-op (no dirty) when the node is missing", () => {
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }) };
    const next = editorReducer(state, {
      type: "setNodeAttrs",
      nodeId: "ghost",
      attrs: { id: "x" },
    });
    expect(next).toBe(state);
  });

  it("setNodeAttrs is a no-op when nothing is open", () => {
    expect(editorReducer(CLEAN, { type: "setNodeAttrs", nodeId: "x", attrs: {} })).toBe(CLEAN);
  });

  it("removeNode detaches the node and marks dirty", () => {
    const e1: GuiNode = { nodeId: "e1", tag: "Event", attrs: {}, children: [] };
    const e2: GuiNode = { nodeId: "e2", tag: "Event", attrs: {}, children: [] };
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [e1, e2] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }) };
    const next = editorReducer(state, { type: "removeNode", nodeId: "e1" });
    expect(next.open?.root.children.map((c) => c.nodeId)).toEqual(["e2"]);
    expect(next.dirty).toBe(true);
  });

  it("removeNode clears the selection when the removed node was selected", () => {
    const e1: GuiNode = { nodeId: "e1", tag: "Event", attrs: {}, children: [] };
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [e1] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }), selectedNodeId: "e1" };
    const next = editorReducer(state, { type: "removeNode", nodeId: "e1" });
    expect(next.selectedNodeId).toBeNull();
  });

  it("removeNode preserves an unrelated selection", () => {
    const e1: GuiNode = { nodeId: "e1", tag: "Event", attrs: {}, children: [] };
    const e2: GuiNode = { nodeId: "e2", tag: "Event", attrs: {}, children: [] };
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [e1, e2] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }), selectedNodeId: "e2" };
    const next = editorReducer(state, { type: "removeNode", nodeId: "e1" });
    expect(next.selectedNodeId).toBe("e2");
  });

  it("removeNode is a no-op (no dirty) when the node is missing", () => {
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }) };
    expect(editorReducer(state, { type: "removeNode", nodeId: "ghost" })).toBe(state);
  });

  it("removeNode is a no-op when nothing is open", () => {
    expect(editorReducer(CLEAN, { type: "removeNode", nodeId: "x" })).toBe(CLEAN);
  });

  it("stores an Event's name/handler verbatim (no validation/normalization)", () => {
    // The events panel is intentionally thin: whatever the user types is stored as
    // an <Event> node's attrs, untouched — even a namespaced/colon-bearing name and
    // a handler that may not exist anywhere.
    const event: GuiNode = {
      nodeId: "e1",
      tag: "Event",
      attrs: { name: "", handler: "" },
      children: [],
    };
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [event] };
    const state: EditorState = { ...CLEAN, open: openDoc({ root }) };
    const next = editorReducer(state, {
      type: "setNodeAttrs",
      nodeId: "e1",
      attrs: { name: "Battle:OnCreatureDied", handler: "doesNotExistYet" },
    });
    expect(next.open?.root.children[0].attrs).toEqual({
      name: "Battle:OnCreatureDied",
      handler: "doesNotExistYet",
    });
  });

  describe("controller (F10)", () => {
    it("loadControllerText seats the on-disk text WITHOUT marking dirty", () => {
      const state: EditorState = {
        ...CLEAN,
        open: openDoc({ controllerFileName: "bag_controller.lua", controllerText: null }),
      };
      const next = editorReducer(state, {
        type: "loadControllerText",
        text: "function onLoad() end",
      });
      expect(next.open?.controllerText).toBe("function onLoad() end");
      expect(next.dirty).toBe(false);
    });

    it("loadControllerText is a no-op when nothing is open", () => {
      expect(editorReducer(CLEAN, { type: "loadControllerText", text: "x" })).toBe(CLEAN);
    });

    it("setControllerText updates the draft and marks dirty", () => {
      const state: EditorState = {
        ...CLEAN,
        open: openDoc({ controllerFileName: "bag_controller.lua", controllerText: "" }),
      };
      const next = editorReducer(state, { type: "setControllerText", text: "print('hi')" });
      expect(next.open?.controllerText).toBe("print('hi')");
      expect(next.dirty).toBe(true);
    });

    it("setControllerText is a no-op when nothing is open", () => {
      expect(editorReducer(CLEAN, { type: "setControllerText", text: "x" })).toBe(CLEAN);
    });

    it("addController sets the <View controller> attr, seeds an empty buffer, flips tab, dirties", () => {
      const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [] };
      const state: EditorState = {
        ...CLEAN,
        open: openDoc({ root, controllerFileName: null, controllerText: null }),
        activeTab: "view",
      };
      const next = editorReducer(state, {
        type: "addController",
        fileName: "bag_controller.lua",
      });
      expect(next.open?.root.attrs.controller).toBe("bag_controller.lua");
      expect(next.open?.controllerFileName).toBe("bag_controller.lua");
      expect(next.open?.controllerText).toBe("");
      expect(next.activeTab).toBe("controller");
      expect(next.dirty).toBe(true);
    });

    it("addController preserves the View's existing attributes", () => {
      const root: GuiNode = {
        nodeId: "root",
        tag: "View",
        attrs: { id: "bag", layer: "2" },
        children: [],
      };
      const state: EditorState = {
        ...CLEAN,
        open: openDoc({ root, controllerFileName: null }),
      };
      const next = editorReducer(state, { type: "addController", fileName: "c.lua" });
      expect(next.open?.root.attrs).toEqual({ id: "bag", layer: "2", controller: "c.lua" });
    });

    it("addController is a no-op when the component already has a controller", () => {
      const state: EditorState = {
        ...CLEAN,
        open: openDoc({ controllerFileName: "existing.lua" }),
      };
      const next = editorReducer(state, { type: "addController", fileName: "new.lua" });
      expect(next).toBe(state);
    });

    it("addController is a no-op when nothing is open", () => {
      expect(editorReducer(CLEAN, { type: "addController", fileName: "x.lua" })).toBe(CLEAN);
    });

    it("open seats the component's own controller fields and clears dirty", () => {
      const next = editorReducer(CLEAN, {
        type: "open",
        component: openDoc({
          controllerFileName: "bag_controller.lua",
          controllerText: "loaded",
        }),
      });
      expect(next.open?.controllerFileName).toBe("bag_controller.lua");
      expect(next.open?.controllerText).toBe("loaded");
      expect(next.dirty).toBe(false);
    });
  });
});
