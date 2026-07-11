import { describe, expect, it } from "vitest";
import type { GuiNode } from "../../lib/guiNode";
import {
  deriveRows,
  mintRowId,
  type OverrideRow,
  reconcileRows,
  rowsEqual,
  rowsToAttrs,
} from "./freeformRows";

function node(
  tag: GuiNode["tag"],
  attrs: Record<string, string> = {},
  children: GuiNode[] = [],
): GuiNode {
  return { nodeId: `n-${tag}`, tag, attrs, children };
}

describe("mintRowId", () => {
  it("mints distinct, stable ids", () => {
    const a = mintRowId();
    const b = mintRowId();
    expect(a).not.toBe(b);
  });
});

describe("deriveRows", () => {
  it("derives one row per freeform attr, in authored order, with values", () => {
    const n = node("Component", {
      id: "slot",
      src: "bag_slot",
      position: "0,0,0,0",
      label: "Potions",
      count: "{n}",
    });
    const rows = deriveRows(n);
    expect(rows.map((r) => r.name)).toEqual(["label", "count"]);
    expect(rows.map((r) => r.value)).toEqual(["Potions", "{n}"]);
    // Each row carries a distinct stable id.
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("excludes schema fields and special attrs (id/src/layer on Component)", () => {
    // `layer` is now a Component schema field (task 486) → not freeform.
    const n = node("Component", { id: "c", src: "x", layer: "3", custom: "y" });
    expect(deriveRows(n).map((r) => r.name)).toEqual(["custom"]);
  });

  it("returns no rows for a node with only known/special attrs", () => {
    expect(deriveRows(node("Component", { id: "c", src: "x", position: "0,0,0,0" }))).toEqual([]);
  });

  it("excludes the View's id and controller (managed elsewhere, not freeform)", () => {
    // The View shows no fields; neither its id nor its controller may surface as an
    // editable override row.
    const n = node("View", { id: "view", controller: "bag_controller.lua" });
    expect(deriveRows(n)).toEqual([]);
  });
});

describe("reconcileRows", () => {
  it("preserves row ids where the name still matches (focus survives)", () => {
    const prev: OverrideRow[] = [
      { id: "row1", name: "label", value: "Potions" },
      { id: "row2", name: "count", value: "3" },
    ];
    const n = node("Component", { src: "x", label: "Potions", count: "3" });
    const next = reconcileRows(prev, n);
    expect(next.map((r) => r.id)).toEqual(["row1", "row2"]);
  });

  it("updates the value of an existing row when the attr value changed externally", () => {
    const prev: OverrideRow[] = [{ id: "row1", name: "label", value: "old" }];
    const n = node("Component", { src: "x", label: "new" });
    const next = reconcileRows(prev, n);
    expect(next).toEqual([{ id: "row1", name: "label", value: "new" }]);
  });

  it("mints a row for a freeform attr with no prior matching row", () => {
    const prev: OverrideRow[] = [];
    const n = node("Component", { src: "x", label: "Potions" });
    const next = reconcileRows(prev, n);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("label");
    expect(next[0].value).toBe("Potions");
    expect(next[0].id).toBeTruthy();
  });

  it("drops a row whose attr was removed externally", () => {
    const prev: OverrideRow[] = [
      { id: "row1", name: "label", value: "Potions" },
      { id: "row2", name: "gone", value: "x" },
    ];
    const n = node("Component", { src: "x", label: "Potions" });
    const next = reconcileRows(prev, n);
    expect(next.map((r) => r.name)).toEqual(["label"]);
    expect(next[0].id).toBe("row1");
  });

  it("carries through an in-progress blank-named row (the Add affordance)", () => {
    const prev: OverrideRow[] = [
      { id: "row1", name: "label", value: "Potions" },
      { id: "row2", name: "", value: "" }, // user clicked Add, hasn't named it
    ];
    const n = node("Component", { src: "x", label: "Potions" });
    const next = reconcileRows(prev, n);
    expect(next.map((r) => r.id)).toEqual(["row1", "row2"]);
    expect(next[1].name).toBe("");
  });

  it("returns a content-equal list when rows already mirror attrs", () => {
    const prev: OverrideRow[] = [{ id: "row1", name: "label", value: "Potions" }];
    const n = node("Component", { src: "x", label: "Potions" });
    expect(rowsEqual(prev, reconcileRows(prev, n))).toBe(true);
  });
});

describe("rowsToAttrs", () => {
  it("rebuilds attrs from rows, keeping non-freeform attrs in authored order", () => {
    const n = node("Component", {
      id: "slot",
      src: "bag_slot",
      position: "0,0,0,0",
      label: "old",
    });
    const rows: OverrideRow[] = [{ id: "row1", name: "label", value: "Potions" }];
    expect(rowsToAttrs(n, rows)).toEqual({
      id: "slot",
      src: "bag_slot",
      position: "0,0,0,0",
      label: "Potions",
    });
  });

  it("KEEPS an empty value (clearing a field must not delete the property)", () => {
    const n = node("Component", { src: "x", label: "Potions" });
    const rows: OverrideRow[] = [{ id: "row1", name: "label", value: "" }];
    expect(rowsToAttrs(n, rows)).toEqual({ src: "x", label: "" });
  });

  it("SKIPS a blank-named row (an in-progress Add contributes nothing)", () => {
    const n = node("Component", { src: "x" });
    const rows: OverrideRow[] = [
      { id: "row1", name: "", value: "" },
      { id: "row2", name: "  ", value: "stuff" },
    ];
    expect(rowsToAttrs(n, rows)).toEqual({ src: "x" });
  });

  it("renaming a row's key moves the attr (old key gone, new key present)", () => {
    const n = node("Component", { src: "x", label: "Potions" });
    const rows: OverrideRow[] = [{ id: "row1", name: "title", value: "Potions" }];
    const out = rowsToAttrs(n, rows);
    expect(out).toEqual({ src: "x", title: "Potions" });
    expect("label" in out).toBe(false);
  });

  it("appends a freshly added row at the end in row order", () => {
    const n = node("Component", { src: "x", label: "a" });
    const rows: OverrideRow[] = [
      { id: "row1", name: "label", value: "a" },
      { id: "row2", name: "count", value: "5" },
    ];
    expect(Object.keys(rowsToAttrs(n, rows))).toEqual(["src", "label", "count"]);
  });

  it("does not clobber a non-freeform (schema) attr if a row is renamed onto it", () => {
    // A row renamed to `position` (a typed schema field) must not overwrite it.
    const n = node("Component", { src: "x", position: "0,0,0,0", label: "a" });
    const rows: OverrideRow[] = [{ id: "row1", name: "position", value: "9,9,9,9" }];
    const out = rowsToAttrs(n, rows);
    expect(out.position).toBe("0,0,0,0");
  });

  it("a duplicate name across rows keeps the last row's value", () => {
    const n = node("Component", { src: "x" });
    const rows: OverrideRow[] = [
      { id: "row1", name: "dup", value: "first" },
      { id: "row2", name: "dup", value: "second" },
    ];
    expect(rowsToAttrs(n, rows)).toEqual({ src: "x", dup: "second" });
  });
});

describe("rowsEqual", () => {
  it("is true for identical content", () => {
    const a: OverrideRow[] = [{ id: "r1", name: "x", value: "1" }];
    const b: OverrideRow[] = [{ id: "r1", name: "x", value: "1" }];
    expect(rowsEqual(a, b)).toBe(true);
  });

  it("is false when an id, name, value, or length differs", () => {
    const base: OverrideRow[] = [{ id: "r1", name: "x", value: "1" }];
    expect(rowsEqual(base, [{ id: "r2", name: "x", value: "1" }])).toBe(false);
    expect(rowsEqual(base, [{ id: "r1", name: "y", value: "1" }])).toBe(false);
    expect(rowsEqual(base, [{ id: "r1", name: "x", value: "2" }])).toBe(false);
    expect(rowsEqual(base, [])).toBe(false);
  });
});
