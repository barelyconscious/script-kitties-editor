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

describe("extractShape — nested <Component data> objects", () => {
  // A resolver standing in for the component registry: maps a basename to its tree.
  const button = tree('<View><Text text="{label}"/><Panel backgroundColor="{tint}"/></View>');
  const resolve = (name: string) => (name === "button" ? button : undefined);

  it("folds the child component's shape under the data key as an object", () => {
    const shape = extractShape(
      tree('<View><Component src="button" data="buttonProps"/></View>'),
      resolve,
    );
    expect(shape.scalars.size).toBe(0);
    expect([...(shape.objects.get("buttonProps")?.scalars ?? [])].sort()).toEqual(["label", "tint"]);
    expect(buildModel(shape)).toEqual({ buttonProps: { label: "label", tint: "tint" } });
  });

  it("records the data key present-but-empty without a resolver", () => {
    const shape = extractShape(tree('<View><Component src="button" data="buttonProps"/></View>'));
    expect(shape.objects.has("buttonProps")).toBe(true);
    expect(buildModel(shape)).toEqual({ buttonProps: {} });
  });

  it("records present-but-empty when the child src can't be resolved", () => {
    const shape = extractShape(
      tree('<View><Component src="ghost" data="props"/></View>'),
      resolve,
    );
    expect(buildModel(shape)).toEqual({ props: {} });
  });

  it("ignores non-bare data keys in v1 (no $./dotted forms)", () => {
    const shape = extractShape(
      tree('<View><Component src="button" data="$.shared"/></View>'),
      resolve,
    );
    expect(shape.objects.size).toBe(0);
  });

  it("guards include cycles via the ancestry seed", () => {
    // A → A self-include: seeding ancestry with the component's own basename stops
    // the recursion folding itself in forever.
    const selfRef = tree('<View><Component src="a" data="self"/></View>');
    const resolveSelf = (name: string) => (name === "a" ? selfRef : undefined);
    const shape = extractShape(selfRef, resolveSelf, new Set(["a"]));
    expect(buildModel(shape)).toEqual({ self: {} });
  });

  it("scaffolds the data object into the model text additively", () => {
    const text = scaffoldModelText(
      "{}",
      tree('<View><Component src="button" data="buttonProps"/></View>'),
      resolve,
    );
    expect(JSON.parse(text as string)).toEqual({ buttonProps: { label: "label", tint: "tint" } });
  });

  it("preserves user-edited values inside the data object on a re-scaffold", () => {
    const current = JSON.stringify({ buttonProps: { label: "Save" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button" data="buttonProps"/></View>'),
      resolve,
    );
    // `tint` is added; the user's `label` value is preserved (additive merge).
    expect(JSON.parse(text as string)).toEqual({ buttonProps: { label: "Save", tint: "tint" } });
  });
});

describe("reconcileModel — prune stale keys inside data objects", () => {
  const button = tree('<View><Text text="{label}"/></View>'); // child now uses only {label}
  const resolve = (name: string) => (name === "button" ? button : undefined);

  it("drops a data-object key the child no longer uses, keeps live ones", () => {
    // The model still carries a stale `tint` the child dropped; `label` survives.
    const current = JSON.stringify({ buttonProps: { label: "Save", tint: "old" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button" data="buttonProps"/></View>'),
      resolve,
    );
    expect(JSON.parse(text as string)).toEqual({ buttonProps: { label: "Save" } });
  });

  it("does NOT prune the component's OWN tokens (additive, leftovers kept)", () => {
    // `stale` is a root token no longer in the tree; it must be left alone.
    const current = JSON.stringify({ title: "Hi", stale: "x" });
    const text = scaffoldModelText(current, tree('<View><Text text="{title}"/></View>'));
    // Nothing to add and own-token pruning is off → no rewrite at all.
    expect(text).toBeNull();
  });

  it("returns null when a data object already matches the child shape", () => {
    const current = JSON.stringify({ buttonProps: { label: "Save" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button" data="buttonProps"/></View>'),
      resolve,
    );
    expect(text).toBeNull();
  });
});

describe("reconcileModel — orphaned data objects (data-key rename/removal)", () => {
  const button = tree('<View><Text text="{label}"/></View>');
  const resolve = (name: string) => (name === "button" ? button : undefined);

  it("drops a renamed-away data object (old key replaced, new key seeded)", () => {
    // The tree now binds data="newProps"; the model still carries the old "oldProps".
    const current = JSON.stringify({ oldProps: { label: "Save" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button" data="newProps"/></View>'),
      resolve,
    );
    expect(JSON.parse(text as string)).toEqual({ newProps: { label: "label" } });
  });

  it("drops a data object when the data binding is removed entirely", () => {
    const current = JSON.stringify({ buttonProps: { label: "Save" } });
    // No <Component data> anymore → buttonProps is an orphaned object → pruned.
    const text = scaffoldModelText(current, tree("<View><Text text=\"{title}\"/></View>"));
    expect(JSON.parse(text as string)).toEqual({ title: "title" });
  });

  it("keeps a referenced object the user authored for a dotted token", () => {
    // {stats.hp} records `stats` as a referenced scalar; the user made it an object.
    // It is referenced, so it must NOT be pruned despite being a plain object.
    const current = JSON.stringify({ stats: { hp: 10 } });
    const text = scaffoldModelText(current, tree('<View><Text text="{stats.hp}"/></View>'));
    expect(text).toBeNull(); // nothing added, nothing pruned
  });

  it("keeps scalar/array leftovers (own-token additive rule, not objects)", () => {
    const current = JSON.stringify({ title: "Hi", staleScalar: "x", staleArr: [{ a: "1" }] });
    const text = scaffoldModelText(current, tree('<View><Text text="{title}"/></View>'));
    expect(text).toBeNull(); // leftovers are scalar/array, never pruned
  });
});
