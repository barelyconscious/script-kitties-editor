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
function lint(
  n: GuiNode,
  ctx: LintContext = EMPTY_CTX,
  insideGrid = false,
  isGridTemplate = false,
): Lint[] {
  return nodeLints(n, { insideGrid, isGridTemplate }, ctx);
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

describe("grid template geometry lint (rule 9)", () => {
  it("warns on size authored on a grid template child, pointing at cellSize", () => {
    const lints = lint(node("Panel", { size: "0,0,64,64" }), EMPTY_CTX, true, true);
    const warn = find(lints, "size", "warning");
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("cellSize");
  });

  it("warns on position authored on a grid template child", () => {
    expect(
      find(
        lint(node("Panel", { position: "0,0,0,0" }), EMPTY_CTX, true, true),
        "position",
        "warning",
      ),
    ).toBeDefined();
  });

  it("fires on PRESENCE (empty-string value still dead)", () => {
    expect(
      find(lint(node("Panel", { size: "" }), EMPTY_CTX, true, true), "size", "warning"),
    ).toBeDefined();
  });

  it("does NOT warn on a NON-template node inside the grid subtree (descendant lays out normally)", () => {
    // insideGrid true, isGridTemplate false: a Text nested inside the template Panel.
    expect(
      find(lint(node("Text", { size: "0.5,0,0,0" }), EMPTY_CTX, true, false), "size", "warning"),
    ).toBeUndefined();
  });

  it("does NOT warn on geometry outside any grid", () => {
    expect(find(lint(node("Panel", { size: "0,0,10,10" })), "size", "warning")).toBeUndefined();
  });

  it("lintTree fires on the DIRECT grid child but not its descendant", () => {
    const inner = node("Text", { size: "0.5,0,0,0", text: "hi" });
    const template = node("Panel", { size: "0,0,64,64" }, [inner]);
    const grid = node("GridLayout", { dataCollection: "{$.items}" }, [template]);
    const root = node("View", { id: "view" }, [grid]);
    const map = lintTree(root, EMPTY_CTX);
    expect(
      map.get(template.nodeId)?.some((l) => l.attr === "size" && l.severity === "warning"),
    ).toBe(true);
    // The nested Text's size is live geometry within the cell — no rule-9 warning.
    expect(map.get(inner.nodeId)?.some((l) => l.attr === "size")).not.toBe(true);
  });
});

describe("grid structure literal-only lint (rule 10)", () => {
  it.each([
    "rows",
    "columns",
    "gutter",
    "cellSize",
  ])("flags a {token} in %s as an ERROR", (attr) => {
    const lints = lint(node("GridLayout", { [attr]: "{n}" }));
    const err = find(lints, attr, "error");
    expect(err).toBeDefined();
    expect(err?.message).toContain("stamped at load");
  });

  it.each(["{", "}", "a{b}", "{$.rows}"])("fires on a brace anywhere (%s)", (value) => {
    expect(find(lint(node("GridLayout", { rows: value })), "rows", "error")).toBeDefined();
  });

  it("does NOT flag dataCollection — it IS grammar (a scope path)", () => {
    const lints = lint(node("GridLayout", { dataCollection: "{$.items}" }));
    expect(find(lints, "dataCollection", "error")).toBeUndefined();
  });

  it.each([
    ["rows", "3"],
    ["columns", "4"],
    ["gutter", "8,8"],
    ["cellSize", "64,64"],
  ])("does NOT fire on a literal %s value", (attr, value) => {
    expect(find(lint(node("GridLayout", { [attr]: value })), attr, "error")).toBeUndefined();
  });

  it("ignores an empty/absent structural attr", () => {
    expect(find(lint(node("GridLayout", { rows: "" })), "rows", "error")).toBeUndefined();
    expect(
      find(lint(node("GridLayout", { dataCollection: "{$.x}" })), "cellSize", "error"),
    ).toBeUndefined();
  });

  it("only fires on a GridLayout element, not other tags", () => {
    // A `cellSize` attr on a non-grid node isn't structural — no rule-10 error.
    expect(find(lint(node("Panel", { cellSize: "{w}" })), "cellSize", "error")).toBeUndefined();
  });
});

describe("short cellSize lint (rule 11)", () => {
  it("warns on a 2-field numeric value with a did-you-mean full UDim2", () => {
    // cellSize is a full UDim2; "64,64" reads as rel fields (a 6400% cell), not 64px.
    const warn = find(lint(node("GridLayout", { cellSize: "64,64" })), "cellSize", "warning");
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("UDim2");
    expect(warn?.message).toContain('did you mean "0,0,64,64"');
  });

  it("pulls the actual fields into the did-you-mean suggestion", () => {
    const warn = find(lint(node("GridLayout", { cellSize: " 32 , 96 " })), "cellSize", "warning");
    expect(warn?.message).toContain('did you mean "0,0,32,96"');
  });

  it.each([
    "64",
    ",48",
    "abc,5",
    "64,64,64", // three fields
  ])("warns generically on another short/malformed value (%s)", (value) => {
    const warn = find(lint(node("GridLayout", { cellSize: value })), "cellSize", "warning");
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("four comma fields");
    expect(warn?.message).not.toContain("did you mean");
  });

  it("does NOT fire on a well-formed four-field UDim2 (incl. blanks → 0)", () => {
    expect(
      find(lint(node("GridLayout", { cellSize: "0,0,64,64" })), "cellSize", "warning"),
    ).toBeUndefined();
    expect(
      find(lint(node("GridLayout", { cellSize: "0.25,0.25,0,0" })), "cellSize", "warning"),
    ).toBeUndefined();
    // Blank fields are well-formed (parseUDim2 reads them as 0) — four fields, no warning.
    expect(
      find(lint(node("GridLayout", { cellSize: "0,0,,64" })), "cellSize", "warning"),
    ).toBeUndefined();
  });

  it("does NOT fire when cellSize is absent or empty", () => {
    expect(find(lint(node("GridLayout", { rows: "2" })), "cellSize", "warning")).toBeUndefined();
    expect(find(lint(node("GridLayout", { cellSize: "" })), "cellSize", "warning")).toBeUndefined();
  });

  it("does NOT double-fire with rule 10 on a token value (rule 10 errors; rule 11 stays silent)", () => {
    const lints = lint(node("GridLayout", { cellSize: "{w},{h}" }));
    expect(find(lints, "cellSize", "error")).toBeDefined();
    // No rule-11 "four comma fields" warning on a value rule 10 already errored on. (A
    // separate bare-token warning may still fire — that's rule 8, not this rule.)
    const shortWarn = lints.find(
      (l) =>
        l.attr === "cellSize" &&
        l.severity === "warning" &&
        l.message.includes("four comma fields"),
    );
    expect(shortWarn).toBeUndefined();
  });

  it("only fires on a GridLayout element, not other tags", () => {
    expect(find(lint(node("Panel", { cellSize: "64,64" })), "cellSize", "warning")).toBeUndefined();
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
