import { describe, expect, it } from "vitest";
import type { GuiNode } from "../../lib/guiNode";
import {
  collectTooltipBasenames,
  type Lint,
  type LintContext,
  lintTree,
  nodeLints,
  worstSeverity,
} from "./guiLints";

/** A minimal node of the given tag carrying just the supplied attrs. */
function node(
  tag: GuiNode["tag"],
  attrs: Record<string, string>,
  children: GuiNode[] = [],
): GuiNode {
  return { nodeId: `n_${tag}_${Object.keys(attrs).join("_")}`, tag, attrs, children };
}

/** A context that resolves no controller and no components (the common baseline). */
const EMPTY_CTX: LintContext = { exportedFunctions: null, resolveComponent: () => null };

/** Run node lints outside any grid with an optional context override. */
function lint(n: GuiNode, ctx: LintContext = EMPTY_CTX, insideGrid = false): Lint[] {
  return nodeLints(n, insideGrid, ctx);
}

/** Find a lint touching `attr` with the given severity, or undefined. */
function find(lints: Lint[], attr: string, severity: Lint["severity"]): Lint | undefined {
  return lints.find((l) => l.attr === attr && l.severity === severity);
}

describe("handler lints (rule 1 + 2)", () => {
  it("flags braces in a handler as an ERROR", () => {
    const lints = lint(node("Panel", { onMouseClicked: "{onClick}" }));
    expect(find(lints, "onMouseClicked", "error")).toBeDefined();
  });

  it.each([
    "{name}",
    "handler}",
    "{handler",
    "a{b}c",
  ])("flags a brace anywhere in the value (%s)", (value) => {
    const lints = lint(node("Panel", { onFocus: value }));
    expect(find(lints, "onFocus", "error")).toBeDefined();
  });

  it("does not flag a clean handler name for braces", () => {
    const lints = lint(node("Panel", { onMouseClicked: "onClick" }));
    expect(find(lints, "onMouseClicked", "error")).toBeUndefined();
  });

  it("ignores an empty handler attr entirely", () => {
    expect(lint(node("Panel", { onMouseClicked: "" }))).toEqual([]);
  });

  it("checks the Event handler attr too", () => {
    const lints = lint(node("Event", { name: "x", handler: "{bad}" }));
    expect(find(lints, "handler", "error")).toBeDefined();
  });

  it("warns when a handler name is absent from the controller exports", () => {
    const ctx: LintContext = { exportedFunctions: ["onOpen"], resolveComponent: () => null };
    const lints = lint(node("Panel", { onMouseClicked: "onClose" }), ctx);
    expect(find(lints, "onMouseClicked", "warning")).toBeDefined();
  });

  it("does not warn when the handler name is present in the exports", () => {
    const ctx: LintContext = { exportedFunctions: ["onClose"], resolveComponent: () => null };
    const lints = lint(node("Panel", { onMouseClicked: "onClose" }), ctx);
    expect(find(lints, "onMouseClicked", "warning")).toBeUndefined();
  });

  it("skips the handler-exists check when the controller text isn't loaded (null exports)", () => {
    const lints = lint(node("Panel", { onMouseClicked: "onWhatever" }));
    expect(lints).toEqual([]);
  });

  it("does not add a not-found warning on top of a brace error", () => {
    const ctx: LintContext = { exportedFunctions: [], resolveComponent: () => null };
    const lints = lint(node("Panel", { onMouseClicked: "{onClick}" }), ctx);
    expect(lints).toHaveLength(1);
    expect(lints[0].severity).toBe("error");
  });
});

describe("tooltipData lints (rule 3 + 4)", () => {
  it("warns when tooltipData is present without a tooltip", () => {
    const lints = lint(node("Panel", { tooltipData: "{$.creature}" }));
    expect(find(lints, "tooltipData", "warning")).toBeDefined();
  });

  it("does not warn about a dead tooltipData when a tooltip is present", () => {
    const lints = lint(node("Panel", { tooltip: "tip.xml", tooltipData: "{$.creature}" }));
    expect(find(lints, "tooltipData", "warning")).toBeUndefined();
  });

  it("errors when tooltipData is not a whole-value binding expression", () => {
    const lints = lint(node("Panel", { tooltip: "tip.xml", tooltipData: "creature" }));
    expect(find(lints, "tooltipData", "error")).toBeDefined();
  });

  it("accepts a whole-value binding for tooltipData", () => {
    const lints = lint(node("Panel", { tooltip: "tip.xml", tooltipData: "{$.creature}" }));
    expect(find(lints, "tooltipData", "error")).toBeUndefined();
  });

  it("ignores an empty tooltipData", () => {
    expect(lint(node("Panel", { tooltipData: "" }))).toEqual([]);
  });
});

describe("tooltip component lints (rule 5 + 6)", () => {
  const viewRoot = (attrs: Record<string, string>): GuiNode => node("View", attrs);

  it("warns when the tooltip component root size is relative", () => {
    const ctx: LintContext = {
      exportedFunctions: null,
      resolveComponent: () => viewRoot({ size: "0.5,0,200,0" }),
    };
    const lints = lint(node("Panel", { tooltip: "tip.xml" }), ctx);
    expect(find(lints, "tooltip", "warning")).toBeDefined();
  });

  it("does not warn when the tooltip root size is absolute", () => {
    const ctx: LintContext = {
      exportedFunctions: null,
      resolveComponent: () => viewRoot({ size: "0,0,200,120" }),
    };
    const lints = lint(node("Panel", { tooltip: "tip.xml" }), ctx);
    expect(find(lints, "tooltip", "warning")).toBeUndefined();
  });

  it("does not warn when the tooltip root has no size (unknowable)", () => {
    const ctx: LintContext = {
      exportedFunctions: null,
      resolveComponent: () => viewRoot({}),
    };
    expect(lint(node("Panel", { tooltip: "tip.xml" }), ctx)).toEqual([]);
  });

  it("does not warn on a relative field that is a token (can't prove non-zero)", () => {
    const ctx: LintContext = {
      exportedFunctions: null,
      resolveComponent: () => viewRoot({ size: "{w},0,0,0" }),
    };
    expect(
      find(lint(node("Panel", { tooltip: "tip.xml" }), ctx), "tooltip", "warning"),
    ).toBeUndefined();
  });

  it("warns when the tooltip component declares a controller", () => {
    const ctx: LintContext = {
      exportedFunctions: null,
      resolveComponent: () => viewRoot({ size: "0,0,200,120", controller: "tip_controller.lua" }),
    };
    const lints = lint(node("Panel", { tooltip: "tip.xml" }), ctx);
    expect(lints.filter((l) => l.attr === "tooltip" && l.severity === "warning")).toHaveLength(1);
    expect(lints[0].message).toContain("controller");
  });

  it("resolves the tooltip ref by its .xml-stripped basename", () => {
    let asked = "";
    const ctx: LintContext = {
      exportedFunctions: null,
      resolveComponent: (ref) => {
        asked = ref;
        return null;
      },
    };
    lint(node("Panel", { tooltip: "gui.kittypacks-tooltip.xml" }), ctx);
    // The context receives the raw stored ref; the resolver (in the tree) strips .xml.
    expect(asked).toBe("gui.kittypacks-tooltip.xml");
  });

  it("skips tooltip-component lints when the component can't be resolved", () => {
    expect(lint(node("Panel", { tooltip: "missing.xml" }))).toEqual([]);
  });
});

describe("modal lint (rule 7)", () => {
  it("errors on a {token} modal (never resolves pre-binding)", () => {
    const lints = lint(node("Panel", { modal: "{isOpen}" }));
    expect(find(lints, "modal", "error")).toBeDefined();
  });

  it.each([
    "true",
    "false",
    "1",
    "0",
    "yes",
    "no",
    "True",
    "FALSE",
    "Yes",
  ])("accepts the clean literal boolean %s", (value) => {
    expect(lint(node("Panel", { modal: value }))).toEqual([]);
  });

  it("warns on a non-boolean literal, reporting the engine's truthy reading", () => {
    const lints = lint(node("Panel", { modal: "yep" }));
    const warn = find(lints, "modal", "warning");
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("truthy");
  });

  it("warns that 'on' reads FALSY (engine-accurate: 'o' is not a truthy first char)", () => {
    const lints = lint(node("Panel", { modal: "on" }));
    const warn = find(lints, "modal", "warning");
    expect(warn?.message).toContain("falsy");
  });

  it("ignores a missing or empty modal", () => {
    expect(lint(node("Panel", {}))).toEqual([]);
    expect(lint(node("Panel", { modal: "" }))).toEqual([]);
  });
});

describe("bare-token lint (rule 8)", () => {
  it("warns on a bare item token in a presentational attr outside a grid", () => {
    const lints = lint(node("Text", { text: "{sprite}" }));
    const warn = find(lints, "text", "warning");
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("{$.sprite}");
  });

  it("suggests {$.} for the whole-item shorthand {.}", () => {
    const lints = lint(node("Component", { data: "{.}" }));
    expect(find(lints, "data", "warning")?.message).toContain("{$.}");
  });

  it("does not warn on a view-scope token", () => {
    expect(lint(node("Text", { text: "{$.name}" }))).toEqual([]);
  });

  it("does not warn on a named-scope token", () => {
    expect(lint(node("Text", { text: "{$app.theme}" }))).toEqual([]);
  });

  it("catches a bare token inside interpolated text", () => {
    const lints = lint(node("Text", { texture: "icon_{type}.png" }));
    expect(find(lints, "texture", "warning")).toBeDefined();
  });

  it("catches a bare token in a compound field", () => {
    const lints = lint(node("Panel", { size: "{ratio},1,0,0" }));
    expect(find(lints, "size", "warning")).toBeDefined();
  });

  it("does NOT warn on a bare token when inside a grid subtree", () => {
    expect(lint(node("Text", { text: "{sprite}" }), EMPTY_CTX, true)).toEqual([]);
  });

  it("does not scan literal-only / structural attrs", () => {
    // id/src are literal-only; a stray brace there is not a bare-token binding warning
    // (a handler brace is a separate ERROR, tested above).
    const lints = lint(node("Component", { src: "{weird}", id: "{x}" }));
    expect(lints.filter((l) => l.severity === "warning")).toEqual([]);
  });

  it("does not treat modal/tooltip as bare-token attrs (they have their own lints)", () => {
    // modal has its own rule; tooltip is a component ref. A bare token in `tooltip`
    // should not produce a bare-token warning.
    const lints = lint(node("Panel", { tooltip: "{x}" }));
    expect(find(lints, "tooltip", "warning")).toBeUndefined();
  });
});

describe("lintTree — grid context threading", () => {
  it("treats a GridLayout child subtree as inside a grid (no bare-token warning)", () => {
    const grid = node("GridLayout", { dataCollection: "{$.items}" }, [
      node("Panel", { texture: "{sprite}" }, [node("Text", { text: "{name}" })]),
    ]);
    const root = node("View", { id: "view" }, [grid]);
    const map = lintTree(root, EMPTY_CTX);
    // Neither the grid child nor its descendant should warn — bare tokens are item scope.
    expect([...map.values()].flat().filter((l) => l.severity === "warning")).toEqual([]);
  });

  it("still warns on a bare token OUTSIDE the grid", () => {
    const outside = node("Text", { text: "{sprite}" });
    const grid = node("GridLayout", { dataCollection: "{$.items}" }, [
      node("Text", { text: "{name}" }),
    ]);
    const root = node("View", { id: "view" }, [outside, grid]);
    const map = lintTree(root, EMPTY_CTX);
    expect(map.get(outside.nodeId)?.some((l) => l.severity === "warning")).toBe(true);
  });

  it("does not treat the GridLayout node's OWN attrs as inside a grid", () => {
    // dataCollection binds the VIEW scope; a bare token there IS a mistake.
    const grid = node("GridLayout", { dataCollection: "{items}" });
    const root = node("View", { id: "view" }, [grid]);
    const map = lintTree(root, EMPTY_CTX);
    expect(map.get(grid.nodeId)?.some((l) => l.attr === "dataCollection")).toBe(true);
  });

  it("omits clean nodes from the map", () => {
    const root = node("View", { id: "view" }, [node("Panel", { id: "p", size: "0,0,10,10" })]);
    expect(lintTree(root, EMPTY_CTX).size).toBe(0);
  });
});

describe("collectTooltipBasenames", () => {
  it("collects distinct .xml-stripped basenames across the tree", () => {
    const root = node("View", { id: "view" }, [
      node("Panel", { tooltip: "tip_a.xml" }),
      node("Panel", { tooltip: "tip_b.xml" }, [node("Text", { tooltip: "tip_a.xml" })]),
      node("Panel", {}),
    ]);
    expect(collectTooltipBasenames(root)).toEqual(["tip_a", "tip_b"]);
  });

  it("ignores empty tooltip attrs", () => {
    expect(collectTooltipBasenames(node("Panel", { tooltip: "" }))).toEqual([]);
  });
});

describe("worstSeverity", () => {
  it("returns null for no lints", () => {
    expect(worstSeverity([])).toBeNull();
  });

  it("prefers error over warning", () => {
    const lints: Lint[] = [
      { severity: "warning", attr: "a", message: "" },
      { severity: "error", attr: "b", message: "" },
    ];
    expect(worstSeverity(lints)).toBe("error");
  });

  it("returns warning when only warnings are present", () => {
    expect(worstSeverity([{ severity: "warning", attr: "a", message: "" }])).toBe("warning");
  });
});
