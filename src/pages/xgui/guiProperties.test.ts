import { describe, expect, it } from "vitest";
import type { GuiNode } from "../../lib/guiNode";
import {
  computedId,
  fieldsForTag,
  formatCompound,
  freeformAttrs,
  isBoundField,
  parseCompound,
  removeAttr,
  renameAttr,
  srcBasename,
  withAttr,
} from "./guiProperties";

function node(
  tag: GuiNode["tag"],
  attrs: Record<string, string> = {},
  children: GuiNode[] = [],
): GuiNode {
  return { nodeId: `n-${tag}-${JSON.stringify(attrs)}`, tag, attrs, children };
}

describe("computedId", () => {
  it("dot-joins the authored id chain from root to node", () => {
    const path = [
      node("View", { id: "view" }),
      node("Panel", { id: "stats" }),
      node("Text", { id: "statText" }),
    ];
    expect(computedId(path)).toBe("view.stats.statText");
  });

  it("skips ancestors with no id (no empty segment injected)", () => {
    const path = [
      node("View", { id: "view" }),
      node("Panel", {}), // unnamed wrapper
      node("Text", { id: "statText" }),
    ];
    expect(computedId(path)).toBe("view.statText");
  });

  it("skips blank/whitespace ids", () => {
    const path = [node("View", { id: "view" }), node("Text", { id: "   " })];
    expect(computedId(path)).toBe("view");
  });

  it("returns empty string when no node in the path has an id", () => {
    expect(computedId([node("View"), node("Panel")])).toBe("");
  });

  it("returns empty string for an empty path", () => {
    expect(computedId([])).toBe("");
  });
});

describe("parseCompound / formatCompound round-trip", () => {
  it("splits a four-field comma string into labeled fields verbatim", () => {
    expect(parseCompound("0.5,1,0,5")).toEqual({
      scaleX: "0.5",
      scaleY: "1",
      offsetX: "0",
      offsetY: "5",
    });
  });

  it("preserves {token} fields verbatim", () => {
    expect(parseCompound("{healthRatio},1,0,0")).toEqual({
      scaleX: "{healthRatio}",
      scaleY: "1",
      offsetX: "0",
      offsetY: "0",
    });
  });

  it("trims whitespace around fields", () => {
    expect(parseCompound("0.5, 1 , 0, 5")).toEqual({
      scaleX: "0.5",
      scaleY: "1",
      offsetX: "0",
      offsetY: "5",
    });
  });

  it("fills missing/short fields with empty strings", () => {
    expect(parseCompound("0.5,1")).toEqual({
      scaleX: "0.5",
      scaleY: "1",
      offsetX: "",
      offsetY: "",
    });
    expect(parseCompound(undefined)).toEqual({
      scaleX: "",
      scaleY: "",
      offsetX: "",
      offsetY: "",
    });
  });

  it("re-joins to the comma form, defaulting blanks to 0", () => {
    expect(formatCompound({ scaleX: "0.5", scaleY: "1", offsetX: "", offsetY: "5" })).toBe(
      "0.5,1,0,5",
    );
  });

  it("writes a {token} field through verbatim on format", () => {
    expect(
      formatCompound({ scaleX: "{healthRatio}", scaleY: "1", offsetX: "0", offsetY: "0" }),
    ).toBe("{healthRatio},1,0,0");
  });

  it("round-trips a literal value through parse → format", () => {
    const raw = "0.5,1,0,5";
    expect(formatCompound(parseCompound(raw))).toBe(raw);
  });

  it("round-trips a per-field token value through parse → format", () => {
    const raw = "{healthRatio},1,0,0";
    expect(formatCompound(parseCompound(raw))).toBe(raw);
  });
});

describe("isBoundField", () => {
  it("treats a whole {token} as bound", () => {
    expect(isBoundField("{healthRatio}")).toBe(true);
    expect(isBoundField("  {x}  ")).toBe(true);
  });

  it("treats a literal number as not bound", () => {
    expect(isBoundField("0.5")).toBe(false);
    expect(isBoundField("0")).toBe(false);
  });

  it("treats partial/embedded tokens as not bound (whole-value only)", () => {
    expect(isBoundField("a{x}")).toBe(false);
    expect(isBoundField("{x}{y}")).toBe(false);
    expect(isBoundField("")).toBe(false);
  });
});

describe("fieldsForTag", () => {
  it("gives Panel position/size/texture/colors", () => {
    const names = fieldsForTag("Panel").map((f) => f.name);
    expect(names).toContain("position");
    expect(names).toContain("size");
    expect(names).toContain("texture");
    expect(names).toContain("backgroundColor");
    expect(names).toContain("borderColor");
  });

  it("gives Text a textColor and text field", () => {
    const names = fieldsForTag("Text").map((f) => f.name);
    expect(names).toContain("text");
    expect(names).toContain("textColor");
  });

  it("does not list id or src among schema fields (handled specially)", () => {
    for (const tag of ["View", "Panel", "Text", "Component", "Event"] as const) {
      const names = fieldsForTag(tag).map((f) => f.name);
      expect(names).not.toContain("id");
      expect(names).not.toContain("src");
    }
  });

  it("types texture as sprite and colors as color", () => {
    const panel = fieldsForTag("Panel");
    expect(panel.find((f) => f.name === "texture")?.kind).toBe("sprite");
    expect(panel.find((f) => f.name === "backgroundColor")?.kind).toBe("color");
    expect(panel.find((f) => f.name === "position")?.kind).toBe("compound");
  });
});

describe("freeformAttrs", () => {
  it("returns Component attrs that are neither schema nor special", () => {
    const n = node("Component", {
      id: "slot",
      src: "bag_slot",
      position: "0,0,0,0",
      label: "Potions", // override
      count: "{n}", // override
    });
    expect(freeformAttrs(n)).toEqual(["label", "count"]);
  });

  it("returns unrecognized attrs on a Panel as freeform", () => {
    const n = node("Panel", { id: "p", position: "0,0,0,0", customThing: "x" });
    expect(freeformAttrs(n)).toEqual(["customThing"]);
  });

  it("preserves authored order", () => {
    const n = node("Component", { src: "x", zebra: "1", alpha: "2" });
    expect(freeformAttrs(n)).toEqual(["zebra", "alpha"]);
  });
});

describe("srcBasename", () => {
  it("returns the bare basename when already clean", () => {
    expect(srcBasename("bag_slot")).toBe("bag_slot");
  });

  it("strips a path and .xml extension defensively", () => {
    expect(srcBasename("widgets/bag_slot.xml")).toBe("bag_slot");
  });

  it("returns empty for undefined/empty", () => {
    expect(srcBasename(undefined)).toBe("");
    expect(srcBasename("")).toBe("");
  });
});

describe("withAttr", () => {
  it("sets a value, preserving order", () => {
    expect(withAttr({ a: "1", b: "2" }, "b", "9")).toEqual({ a: "1", b: "9" });
  });

  it("appends a new key", () => {
    expect(withAttr({ a: "1" }, "c", "3")).toEqual({ a: "1", c: "3" });
  });

  it("removes the attr when value is empty", () => {
    expect(withAttr({ a: "1", b: "2" }, "b", "")).toEqual({ a: "1" });
  });

  it("does not mutate the input", () => {
    const input = { a: "1" };
    withAttr(input, "a", "2");
    expect(input).toEqual({ a: "1" });
  });
});

describe("renameAttr", () => {
  it("renames a key in place, preserving order and value", () => {
    expect(renameAttr({ a: "1", b: "2", c: "3" }, "b", "bee")).toEqual({
      a: "1",
      bee: "2",
      c: "3",
    });
  });

  it("is a no-op on a blank new name", () => {
    expect(renameAttr({ a: "1" }, "a", "")).toEqual({ a: "1" });
  });

  it("is a no-op when the new name collides with a different key", () => {
    expect(renameAttr({ a: "1", b: "2" }, "a", "b")).toEqual({ a: "1", b: "2" });
  });

  it("is a no-op when renaming to the same name", () => {
    expect(renameAttr({ a: "1" }, "a", "a")).toEqual({ a: "1" });
  });
});

describe("removeAttr", () => {
  it("removes the named attr", () => {
    expect(removeAttr({ a: "1", b: "2" }, "a")).toEqual({ b: "2" });
  });
});
