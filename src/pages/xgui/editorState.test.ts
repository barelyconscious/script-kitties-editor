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
  past: [],
  future: [],
  lastCoalesceKey: null,
};

describe("editorReducer", () => {
  it("open seats the component and resets selection/tab/dirty", () => {
    const dirtyState: EditorState = {
      ...CLEAN,
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
      ...CLEAN,
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

  describe("reloadOpen (F13 live external-edit sync)", () => {
    it("replaces the open doc, sets the remapped selection, and clears dirty", () => {
      const state: EditorState = {
        ...CLEAN,
        open: openDoc({ root: { nodeId: "old", tag: "View", attrs: {}, children: [] } }),
        selectedNodeId: "old-sel",
        activeTab: "view",
        dirty: true,
      };
      const reloaded = openDoc({
        root: { nodeId: "new", tag: "View", attrs: { id: "x" }, children: [] },
      });
      const next = editorReducer(state, {
        type: "reloadOpen",
        component: reloaded,
        selectedNodeId: "new-sel",
      });
      expect(next.open?.root.nodeId).toBe("new");
      expect(next.open?.root.attrs).toEqual({ id: "x" });
      expect(next.selectedNodeId).toBe("new-sel");
      // The editor now matches disk — nothing unsaved.
      expect(next.dirty).toBe(false);
    });

    it("PRESERVES the active tab (a live swap must not yank the user off Controller)", () => {
      const state: EditorState = {
        ...CLEAN,
        open: openDoc(),
        selectedNodeId: null,
        activeTab: "controller",
        dirty: false,
      };
      const next = editorReducer(state, {
        type: "reloadOpen",
        component: openDoc(),
        selectedNodeId: null,
      });
      expect(next.activeTab).toBe("controller");
    });

    it("drops a dangling selection when the node is gone (selectedNodeId null)", () => {
      const state: EditorState = {
        ...CLEAN,
        open: openDoc(),
        selectedNodeId: "was-selected",
        activeTab: "view",
        dirty: false,
      };
      const next = editorReducer(state, {
        type: "reloadOpen",
        component: openDoc(),
        selectedNodeId: null,
      });
      expect(next.selectedNodeId).toBeNull();
    });

    it("is a no-op when nothing is open", () => {
      const next = editorReducer(CLEAN, {
        type: "reloadOpen",
        component: openDoc(),
        selectedNodeId: null,
      });
      expect(next).toBe(CLEAN);
    });
  });

  describe("undo/redo history (task 470)", () => {
    // A small tree: root <View> with two <Panel> children, so attr edits and
    // structural edits both have something to bite on.
    function tree(): GuiNode {
      return {
        nodeId: "root",
        tag: "View",
        attrs: {},
        children: [
          { nodeId: "a", tag: "Panel", attrs: { id: "a" }, children: [] },
          { nodeId: "b", tag: "Panel", attrs: { id: "b" }, children: [] },
        ],
      };
    }

    function opened(): EditorState {
      return editorReducer(CLEAN, { type: "open", component: openDoc({ root: tree() }) });
    }

    it("a fresh open starts with empty history", () => {
      const s = opened();
      expect(s.past).toEqual([]);
      expect(s.future).toEqual([]);
      expect(s.lastCoalesceKey).toBeNull();
    });

    it("setNodeAttrs pushes one undo step; undo restores the prior attrs and re-dirties", () => {
      const s0 = opened();
      const s1 = editorReducer(s0, {
        type: "setNodeAttrs",
        nodeId: "a",
        attrs: { id: "a-renamed" },
      });
      expect(s1.past).toHaveLength(1);
      expect(s1.dirty).toBe(true);

      const undone = editorReducer(s1, { type: "undo" });
      // The edited node is back to its original attrs.
      expect(undone.open?.root.children[0].attrs).toEqual({ id: "a" });
      expect(undone.past).toHaveLength(0);
      expect(undone.future).toHaveLength(1);
      // Undo moves away from the seated state → dirty.
      expect(undone.dirty).toBe(true);
    });

    it("redo replays an undone step and re-pushes it onto past", () => {
      const s0 = opened();
      const s1 = editorReducer(s0, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "x" } });
      const undone = editorReducer(s1, { type: "undo" });
      const redone = editorReducer(undone, { type: "redo" });
      expect(redone.open?.root.children[0].attrs).toEqual({ id: "x" });
      expect(redone.past).toHaveLength(1);
      expect(redone.future).toHaveLength(0);
      expect(redone.dirty).toBe(true);
    });

    it("undo is a no-op when the past stack is empty", () => {
      const s = opened();
      expect(editorReducer(s, { type: "undo" })).toBe(s);
    });

    it("redo is a no-op when the future stack is empty", () => {
      const s0 = opened();
      const s1 = editorReducer(s0, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "x" } });
      // No prior undo → nothing to redo.
      expect(editorReducer(s1, { type: "redo" })).toBe(s1);
    });

    it("a drag gesture (same coalesceKey) collapses to ONE undo step", () => {
      let s = opened();
      const key = "drag:a:123";
      // Simulate many pointermoves writing position on node "a".
      for (let i = 1; i <= 5; i++) {
        s = editorReducer(s, {
          type: "setNodeAttrs",
          nodeId: "a",
          attrs: { id: "a", position: `0,0,${i},${i}` },
          coalesceKey: key,
        });
      }
      // Five moves, ONE undo step.
      expect(s.past).toHaveLength(1);
      const undone = editorReducer(s, { type: "undo" });
      // One undo returns all the way to the pre-gesture position (no position attr).
      expect(undone.open?.root.children[0].attrs).toEqual({ id: "a" });
      expect(undone.past).toHaveLength(0);
    });

    it("a DIFFERENT coalesceKey opens a new step (two gestures = two undos)", () => {
      let s = opened();
      s = editorReducer(s, {
        type: "setNodeAttrs",
        nodeId: "a",
        attrs: { id: "a", position: "0,0,1,1" },
        coalesceKey: "drag:a:1",
      });
      s = editorReducer(s, {
        type: "setNodeAttrs",
        nodeId: "a",
        attrs: { id: "a", position: "0,0,2,2" },
        coalesceKey: "drag:a:2",
      });
      expect(s.past).toHaveLength(2);
    });

    it("commitHistory breaks coalescing so the next same-key edit opens a new step", () => {
      let s = opened();
      s = editorReducer(s, {
        type: "setNodeAttrs",
        nodeId: "a",
        attrs: { id: "a1" },
        coalesceKey: "attr:a:id",
      });
      // Blur commit boundary.
      s = editorReducer(s, { type: "commitHistory" });
      expect(s.lastCoalesceKey).toBeNull();
      s = editorReducer(s, {
        type: "setNodeAttrs",
        nodeId: "a",
        attrs: { id: "a2" },
        coalesceKey: "attr:a:id",
      });
      // The commit boundary split the two bursts into two steps.
      expect(s.past).toHaveLength(2);
    });

    it("a fresh edit AFTER an undo clears the redo stack", () => {
      const s0 = opened();
      const s1 = editorReducer(s0, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "x" } });
      const undone = editorReducer(s1, { type: "undo" });
      expect(undone.future).toHaveLength(1);
      // A brand-new edit invalidates the redo.
      const edited = editorReducer(undone, {
        type: "setNodeAttrs",
        nodeId: "b",
        attrs: { id: "y" },
      });
      expect(edited.future).toHaveLength(0);
      expect(edited.past).toHaveLength(1);
    });

    it("controller-text edits dirty WITHOUT pushing a document-history step (task 472)", () => {
      // Monaco owns the controller buffer's undo, so setControllerText must not
      // appear in the visual document's undo stack.
      let s = editorReducer(CLEAN, {
        type: "open",
        component: openDoc({ controllerFileName: "c.lua", controllerText: "" }),
      });
      s = editorReducer(s, { type: "setControllerText", text: "a" });
      s = editorReducer(s, { type: "setControllerText", text: "ab" });
      s = editorReducer(s, { type: "setControllerText", text: "abc" });
      expect(s.open?.controllerText).toBe("abc");
      expect(s.dirty).toBe(true);
      // No undo step was created by the controller edits.
      expect(s.past).toHaveLength(0);
      expect(s.lastCoalesceKey).toBeNull();
    });

    it("a visual undo does NOT change the controller Lua buffer (task 472)", () => {
      // Open with a controller buffer, make a VISUAL edit, type Lua, then undo
      // the visual edit — the Lua buffer must survive untouched.
      let s = editorReducer(CLEAN, {
        type: "open",
        component: openDoc({
          root: tree(),
          controllerFileName: "c.lua",
          controllerText: "original",
        }),
      });
      // A visual tree edit pushes a document-history step.
      s = editorReducer(s, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "changed" } });
      // The user then edits the Lua (no history step).
      s = editorReducer(s, { type: "setControllerText", text: "edited lua" });
      expect(s.past).toHaveLength(1);
      // Undo the visual edit: the tree reverts, the Lua buffer is preserved.
      const undone = editorReducer(s, { type: "undo" });
      expect(undone.open?.root.children[0].attrs).toEqual({ id: "a" });
      expect(undone.open?.controllerText).toBe("edited lua");
    });

    it("addChildNode and removeNode are each their own undo step", () => {
      const s0 = opened();
      const child: GuiNode = { nodeId: "c", tag: "Panel", attrs: {}, children: [] };
      const added = editorReducer(s0, { type: "addChildNode", parentNodeId: "root", child });
      expect(added.past).toHaveLength(1);
      const removed = editorReducer(added, { type: "removeNode", nodeId: "a" });
      expect(removed.past).toHaveLength(2);
      // Undo the remove → node "a" is back.
      const undoRemove = editorReducer(removed, { type: "undo" });
      expect(undoRemove.open?.root.children.map((c) => c.nodeId)).toContain("a");
      // Undo the add → child "c" is gone.
      const undoAdd = editorReducer(undoRemove, { type: "undo" });
      expect(undoAdd.open?.root.children.map((c) => c.nodeId)).not.toContain("c");
    });

    it("addController is undoable, restoring the controller-less document", () => {
      const s0 = editorReducer(CLEAN, {
        type: "open",
        component: openDoc({ controllerFileName: null, controllerText: null }),
      });
      const added = editorReducer(s0, { type: "addController", fileName: "bag.lua" });
      expect(added.open?.controllerFileName).toBe("bag.lua");
      expect(added.open?.root.attrs.controller).toBe("bag.lua");
      const undone = editorReducer(added, { type: "undo" });
      // Back to controller-less: the VISUAL document reverts — filename and the
      // <View controller> attr are restored to none. The controller TEXT buffer
      // is NOT part of document history (task 472, Monaco owns its undo), so it is
      // left as the empty buffer Add-script seeded; only the tree-level state
      // (filename + attr) is what undo restores.
      expect(undone.open?.controllerFileName).toBeNull();
      expect(undone.open?.root.attrs.controller).toBeUndefined();
      expect(undone.open?.controllerText).toBe("");
    });

    it("preserves the selection across undo when the node still exists", () => {
      const s0 = { ...opened(), selectedNodeId: "b" };
      const s1 = editorReducer(s0, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "x" } });
      const undone = editorReducer(s1, { type: "undo" });
      // Node "b" survives the restore, so the selection holds.
      expect(undone.selectedNodeId).toBe("b");
    });

    it("clears a dangling selection across undo when the node no longer exists", () => {
      const s0 = opened();
      const child: GuiNode = { nodeId: "c", tag: "Panel", attrs: {}, children: [] };
      const added = editorReducer(s0, { type: "addChildNode", parentNodeId: "root", child });
      // "c" was added and auto-selected; undoing the add removes it.
      expect(added.selectedNodeId).toBe("c");
      const undone = editorReducer(added, { type: "undo" });
      expect(undone.open?.root.children.map((n) => n.nodeId)).not.toContain("c");
      expect(undone.selectedNodeId).toBeNull();
    });

    it("RESETS history on open/switch", () => {
      const s0 = opened();
      const s1 = editorReducer(s0, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "x" } });
      expect(s1.past).toHaveLength(1);
      const switched = editorReducer(s1, {
        type: "open",
        component: openDoc({ name: "other", root: tree() }),
      });
      expect(switched.past).toHaveLength(0);
      expect(switched.future).toHaveLength(0);
      expect(switched.lastCoalesceKey).toBeNull();
    });

    it("RESETS history on a live reload (you cannot undo across an external reload)", () => {
      const s0 = opened();
      const s1 = editorReducer(s0, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "x" } });
      const reloaded = editorReducer(s1, {
        type: "reloadOpen",
        component: openDoc({ root: tree() }),
        selectedNodeId: null,
      });
      expect(reloaded.past).toHaveLength(0);
      expect(reloaded.future).toHaveLength(0);
      expect(reloaded.lastCoalesceKey).toBeNull();
    });

    it("RESETS history on close", () => {
      const s0 = opened();
      const s1 = editorReducer(s0, { type: "setNodeAttrs", nodeId: "a", attrs: { id: "x" } });
      const closed = editorReducer(s1, { type: "close" });
      expect(closed.past).toEqual([]);
      expect(closed.future).toEqual([]);
    });

    it("selection/tab changes are NOT undo steps", () => {
      const s0 = opened();
      const selected = editorReducer(s0, { type: "select", nodeId: "a" });
      const tabbed = editorReducer(selected, { type: "setTab", tab: "controller" });
      const modeled = editorReducer(tabbed, { type: "setModelText", text: '{"x":1}' });
      // None of these touched history.
      expect(tabbed.past).toHaveLength(0);
      expect(modeled.past).toHaveLength(0);
    });
  });
});
