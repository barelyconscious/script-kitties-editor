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
});
