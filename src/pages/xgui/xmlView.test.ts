/**
 * Tests the LIVE-DERIVATION contract behind the read-only XML tab (task 476).
 *
 * The XML tab does not hold its own copy of the document — it renders
 * `serializeGui(open.root)` straight off the store's current tree, memoized on the
 * `root` reference. So the guarantee under test is: when the visual editor mutates
 * the tree (through the reducer's tree-edit actions, each of which replaces the
 * `root` reference), serializing the NEW root yields XML that reflects the edit.
 * That is exactly what makes the XML view update as the user edits.
 *
 * These assertions deliberately go through the reducer (not a hand-built tree) so
 * they exercise the same path the editor does: edit action → new root → serialize.
 */

import { describe, expect, it } from "vitest";
import { type GuiNode, serializeGui } from "../../lib/guiNode";
import { type EditorState, editorReducer, type OpenComponent } from "./editorState";

function openDoc(root: GuiNode): OpenComponent {
  return {
    name: "bag",
    path: "widgets/bag.xml",
    controllerFileName: null,
    root,
    modelText: "{}",
    controllerText: null,
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

/** The XML the tab would render for a given state: serialize the live root. */
function liveXml(state: EditorState): string {
  if (!state.open) return "";
  return serializeGui(state.open.root);
}

describe("XML view live derivation (task 476)", () => {
  it("reflects an attribute edit made through the visual editor", () => {
    const root: GuiNode = {
      nodeId: "root",
      tag: "View",
      attrs: { width: "100" },
      children: [],
    };
    const state: EditorState = { ...CLEAN, open: openDoc(root) };

    // Before the edit, the live XML carries the original attribute.
    expect(liveXml(state)).toContain('width="100"');

    // A property edit (F9b) / drag (F7) flows through setNodeAttrs, replacing root.
    const edited = editorReducer(state, {
      type: "setNodeAttrs",
      nodeId: "root",
      attrs: { width: "240" },
    });

    // The XML the tab renders now mirrors the edited tree — live, no separate copy.
    expect(liveXml(edited)).toContain('width="240"');
    expect(liveXml(edited)).not.toContain('width="100"');
  });

  it("reflects an added child node", () => {
    const root: GuiNode = { nodeId: "root", tag: "View", attrs: {}, children: [] };
    const state: EditorState = { ...CLEAN, open: openDoc(root) };
    expect(liveXml(state)).not.toContain("<Panel");

    const child: GuiNode = {
      nodeId: "pnl",
      tag: "Panel",
      attrs: { label: "Go" },
      children: [],
    };
    const next = editorReducer(state, { type: "addChildNode", parentNodeId: "root", child });

    const xml = liveXml(next);
    // The added Panel is auto-assigned a running id (`Panel1`) at insertion, written
    // first in the attrs so it leads the serialized element.
    expect(xml).toContain('<Panel id="Panel1" label="Go"/>');
    // The root now wraps the child rather than being self-closing.
    expect(xml).toContain("<View>");
    expect(xml).toContain("</View>");
  });

  it("reflects a removed node", () => {
    const root: GuiNode = {
      nodeId: "root",
      tag: "View",
      attrs: {},
      children: [{ nodeId: "evt", tag: "Event", attrs: { name: "onLoad" }, children: [] }],
    };
    const state: EditorState = { ...CLEAN, open: openDoc(root) };
    expect(liveXml(state)).toContain("<Event");

    const next = editorReducer(state, { type: "removeNode", nodeId: "evt" });
    expect(liveXml(next)).not.toContain("<Event");
  });

  it("never injects nodeId into the serialized XML", () => {
    const root: GuiNode = { nodeId: "secret-id", tag: "View", attrs: {}, children: [] };
    const state: EditorState = { ...CLEAN, open: openDoc(root) };
    expect(liveXml(state)).not.toContain("secret-id");
    expect(liveXml(state)).not.toContain("nodeId");
  });
});
