import { describe, expect, it } from "vitest";
import { isWholeToken } from "../../lib/guiBinding";
import { type GuiNode, parseGui } from "../../lib/guiNode";
import { COMPONENT_TEMPLATES, DEFAULT_TEMPLATE_ID, templateById } from "./componentTemplates";
import { type LintContext, nodeLints } from "./guiLints";
import { parseCompound } from "./guiProperties";

/** Depth-first find of the first node with a given tag. */
function firstOfTag(root: GuiNode, tag: GuiNode["tag"]): GuiNode | null {
  if (root.tag === tag) return root;
  for (const child of root.children) {
    const found = firstOfTag(child, tag);
    if (found) return found;
  }
  return null;
}

describe("COMPONENT_TEMPLATES", () => {
  it("every template's XML parses losslessly under parseGui", () => {
    for (const template of COMPONENT_TEMPLATES) {
      expect(() => parseGui(template.xml)).not.toThrow();
      expect(parseGui(template.xml).tag).toBe("View");
    }
  });

  it("the default template id resolves to a real template", () => {
    expect(templateById(DEFAULT_TEMPLATE_ID).id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it("templateById falls back to the first (blank) template for an unknown id", () => {
    expect(templateById("does-not-exist")).toBe(COMPONENT_TEMPLATES[0]);
  });

  it("the blank template is an empty View (the dialog's prior default)", () => {
    const blank = templateById("blank");
    const root = parseGui(blank.xml);
    expect(root.tag).toBe("View");
    expect(root.children).toHaveLength(0);
    expect("controller" in root.attrs).toBe(false);
  });
});

describe("tooltip template", () => {
  const tooltip = templateById("tooltip");
  const root = parseGui(tooltip.xml);

  it("is a View > Panel > Text with no controller", () => {
    expect(root.tag).toBe("View");
    expect("controller" in root.attrs).toBe(false);
    const panel = firstOfTag(root, "Panel");
    const text = firstOfTag(root, "Text");
    expect(panel).not.toBeNull();
    expect(text).not.toBeNull();
  });

  it("sizes the panel in absolute pixels (relative width/height zero)", () => {
    const panel = firstOfTag(root, "Panel");
    const { scaleX, scaleY } = parseCompound(panel?.attrs.size);
    expect(scaleX).toBe("0");
    expect(scaleY).toBe("0");
  });

  it("has one bound Text placeholder with a color", () => {
    const text = firstOfTag(root, "Text");
    expect(isWholeToken(text?.attrs.text ?? "")).toBe(true);
    expect(text?.attrs.color).toBeTruthy();
  });

  it("passes the tooltip lints (#506) when referenced as a tooltip component", () => {
    // A widget that references the template as its tooltip: rules 5 (relative root
    // size) and 6 (declares a controller) must NOT fire against this template.
    const referencing: GuiNode = {
      nodeId: "ref",
      tag: "Panel",
      attrs: { tooltip: "tooltip.xml", tooltipData: "{$.creature}" },
      children: [],
    };
    const ctx: LintContext = {
      exportedFunctions: null,
      resolveComponent: () => root,
    };
    const lints = nodeLints(referencing, { insideGrid: false, isGridTemplate: false }, ctx);
    const tooltipWarnings = lints.filter((l) => l.attr === "tooltip");
    expect(tooltipWarnings).toEqual([]);
  });
});
