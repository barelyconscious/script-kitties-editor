/**
 * Tests the scope-aware Data Model auto-scaffold (task 482): EXTRACT (tokens → a
 * nested shape that honors `forEach` scoping), BUILD (shape → JSON with token-name
 * placeholders and one sample item per collection), MERGE (additive — add missing,
 * never overwrite/delete, defensive on type conflict), and the text wiring
 * (`scaffoldModelText` rewrites ONLY when there is something new to add).
 *
 * The tree is built from XML via `parseGui` so the tests exercise the real node
 * shape the editor feeds in (verbatim attribute strings, `forEach` templates).
 */

import { describe, expect, it } from "vitest";
import { parseGui } from "../../lib/guiNode";
import { buildModel, extractShape, mergeModel, scaffoldModelText } from "./guiModelScaffold";

/** Parse XML into the editor's node tree (the input the scaffold walks). */
function tree(xml: string) {
  return parseGui(xml);
}

describe("extractShape — token kinds", () => {
  it("extracts every embedded token from interpolated string props (text/texture)", () => {
    const shape = extractShape(
      tree('<View><Text text="Health: {health}/{maxHealth}" texture="icon_{kind}.png"/></View>'),
    );
    expect([...shape.scalars].sort()).toEqual(["health", "kind", "maxHealth"]);
    expect(shape.collections.size).toBe(0);
  });

  it("extracts whole-value typed/color props but NOT literals", () => {
    const shape = extractShape(
      tree(
        '<View><Panel backgroundColor="{barColor}" visible="{isOpen}" fontSize="{fs}" ' +
          'borderColor="{bc}" borderSize="{bs}" textColor="{tc}" textAlign="{ta}" ' +
          'layer="{lyr}" id="literalId" controller="ctrl"/></View>',
      ),
    );
    expect([...shape.scalars].sort()).toEqual(
      ["barColor", "bc", "bs", "fs", "isOpen", "lyr", "ta", "tc"].sort(),
    );
  });

  it("does NOT extract embedded tokens from typed props (whole-value only)", () => {
    // fontSize="x{n}" is not a whole token → literal, contributes nothing.
    const shape = extractShape(tree('<View><Text fontSize="x{n}"/></View>'));
    expect(shape.scalars.size).toBe(0);
  });

  it("extracts per-field tokens from compound position/size, ignoring literal fields", () => {
    const shape = extractShape(
      tree('<View><Panel size="{healthRatio},1,0,0" position="0,{offsetY},0,0"/></View>'),
    );
    expect([...shape.scalars].sort()).toEqual(["healthRatio", "offsetY"]);
  });

  it("ignores literal-only structural props but extracts item-scoped key under forEach", () => {
    // key at root is item-scoped → no enclosing item → it records on the root scope
    // here (root IS the current scope); the point is it is NOT skipped like id/src.
    const shape = extractShape(tree('<View><Panel key="{rowId}" src="literal"/></View>'));
    expect([...shape.scalars]).toEqual(["rowId"]);
  });
});

describe("extractShape — forEach scoping", () => {
  it("opens a collection with item-scoped fields for a bare forEach", () => {
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}"><Text text="{label}" key="{id}"/></Panel></View>'),
    );
    expect(shape.scalars.size).toBe(0);
    const rows = shape.collections.get("rows");
    expect(rows).toBeDefined();
    expect([...(rows?.scalars ?? [])].sort()).toEqual(["id", "label"]);
  });

  it("records the forEach template node's OWN attrs in the item scope", () => {
    // The template's bindings (other than forEach) are item-scoped.
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}" backgroundColor="{rowColor}"/></View>'),
    );
    const rows = shape.collections.get("rows");
    expect([...(rows?.scalars ?? [])]).toEqual(["rowColor"]);
  });

  it("routes $-prefixed tokens to the ROOT scope at any nesting depth", () => {
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}"><Text text="{label} of {$.total}"/></Panel></View>'),
    );
    expect([...shape.scalars]).toEqual(["total"]); // $.total → root
    expect([...(shape.collections.get("rows")?.scalars ?? [])]).toEqual(["label"]); // bare → item
  });

  it("nests forEach: an inner collection lives on the outer item scope", () => {
    const shape = extractShape(
      tree(
        '<View><Panel forEach="{groups}"><Text text="{name}"/>' +
          '<Panel forEach="{items}"><Text text="{itemName}"/></Panel></Panel></View>',
      ),
    );
    const groups = shape.collections.get("groups");
    expect([...(groups?.scalars ?? [])]).toEqual(["name"]);
    const items = groups?.collections.get("items");
    expect([...(items?.scalars ?? [])]).toEqual(["itemName"]);
  });

  it("a $.collection forEach opens the collection on the ROOT scope", () => {
    const shape = extractShape(
      tree(
        '<View><Panel forEach="{outer}"><Panel forEach="{$.roots}">' +
          '<Text text="{rootField}"/></Panel></Panel></View>',
      ),
    );
    // roots is opened on root (via $.), not on the outer item.
    expect(shape.collections.has("roots")).toBe(true);
    expect([...(shape.collections.get("roots")?.scalars ?? [])]).toEqual(["rootField"]);
    expect(shape.collections.get("outer")?.collections.has("roots")).toBe(false);
  });
});

describe("buildModel — defaults are the token name", () => {
  it("each scalar defaults to its token name as a string", () => {
    const shape = extractShape(tree('<View><Text text="{health}"/></View>'));
    expect(buildModel(shape)).toEqual({ health: "health" });
  });

  it("a collection becomes an array with ONE sample item built from its item-shape", () => {
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}"><Text text="{label}"/></Panel></View>'),
    );
    expect(buildModel(shape)).toEqual({ rows: [{ label: "label" }] });
  });

  it("nested collections nest one sample item deep", () => {
    const shape = extractShape(
      tree(
        '<View><Panel forEach="{groups}"><Text text="{name}"/>' +
          '<Panel forEach="{items}"><Text text="{itemName}"/></Panel></Panel></View>',
      ),
    );
    expect(buildModel(shape)).toEqual({
      groups: [{ name: "name", items: [{ itemName: "itemName" }] }],
    });
  });
});

describe("mergeModel — additive only", () => {
  it("adds missing root keys without touching existing ones", () => {
    const shape = extractShape(tree('<View><Text text="{health} {mana}"/></View>'));
    const { model, added } = mergeModel({ health: 99 }, shape);
    expect(added).toBe(true);
    // existing value preserved; missing key added with its placeholder.
    expect(model).toEqual({ health: 99, mana: "mana" });
  });

  it("never overwrites an existing value (user edits win)", () => {
    const shape = extractShape(tree('<View><Text text="{health}"/></View>'));
    const { model, added } = mergeModel({ health: 15 }, shape);
    expect(added).toBe(false);
    expect(model).toEqual({ health: 15 });
  });

  it("adds missing fields to the sample item of an existing collection array", () => {
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}"><Text text="{label} {qty}"/></Panel></View>'),
    );
    const current = { rows: [{ label: "Apple" }] };
    const { model, added } = mergeModel(current, shape);
    expect(added).toBe(true);
    // user's sample data preserved; the new field added alongside.
    expect(model).toEqual({ rows: [{ label: "Apple", qty: "qty" }] });
  });

  it("leaves extra user items in a collection untouched, only growing the first", () => {
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}"><Text text="{label} {qty}"/></Panel></View>'),
    );
    const current = { rows: [{ label: "Apple" }, { label: "Pear", qty: 3 }] };
    const { model } = mergeModel(current, shape) as { model: { rows: unknown[] } };
    expect(model.rows).toEqual([
      { label: "Apple", qty: "qty" },
      { label: "Pear", qty: 3 },
    ]);
  });

  it("never deletes keys for removed tokens (harmless leftovers)", () => {
    const shape = extractShape(tree('<View><Text text="{health}"/></View>'));
    const { model, added } = mergeModel({ health: 15, oldToken: "stale" }, shape);
    expect(added).toBe(false);
    expect(model).toEqual({ health: 15, oldToken: "stale" });
  });

  it("is defensive on a type conflict: scaffold collection vs. user scalar — leave it alone", () => {
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}"><Text text="{label}"/></Panel></View>'),
    );
    // User replaced the collection with a scalar — do not clobber.
    const { model, added } = mergeModel({ rows: 42 }, shape);
    expect(added).toBe(false);
    expect(model).toEqual({ rows: 42 });
  });

  it("is defensive on a type conflict: scaffold scalar vs. user object — leave it alone", () => {
    const shape = extractShape(tree('<View><Text text="{health}"/></View>'));
    const { model, added } = mergeModel({ health: { nested: true } }, shape);
    expect(added).toBe(false);
    expect(model).toEqual({ health: { nested: true } });
  });

  it("leaves a non-object root model untouched (nowhere to add root keys)", () => {
    const shape = extractShape(tree('<View><Text text="{health}"/></View>'));
    const { model, added } = mergeModel([1, 2, 3], shape);
    expect(added).toBe(false);
    expect(model).toEqual([1, 2, 3]);
  });

  it("seeds an emptied user collection array with the sample item", () => {
    const shape = extractShape(
      tree('<View><Panel forEach="{rows}"><Text text="{label}"/></Panel></View>'),
    );
    const { model, added } = mergeModel({ rows: [] }, shape);
    expect(added).toBe(true);
    expect(model).toEqual({ rows: [{ label: "label" }] });
  });
});

describe("scaffoldModelText — text rewrite only on new tokens", () => {
  it("pre-fills an empty model from the tree's tokens", () => {
    const text = scaffoldModelText("", tree('<View><Text text="{health}"/></View>'));
    expect(text).not.toBeNull();
    expect(JSON.parse(text as string)).toEqual({ health: "health" });
  });

  it("returns null (no rewrite) when nothing new is added", () => {
    const text = scaffoldModelText('{"health":15}', tree('<View><Text text="{health}"/></View>'));
    expect(text).toBeNull();
  });

  it("rewrites with the merged model when a new token appears", () => {
    const text = scaffoldModelText(
      '{"health":15}',
      tree('<View><Text text="{health} {mana}"/></View>'),
    );
    expect(text).not.toBeNull();
    expect(JSON.parse(text as string)).toEqual({ health: 15, mana: "mana" });
  });

  it("indents with two spaces (matches the panel's JSON formatting)", () => {
    const text = scaffoldModelText("", tree('<View><Text text="{health}"/></View>'));
    expect(text).toBe('{\n  "health": "health"\n}');
  });

  it("does not stomp unparseable in-progress text (returns null)", () => {
    const text = scaffoldModelText("{ not json", tree('<View><Text text="{health}"/></View>'));
    expect(text).toBeNull();
  });

  it("a renders-one forEach sample flows through: array with one item", () => {
    const text = scaffoldModelText(
      "",
      tree('<View><Panel forEach="{rows}"><Text text="{label}"/></Panel></View>'),
    );
    expect(JSON.parse(text as string)).toEqual({ rows: [{ label: "label" }] });
  });
});
