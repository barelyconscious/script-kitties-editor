import { describe, expect, it } from "vitest";
import type { GuiNode } from "../../lib/guiNode";
import type { OpenComponent } from "./editorState";
import { mainContentMode } from "./MainContentSkeleton";

function open(): OpenComponent {
  const root: GuiNode = { nodeId: "n0", tag: "View", attrs: {}, children: [] };
  return {
    name: "bag",
    path: "widgets/bag.xml",
    controllerFileName: null,
    root,
    modelText: "{}",
  };
}

describe("mainContentMode", () => {
  it("renders the skeleton when nothing is open (no selection / empty gui/)", () => {
    // Both first-run cases — an empty gui/ folder and a not-yet-opened component —
    // reach the main content as `open === null`, so both yield the skeleton.
    expect(mainContentMode(null)).toBe("skeleton");
  });

  it("renders the preview when a component is open", () => {
    expect(mainContentMode(open())).toBe("preview");
  });
});
