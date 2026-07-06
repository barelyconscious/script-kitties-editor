import { describe, expect, it } from "vitest";
import { parseScopeRef } from "../../lib/guiBinding";
import type { GuiNode } from "../../lib/guiNode";
import {
  bindingDisplayValue,
  computedId,
  fieldsForTag,
  formatCompound,
  freeformAttrs,
  INTERACTION_GROUP,
  interactionHandlerFields,
  isBoundField,
  nodeHasId,
  normalizeBinding,
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

  it("gives Text a color and text field", () => {
    const names = fieldsForTag("Text").map((f) => f.name);
    expect(names).toContain("text");
    expect(names).toContain("color");
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

  it("exposes a bindable layer field on Component (task 486)", () => {
    // A Component renders as a leaf in the parent tree, so the F5b z-order applies
    // its layer; the schema just makes it editable. Text-kind so it accepts an
    // integer literal or a {token}.
    const fields = fieldsForTag("Component");
    const layer = fields.find((f) => f.name === "layer");
    expect(layer).toBeDefined();
    expect(layer?.kind).toBe("text");
  });

  it("gives Event a plain-text name + a handler-kind handler (thin model)", () => {
    // Events are edited in the Properties panel (the dedicated events panel is gone):
    // name→handler, both verbatim literal strings. `name` is a plain literal; `handler`
    // is kind `handler` (#504) so it shares the element handlers' controller-function
    // dropdown — an Event handler is still a controller function name. Neither is
    // grouped (Event has no Interaction section).
    const fields = fieldsForTag("Event");
    expect(fields.map((f) => f.name)).toEqual(["name", "handler"]);
    expect(fields.find((f) => f.name === "name")?.kind).toBe("text");
    expect(fields.find((f) => f.name === "handler")?.kind).toBe("handler");
    expect(fields.every((f) => f.group === undefined)).toBe(true);
  });

  it("gives the root View a scopeName text field first, then an onKeyPressed handler", () => {
    // scopeName publishes the View's frame under a name for `{$name.x}` reach
    // (engine parses it on the root <View>). It is the FIRST panel field the View
    // shows; id (auto-set) and controller (Controller tab) stay handled elsewhere.
    // The View is ALSO a real onKeyPressed target (engine dispatches unfocused key
    // events to Root), so it gains an Interaction group with that ONE handler.
    const fields = fieldsForTag("View");
    expect(fields.map((f) => f.name)).toEqual(["scopeName", "onKeyPressed"]);
    expect(fields[0].kind).toBe("text");
    expect(fields[0].group).toBeUndefined();
    const onKeyPressed = fields[1];
    expect(onKeyPressed.kind).toBe("handler");
    expect(onKeyPressed.group).toBe(INTERACTION_GROUP);
  });

  it("gives GridLayout dataCollection (binding) + rows/columns/gutter (literal text) + cellSize (literal compound), in order", () => {
    const fields = fieldsForTag("GridLayout");
    expect(fields.map((f) => f.name)).toEqual([
      "dataCollection",
      "rows",
      "columns",
      "gutter",
      "cellSize",
    ]);
    // dataCollection is a whole-value binding — committed on blur (not per keystroke) so
    // a half-typed path doesn't spam the additive scaffold. rows/columns/gutter are plain
    // text; cellSize is a full UDim2 edited through the four-input `compound` UI (same as
    // position/size), with literalOnly suppressing the per-field token affordance.
    expect(fields.map((f) => f.kind)).toEqual(["binding", "text", "text", "text", "compound"]);
    // Grid STRUCTURE is stamped at load — it cannot bind — so all four structural attrs are
    // literalOnly; only dataCollection (grammar, resolved at stamp time) is not.
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get("dataCollection")?.literalOnly).toBeUndefined();
    expect(byName.get("rows")?.literalOnly).toBe(true);
    expect(byName.get("columns")?.literalOnly).toBe(true);
    expect(byName.get("gutter")?.literalOnly).toBe(true);
    expect(byName.get("cellSize")?.literalOnly).toBe(true);
  });

  it("never exposes position/size on a GridLayout (it's a non-visual control)", () => {
    const names = fieldsForTag("GridLayout").map((f) => f.name);
    expect(names).not.toContain("position");
    expect(names).not.toContain("size");
  });

  it("suppresses position/size for a child whose parent is a GridLayout", () => {
    // The grid owns its child's geometry (design req 4), so a grid child's panel
    // shows no position/size rows. Other fields (text, colors, …) remain.
    const panelUnderGrid = fieldsForTag("Panel", "GridLayout").map((f) => f.name);
    expect(panelUnderGrid).not.toContain("position");
    expect(panelUnderGrid).not.toContain("size");
    expect(panelUnderGrid).toContain("texture");

    const textUnderGrid = fieldsForTag("Text", "GridLayout").map((f) => f.name);
    expect(textUnderGrid).not.toContain("position");
    expect(textUnderGrid).not.toContain("size");
    expect(textUnderGrid).toContain("text");
  });

  it("keeps position/size for a child under a non-grid parent", () => {
    const panelUnderView = fieldsForTag("Panel", "View").map((f) => f.name);
    expect(panelUnderView).toContain("position");
    expect(panelUnderView).toContain("size");
  });

  it("gives Component a `data` binding field (not a bare-key)", () => {
    // `data` seats the mounted child's root; its stored form is a whole-value grammar
    // token (kind `binding`), never a bare key the strict resolver rejects.
    const data = fieldsForTag("Component").find((f) => f.name === "data");
    expect(data?.kind).toBe("binding");
    expect(data?.group).toBeUndefined();
  });
});

describe("interaction fields (B1)", () => {
  const HANDLERS = [
    "onMouseClicked",
    "onMouseEntered",
    "onMouseExited",
    "onMouseMoved",
    "onKeyPressed",
    "onFocus",
    "onBlur",
  ];

  for (const tag of ["Panel", "Text", "Component"] as const) {
    it(`exposes the 7 handlers + modal + tooltip + tooltipData on ${tag}, all grouped Interaction`, () => {
      const fields = fieldsForTag(tag);
      const byName = new Map(fields.map((f) => [f.name, f]));

      // Every handler is a literal-only `handler` kind (no {token} affordance).
      for (const h of HANDLERS) {
        expect(byName.get(h)?.kind).toBe("handler");
        expect(byName.get(h)?.group).toBe(INTERACTION_GROUP);
      }
      // modal is a plain boolean flagged literalOnly so the panel drops its {token}
      // affordance (the engine reads it pre-binding — a token there is a lint, #504).
      expect(byName.get("modal")?.kind).toBe("boolean");
      expect(byName.get("modal")?.group).toBe(INTERACTION_GROUP);
      expect(byName.get("modal")?.literalOnly).toBe(true);
      // tooltip is a component ref (a `.xml` basename via the picker).
      expect(byName.get("tooltip")?.kind).toBe("componentRef");
      expect(byName.get("tooltip")?.group).toBe(INTERACTION_GROUP);
      // tooltipData is a whole-value binding (same as data=).
      expect(byName.get("tooltipData")?.kind).toBe("binding");
      expect(byName.get("tooltipData")?.group).toBe(INTERACTION_GROUP);
    });
  }

  it("View exposes onKeyPressed only (no mouse handlers, no tooltip)", () => {
    const names = fieldsForTag("View")
      .filter((f) => f.group === INTERACTION_GROUP)
      .map((f) => f.name);
    expect(names).toEqual(["onKeyPressed"]);
  });

  it("does NOT add interaction fields to Event or GridLayout", () => {
    for (const tag of ["Event", "GridLayout"] as const) {
      const grouped = fieldsForTag(tag).filter((f) => f.group === INTERACTION_GROUP);
      expect(grouped).toEqual([]);
    }
  });

  it("the default (ungrouped) fields carry no group tag", () => {
    // Grouping is opt-in; the well-known geometry/color/etc. fields stay ungrouped so
    // they render inline exactly as before.
    const position = fieldsForTag("Panel").find((f) => f.name === "position");
    expect(position?.group).toBeUndefined();
  });
});

describe("normalizeBinding", () => {
  it("view-scopes a bare key", () => {
    expect(normalizeBinding("creatures")).toBe("{$.creatures}");
    expect(normalizeBinding("creature.name")).toBe("{$.creature.name}");
  });

  it("wraps an explicit $. / $name. prefix verbatim", () => {
    expect(normalizeBinding("$.creatures")).toBe("{$.creatures}");
    expect(normalizeBinding("$app.theme")).toBe("{$app.theme}");
  });

  it("stores a hand-typed whole token verbatim (incl. whole-object forms)", () => {
    expect(normalizeBinding("{$.creature}")).toBe("{$.creature}");
    expect(normalizeBinding("{$.}")).toBe("{$.}");
    expect(normalizeBinding("{.}")).toBe("{.}");
    expect(normalizeBinding("{sprite}")).toBe("{sprite}");
    expect(normalizeBinding("{$app.theme}")).toBe("{$app.theme}");
  });

  it("maps the bare grid-item whole-object shorthand `.` to {.}", () => {
    expect(normalizeBinding(".")).toBe("{.}");
  });

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeBinding("  creatures  ")).toBe("{$.creatures}");
    expect(normalizeBinding("  {$.creature}  ")).toBe("{$.creature}");
  });

  it("keeps an empty value empty (clearing removes the attr)", () => {
    expect(normalizeBinding("")).toBe("");
    expect(normalizeBinding("   ")).toBe("");
  });

  it("produces a form the resolver + scaffold both accept for a bare key", () => {
    // {$.key} is a single-segment view path — resolveWholeTokenValue walks it and
    // tokenTarget seats it at the root. This is the round-trip contract with A1/A1s.
    const stored = normalizeBinding("creatures");
    const ref = parseScopeRef(stored.slice(1, -1));
    expect(ref).toEqual({ frame: "view", path: ["creatures"] });
  });
});

describe("bindingDisplayValue", () => {
  it("shows the inner dotted path for a simple {$.x} view form", () => {
    expect(bindingDisplayValue("{$.creature}")).toBe("creature");
    expect(bindingDisplayValue("{$.a.b}")).toBe("a.b");
  });

  it("round-trips a bare key through normalize → display", () => {
    expect(bindingDisplayValue(normalizeBinding("creatures"))).toBe("creatures");
    expect(bindingDisplayValue(normalizeBinding("creature.name"))).toBe("creature.name");
  });

  it("shows whole-object / item / named / non-view tokens verbatim", () => {
    expect(bindingDisplayValue("{$.}")).toBe("{$.}");
    expect(bindingDisplayValue("{.}")).toBe("{.}");
    expect(bindingDisplayValue("{sprite}")).toBe("{sprite}");
    expect(bindingDisplayValue("{$app.theme}")).toBe("{$app.theme}");
  });

  it("shows a non-token literal verbatim (e.g. a legacy bare value)", () => {
    expect(bindingDisplayValue("creatures")).toBe("creatures");
    expect(bindingDisplayValue("")).toBe("");
  });
});

describe("nodeHasId — id rows hidden for Event (475) and View", () => {
  it("child structural/visual tags have an id", () => {
    for (const tag of ["Panel", "Text", "Component"] as const) {
      expect(nodeHasId(tag)).toBe(true);
    }
  });

  it("Event has NO id (only name + handler in Properties)", () => {
    // Task 471 — events are addressed by name/handler, not a hierarchical id; the
    // panel hides both the computed id and the editable id row for an Event.
    expect(nodeHasId("Event")).toBe(false);
  });

  it("the root View has NO id rows (no editable properties at all)", () => {
    // The View is the component itself; its id is auto-set on create and not edited
    // in the panel. computedId still reads the attr to prefix descendants.
    expect(nodeHasId("View")).toBe(false);
  });

  it("GridLayout has NO id (non-visual control, not Lua-addressable)", () => {
    // Design req 2 — a GridLayout has no id and cannot be referenced by Lua. Keeping
    // it id-less also keeps the missing-id TriangleAlert from firing on it.
    expect(nodeHasId("GridLayout")).toBe(false);
  });
});

describe("freeformAttrs", () => {
  it("a stray id on an Event surfaces as freeform, not special (475)", () => {
    // Event has no id, so `id` is not special for it — a stray authored `id` should
    // appear as an editable freeform row rather than vanish silently.
    const n = node("Event", { name: "onClick", handler: "doThing", id: "oops" });
    expect(freeformAttrs(n)).toEqual(["id"]);
  });

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

  it("does not surface the View's id or controller as freeform (managed elsewhere)", () => {
    // The View's structural attrs must be preserved on the node — not leaked into
    // the freeform 'other properties' rows.
    const n = node("View", { id: "view", controller: "bag_controller.lua" });
    expect(freeformAttrs(n)).toEqual([]);
  });

  it("does not surface the View's scopeName as freeform (it's a schema field now)", () => {
    // scopeName is a real schema field on the View, so it must render as a typed
    // field — not fall through to the freeform 'other properties' rows.
    const n = node("View", { id: "view", scopeName: "bag" });
    expect(freeformAttrs(n)).toEqual([]);
  });

  it("does not surface a Component's data as freeform (now a schema binding field)", () => {
    const n = node("Component", { id: "btn", src: "gui.button", data: "{$.buttonData}" });
    expect(freeformAttrs(n)).toEqual([]);
  });

  it("does not surface interaction attrs as freeform (they are schema fields)", () => {
    // Handlers / modal / tooltip / tooltipData are first-class fields now, so an
    // authored one must render as its typed field, never as a freeform override row.
    const n = node("Panel", {
      id: "p",
      onMouseClicked: "handleClick",
      modal: "true",
      tooltip: "gui.kittypacks-tooltip.xml",
      tooltipData: "{$.creature}",
      customThing: "x",
    });
    expect(freeformAttrs(n)).toEqual(["customThing"]);
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

describe("interactionHandlerFields", () => {
  it("offers the seven interaction handlers on hit-testable widgets", () => {
    const names = interactionHandlerFields("Panel").map((f) => f.name);
    expect(names).toEqual([
      "onMouseClicked",
      "onMouseEntered",
      "onMouseExited",
      "onMouseMoved",
      "onKeyPressed",
      "onFocus",
      "onBlur",
    ]);
    // Text and Component carry the same interaction handler set.
    expect(interactionHandlerFields("Text").map((f) => f.name)).toEqual(names);
    expect(interactionHandlerFields("Component").map((f) => f.name)).toEqual(names);
  });

  it("offers only onKeyPressed on the root View", () => {
    expect(interactionHandlerFields("View").map((f) => f.name)).toEqual(["onKeyPressed"]);
  });

  it("returns every field tagged as a grouped handler kind", () => {
    for (const field of interactionHandlerFields("Panel")) {
      expect(field.kind).toBe("handler");
      expect(field.group).toBe(INTERACTION_GROUP);
    }
  });

  it("offers nothing for tags with no interaction handlers", () => {
    // <Event> carries a `handler` field, but it is UNGROUPED (the event's own
    // handler, not an interaction attr), so it is excluded; GridLayout has none.
    expect(interactionHandlerFields("Event")).toEqual([]);
    expect(interactionHandlerFields("GridLayout")).toEqual([]);
  });
});
