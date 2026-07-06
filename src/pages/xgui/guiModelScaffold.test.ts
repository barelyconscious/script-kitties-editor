/**
 * Tests the Data Model auto-scaffold: EXTRACT (tokens → a shape of scalars, nested
 * `$.` own-objects, `<Component data>` objects, and grid collections), BUILD (shape →
 * JSON with token-name placeholders), MERGE (additive — add missing, never
 * overwrite/delete a scalar leftover, defensive on type conflict), and the text wiring
 * (`scaffoldModelText` rewrites ONLY when there is something new to add).
 *
 * Tokens obey the XGUI binding GRAMMAR (the same authoritative table the resolver in
 * `guiBinding.ts` binds against): `$.` = View / local scope (dotted → nested objects),
 * bare = grid-item scope (ONLY inside a GridLayout child), `$name.` = named (deferred),
 * and the whole-object forms `{$.}`/`{.}`/`{$app.}` contribute no field.
 *
 * The tree is built from XML via `parseGui` so the tests exercise the real node shape
 * the editor feeds in (verbatim attribute strings).
 */

import { describe, expect, it } from "vitest";
import { parseGui } from "../../lib/guiNode";
import { buildModel, extractShape, mergeModel, scaffoldModelText } from "./guiModelScaffold";

/** Parse XML into the editor's node tree (the input the scaffold walks). */
function tree(xml: string) {
  return parseGui(xml);
}

describe("extractShape — token kinds ($. View scope)", () => {
  it("extracts every embedded token from interpolated string props (text/texture)", () => {
    const shape = extractShape(
      tree(
        '<View><Text text="Health: {$.health}/{$.maxHealth}" texture="icon_{$.kind}.png"/></View>',
      ),
    );
    expect([...shape.scalars].sort()).toEqual(["health", "kind", "maxHealth"]);
    expect(shape.objects.size).toBe(0);
    expect(shape.nested.size).toBe(0);
  });

  it("extracts whole-value typed/color props but NOT literals", () => {
    const shape = extractShape(
      tree(
        '<View><Panel backgroundColor="{$.barColor}" visible="{$.isOpen}" fontSize="{$.fs}" ' +
          'borderColor="{$.bc}" borderSize="{$.bs}" color="{$.tc}" textAlign="{$.ta}" ' +
          'layer="{$.lyr}" id="literalId" controller="ctrl"/></View>',
      ),
    );
    expect([...shape.scalars].sort()).toEqual(
      ["barColor", "bc", "bs", "fs", "isOpen", "lyr", "ta", "tc"].sort(),
    );
  });

  it("does NOT extract embedded tokens from typed props (whole-value only)", () => {
    // fontSize="x{$.n}" is not a whole token → literal, contributes nothing.
    const shape = extractShape(tree('<View><Text fontSize="x{$.n}"/></View>'));
    expect(shape.scalars.size).toBe(0);
  });

  it("extracts per-field tokens from compound position/size, ignoring literal fields", () => {
    const shape = extractShape(
      tree('<View><Panel size="{$.healthRatio},1,0,0" position="0,{$.offsetY},0,0"/></View>'),
    );
    expect([...shape.scalars].sort()).toEqual(["healthRatio", "offsetY"]);
  });

  it("skips literal-only structural props (id/src/controller)", () => {
    const shape = extractShape(
      tree('<View><Panel id="literalId" src="literal.xml" controller="ctrl"/></View>'),
    );
    expect(shape.scalars.size).toBe(0);
  });

  it("extracts tokens from every node in the tree", () => {
    const shape = extractShape(
      tree('<View><Panel backgroundColor="{$.a}"><Text text="{$.b}"/></Panel></View>'),
    );
    expect([...shape.scalars].sort()).toEqual(["a", "b"]);
  });
});

describe("extractShape — $. dotted paths build NESTED objects", () => {
  it("a two-segment path nests a scalar under an object", () => {
    const shape = extractShape(tree('<View><Text text="{$.stats.hp}"/></View>'));
    // Not head-segment-only: `stats` is a nested OBJECT holding scalar `hp`.
    expect(shape.scalars.size).toBe(0);
    expect([...(shape.nested.get("stats")?.scalars ?? [])]).toEqual(["hp"]);
    expect(buildModel(shape)).toEqual({ stats: { hp: "hp" } });
  });

  it("a three-segment path nests two levels deep", () => {
    const shape = extractShape(tree('<View><Text text="{$.a.b.c}"/></View>'));
    expect(buildModel(shape)).toEqual({ a: { b: { c: "c" } } });
  });

  it("merges sibling fields under the same nested object", () => {
    const shape = extractShape(
      tree('<View><Text text="{$.creature.name}" texture="{$.creature.sprite}"/></View>'),
    );
    expect(buildModel(shape)).toEqual({ creature: { name: "name", sprite: "sprite" } });
  });

  it("promotes a scalar to an object when a deeper path needs it (object wins)", () => {
    // `{$.creature}` alone would be a scalar; `{$.creature.sprite}` makes it an object.
    const shape = extractShape(
      tree('<View><Text text="{$.creature}"/><Panel texture="{$.creature.sprite}"/></View>'),
    );
    expect(shape.scalars.has("creature")).toBe(false);
    expect(buildModel(shape)).toEqual({ creature: { sprite: "sprite" } });
  });

  it("a single-segment $. path is a plain scalar", () => {
    const shape = extractShape(tree('<View><Text text="{$.health}"/></View>'));
    expect([...shape.scalars]).toEqual(["health"]);
    expect(shape.nested.size).toBe(0);
  });
});

describe("extractShape — whole-object forms and deferred scopes add no fields", () => {
  it("the whole-View form {$.} contributes no field", () => {
    const shape = extractShape(tree('<View><Text text="{$.}"/></View>'));
    expect(buildModel(shape)).toEqual({});
  });

  it("the whole-item form {.} contributes no field (even inside a grid child)", () => {
    const shape = extractShape(
      tree('<View><GridLayout dataCollection="{$.items}"><Text text="{.}"/></GridLayout></View>'),
    );
    // The collection exists (from dataCollection) but the {.} token adds no item field.
    expect(buildModel(shape)).toEqual({ items: [{}] });
  });

  it("a named-scope token {$app.theme} fabricates no root field (deferred)", () => {
    const shape = extractShape(tree('<View><Text text="{$app.theme}"/></View>'));
    expect(buildModel(shape)).toEqual({});
  });

  it("the whole named form {$app.} contributes no field", () => {
    const shape = extractShape(tree('<View><Text text="{$app.}"/></View>'));
    expect(buildModel(shape)).toEqual({});
  });
});

describe("extractShape — STRICT bare-at-root: no invented root key", () => {
  it("a bare token OUTSIDE a grid contributes nothing", () => {
    const shape = extractShape(tree('<View><Text text="{name}"/></View>'));
    expect(buildModel(shape)).toEqual({});
  });

  it("a bare dotted token OUTSIDE a grid contributes nothing", () => {
    const shape = extractShape(tree('<View><Text text="{stats.hp}"/></View>'));
    expect(buildModel(shape)).toEqual({});
  });

  it("bare and $. tokens mix: only the $. tokens seed the root", () => {
    const shape = extractShape(
      tree('<View><Text text="{name}"/><Panel texture="{$.sprite}"/></View>'),
    );
    // `{name}` (bare, outside a grid) is dropped; `{$.sprite}` is a root scalar.
    expect(buildModel(shape)).toEqual({ sprite: "sprite" });
  });
});

describe("buildModel — defaults are the token name", () => {
  it("each scalar defaults to its token name as a string", () => {
    const shape = extractShape(tree('<View><Text text="{$.health}"/></View>'));
    expect(buildModel(shape)).toEqual({ health: "health" });
  });
});

describe("mergeModel — additive only", () => {
  it("adds missing root keys without touching existing ones", () => {
    const shape = extractShape(tree('<View><Text text="{$.health} {$.mana}"/></View>'));
    const { model, added } = mergeModel({ health: 99 }, shape);
    expect(added).toBe(true);
    // existing value preserved; missing key added with its placeholder.
    expect(model).toEqual({ health: 99, mana: "mana" });
  });

  it("never overwrites an existing value (user edits win)", () => {
    const shape = extractShape(tree('<View><Text text="{$.health}"/></View>'));
    const { model, added } = mergeModel({ health: 15 }, shape);
    expect(added).toBe(false);
    expect(model).toEqual({ health: 15 });
  });

  it("never deletes keys for removed tokens (harmless leftovers)", () => {
    const shape = extractShape(tree('<View><Text text="{$.health}"/></View>'));
    const { model, added } = mergeModel({ health: 15, oldToken: "stale" }, shape);
    expect(added).toBe(false);
    expect(model).toEqual({ health: 15, oldToken: "stale" });
  });

  it("grows a nested own-object additively, keeping user-added inner fields", () => {
    const shape = extractShape(
      tree('<View><Text text="{$.creature.name}" texture="{$.creature.sprite}"/></View>'),
    );
    // User already authored creature.name plus an extra field; `sprite` is added,
    // the extra field is preserved (additive recursion into the plain object).
    const { model, added } = mergeModel({ creature: { name: "Bit", extra: "keep" } }, shape);
    expect(added).toBe(true);
    expect(model).toEqual({ creature: { name: "Bit", sprite: "sprite", extra: "keep" } });
  });

  it("is defensive on a type conflict: scaffold scalar vs. user object — leave it alone", () => {
    const shape = extractShape(tree('<View><Text text="{$.health}"/></View>'));
    const { model, added } = mergeModel({ health: { nested: true } }, shape);
    expect(added).toBe(false);
    expect(model).toEqual({ health: { nested: true } });
  });

  it("leaves a non-object root model untouched (nowhere to add root keys)", () => {
    const shape = extractShape(tree('<View><Text text="{$.health}"/></View>'));
    const { model, added } = mergeModel([1, 2, 3], shape);
    expect(added).toBe(false);
    expect(model).toEqual([1, 2, 3]);
  });
});

describe("scaffoldModelText — text rewrite only on new tokens", () => {
  it("pre-fills an empty model from the tree's tokens", () => {
    const text = scaffoldModelText("", tree('<View><Text text="{$.health}"/></View>'));
    expect(text).not.toBeNull();
    expect(JSON.parse(text as string)).toEqual({ health: "health" });
  });

  it("returns null (no rewrite) when nothing new is added", () => {
    const text = scaffoldModelText('{"health":15}', tree('<View><Text text="{$.health}"/></View>'));
    expect(text).toBeNull();
  });

  it("rewrites with the merged model when a new token appears", () => {
    const text = scaffoldModelText(
      '{"health":15}',
      tree('<View><Text text="{$.health} {$.mana}"/></View>'),
    );
    expect(text).not.toBeNull();
    expect(JSON.parse(text as string)).toEqual({ health: 15, mana: "mana" });
  });

  it("indents with two spaces (matches the panel's JSON formatting)", () => {
    const text = scaffoldModelText("", tree('<View><Text text="{$.health}"/></View>'));
    expect(text).toBe('{\n  "health": "health"\n}');
  });

  it("does not stomp unparseable in-progress text (returns null)", () => {
    const text = scaffoldModelText("{ not json", tree('<View><Text text="{$.health}"/></View>'));
    expect(text).toBeNull();
  });
});

describe("extractShape — nested <Component data> objects", () => {
  // A resolver standing in for the component registry: maps a basename to its tree.
  // The child's OWN tokens are $.-scoped (it is itself a <View>).
  const button = tree('<View><Text text="{$.label}"/><Panel backgroundColor="{$.tint}"/></View>');
  const resolve = (name: string) => (name === "button" ? button : undefined);

  it("folds the child component's shape under the data key as an object", () => {
    const shape = extractShape(
      tree('<View><Component src="button.xml" data="{$.buttonProps}"/></View>'),
      resolve,
    );
    expect(shape.scalars.size).toBe(0);
    expect([...(shape.objects.get("buttonProps")?.scalars ?? [])].sort()).toEqual([
      "label",
      "tint",
    ]);
    expect(buildModel(shape)).toEqual({ buttonProps: { label: "label", tint: "tint" } });
  });

  it("records the data key present-but-empty without a resolver", () => {
    const shape = extractShape(
      tree('<View><Component src="button.xml" data="{$.buttonProps}"/></View>'),
    );
    expect(shape.objects.has("buttonProps")).toBe(true);
    expect(buildModel(shape)).toEqual({ buttonProps: {} });
  });

  it("records present-but-empty when the child src can't be resolved", () => {
    const shape = extractShape(
      tree('<View><Component src="ghost.xml" data="{$.props}"/></View>'),
      resolve,
    );
    expect(buildModel(shape)).toEqual({ props: {} });
  });

  it("ignores a bare/legacy data value (unresolvable under the strict grammar)", () => {
    // A `data` value that is not a whole grammar token (no braces) no longer binds —
    // matching the resolver's `resolveWholeTokenValue` — so no data object is seeded.
    const shape = extractShape(
      tree('<View><Component src="button.xml" data="buttonProps"/></View>'),
      resolve,
    );
    expect(shape.objects.size).toBe(0);
  });

  it("ignores a whole-View data form {$.} (a pass-through, no new object)", () => {
    const shape = extractShape(
      tree('<View><Component src="button.xml" data="{$.}"/></View>'),
      resolve,
    );
    expect(shape.objects.size).toBe(0);
  });

  it("guards include cycles via the ancestry seed", () => {
    // A → A self-include: seeding ancestry with the component's own basename stops
    // the recursion folding itself in forever.
    const selfRef = tree('<View><Component src="a.xml" data="{$.self}"/></View>');
    const resolveSelf = (name: string) => (name === "a" ? selfRef : undefined);
    const shape = extractShape(selfRef, resolveSelf, new Set(["a"]));
    expect(buildModel(shape)).toEqual({ self: {} });
  });

  it("scaffolds the data object into the model text additively", () => {
    const text = scaffoldModelText(
      "{}",
      tree('<View><Component src="button.xml" data="{$.buttonProps}"/></View>'),
      resolve,
    );
    expect(JSON.parse(text as string)).toEqual({ buttonProps: { label: "label", tint: "tint" } });
  });

  it("preserves user-edited values inside the data object on a re-scaffold", () => {
    const current = JSON.stringify({ buttonProps: { label: "Save" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button.xml" data="{$.buttonProps}"/></View>'),
      resolve,
    );
    // `tint` is added; the user's `label` value is preserved (additive merge).
    expect(JSON.parse(text as string)).toEqual({ buttonProps: { label: "Save", tint: "tint" } });
  });
});

describe("reconcileModel — prune stale keys inside data objects", () => {
  const button = tree('<View><Text text="{$.label}"/></View>'); // child now uses only {$.label}
  const resolve = (name: string) => (name === "button" ? button : undefined);

  it("drops a data-object key the child no longer uses, keeps live ones", () => {
    // The model still carries a stale `tint` the child dropped; `label` survives.
    const current = JSON.stringify({ buttonProps: { label: "Save", tint: "old" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button.xml" data="{$.buttonProps}"/></View>'),
      resolve,
    );
    expect(JSON.parse(text as string)).toEqual({ buttonProps: { label: "Save" } });
  });

  it("does NOT prune the component's OWN tokens (additive, leftovers kept)", () => {
    // `stale` is a root token no longer in the tree; it must be left alone.
    const current = JSON.stringify({ title: "Hi", stale: "x" });
    const text = scaffoldModelText(current, tree('<View><Text text="{$.title}"/></View>'));
    // Nothing to add and own-token pruning is off → no rewrite at all.
    expect(text).toBeNull();
  });

  it("returns null when a data object already matches the child shape", () => {
    const current = JSON.stringify({ buttonProps: { label: "Save" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button.xml" data="{$.buttonProps}"/></View>'),
      resolve,
    );
    expect(text).toBeNull();
  });
});

describe("reconcileModel — orphaned data objects (data-key rename/removal)", () => {
  const button = tree('<View><Text text="{$.label}"/></View>');
  const resolve = (name: string) => (name === "button" ? button : undefined);

  it("drops a renamed-away data object (old key replaced, new key seeded)", () => {
    // The tree now binds data="{$.newProps}"; the model still carries old "oldProps".
    const current = JSON.stringify({ oldProps: { label: "Save" } });
    const text = scaffoldModelText(
      current,
      tree('<View><Component src="button.xml" data="{$.newProps}"/></View>'),
      resolve,
    );
    expect(JSON.parse(text as string)).toEqual({ newProps: { label: "label" } });
  });

  it("drops a data object when the data binding is removed entirely", () => {
    const current = JSON.stringify({ buttonProps: { label: "Save" } });
    // No <Component data> anymore → buttonProps is an orphaned object → pruned.
    const text = scaffoldModelText(current, tree('<View><Text text="{$.title}"/></View>'));
    expect(JSON.parse(text as string)).toEqual({ title: "title" });
  });

  it("keeps a nested own-object the user authored for a $. dotted token", () => {
    // {$.stats.hp} makes `stats` a referenced nested own-object; the user gave it a
    // value. It is referenced, so it must NOT be pruned (and merges additively).
    const current = JSON.stringify({ stats: { hp: 10 } });
    const text = scaffoldModelText(current, tree('<View><Text text="{$.stats.hp}"/></View>'));
    expect(text).toBeNull(); // nothing added, nothing pruned
  });

  it("keeps scalar/array leftovers (own-token additive rule, not objects)", () => {
    const current = JSON.stringify({ title: "Hi", staleScalar: "x", staleArr: [{ a: "1" }] });
    const text = scaffoldModelText(current, tree('<View><Text text="{$.title}"/></View>'));
    expect(text).toBeNull(); // leftovers are scalar/array, never pruned
  });
});

describe("GridLayout dataCollection — collection array of item objects", () => {
  it("scaffolds a Text child's bare token as a one-element array of item objects", () => {
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{name}"/></GridLayout></View>',
      ),
    );
    // The collection lives under the ROOT (from the $. dataCollection token); the child's
    // bare {name} is item-scope (an item field, not a root scalar).
    expect(shape.scalars.size).toBe(0);
    expect([...(shape.collections.get("items")?.scalars ?? [])]).toEqual(["name"]);
    expect(buildModel(shape)).toEqual({ items: [{ name: "name" }] });
  });

  it("seats an array-of-item-shape from {$.collection} + bare child tokens", () => {
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.creatures}">' +
          '<Panel texture="{sprite}"/></GridLayout></View>',
      ),
    );
    expect(buildModel(shape)).toEqual({ creatures: [{ sprite: "sprite" }] });
  });

  it("the GridLayout's own attrs (rows/columns/gutter/dataCollection) are not tokens", () => {
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.items}" rows="6" columns="6" gutter="5,5">' +
          '<Text text="{name}"/></GridLayout></View>',
      ),
    );
    expect(buildModel(shape)).toEqual({ items: [{ name: "name" }] });
  });

  it("both frames are live in a grid child: {$.x} → root, bare {x} → item", () => {
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.items}">' +
          '<Text text="{name}" texture="{$.atlas}"/></GridLayout></View>',
      ),
    );
    // `{$.atlas}` reaches the View root; `{name}` stays in the item.
    expect(buildModel(shape)).toEqual({ atlas: "atlas", items: [{ name: "name" }] });
  });

  it("builds nested item fields from a Panel child subtree", () => {
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.inventoryItems}"><Panel id="slots">' +
          '<Panel id="spritePanel" texture="{sprite}"/><Text id="nameText" text="{name}"/>' +
          "</Panel></GridLayout></View>",
      ),
    );
    expect([...(shape.collections.get("inventoryItems")?.scalars ?? [])].sort()).toEqual([
      "name",
      "sprite",
    ]);
    expect(buildModel(shape)).toEqual({ inventoryItems: [{ sprite: "sprite", name: "name" }] });
  });

  it("supports a bare dotted item token as a nested item object", () => {
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{creature.name}"/></GridLayout></View>',
      ),
    );
    // A bare (item-scope) dotted token nests within the item shape.
    expect(buildModel(shape)).toEqual({ items: [{ creature: { name: "name" } }] });
  });

  it("folds a <Component> grid child's shape flat into the item (item is the data root)", () => {
    const slot = tree('<View><Text text="{$.label}"/><Panel backgroundColor="{$.tint}"/></View>');
    const resolve = (name: string) => (name === "bag_slot" ? slot : undefined);
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.items}">' +
          '<Component id="slots" src="bag_slot.xml"/></GridLayout></View>',
      ),
      resolve,
    );
    // The component's OWN tokens land flat in the item — NOT under a sub-key.
    expect([...(shape.collections.get("items")?.scalars ?? [])].sort()).toEqual(["label", "tint"]);
    expect(buildModel(shape)).toEqual({ items: [{ label: "label", tint: "tint" }] });
  });

  it("records a present-but-empty item for an unresolvable <Component> grid child", () => {
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.items}">' +
          '<Component src="ghost.xml"/></GridLayout></View>',
      ),
    );
    expect(buildModel(shape)).toEqual({ items: [{}] });
  });

  it("scaffolds an empty model into a one-item array via the text wiring", () => {
    const text = scaffoldModelText(
      "",
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{name}"/></GridLayout></View>',
      ),
    );
    expect(JSON.parse(text as string)).toEqual({ items: [{ name: "name" }] });
  });

  it("returns null when the collection already matches (no new fields)", () => {
    const current = JSON.stringify({ items: [{ name: "Milk" }] });
    const text = scaffoldModelText(
      current,
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{name}"/></GridLayout></View>',
      ),
    );
    expect(text).toBeNull();
  });

  it("additively adds a NEW item field to ALL pre-authored items", () => {
    // User already authored three items with `name`; the child gained a {sprite} token.
    const current = JSON.stringify({
      items: [{ name: "Milk" }, { name: "Bread" }, { name: "Egg" }],
    });
    const text = scaffoldModelText(
      current,
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Panel>' +
          '<Text text="{name}"/><Panel texture="{sprite}"/></Panel></GridLayout></View>',
      ),
    );
    expect(JSON.parse(text as string)).toEqual({
      items: [
        { name: "Milk", sprite: "sprite" },
        { name: "Bread", sprite: "sprite" },
        { name: "Egg", sprite: "sprite" },
      ],
    });
  });

  it("never overwrites a user's per-item value (additive only)", () => {
    const current = JSON.stringify({ items: [{ name: "Milk", sprite: "item_milk.png" }] });
    const text = scaffoldModelText(
      current,
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{name} {sprite}"/></GridLayout></View>',
      ),
    );
    expect(text).toBeNull(); // nothing to add — user values untouched
  });

  it("leaves a removed item token as a harmless leftover (additive own-token rule)", () => {
    // Child dropped {sprite}; the stale per-item field stays (own-token, never pruned).
    const current = JSON.stringify({ items: [{ name: "Milk", sprite: "item_milk.png" }] });
    const text = scaffoldModelText(
      current,
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{name}"/></GridLayout></View>',
      ),
    );
    expect(text).toBeNull();
  });

  it("prune-syncs a nested <Component data> object INSIDE a grid item", () => {
    // The grid item holds a Panel with a nested <Component data="{badge}"> (bare/item
    // frame) whose child now uses only {$.label}; a stale `tint` inside that data object
    // is pruned. The bare `{badge}` seats the data object INSIDE the item.
    const badge = tree('<View><Text text="{$.label}"/></View>');
    const resolve = (name: string) => (name === "badge" ? badge : undefined);
    const current = JSON.stringify({
      items: [{ name: "Milk", badge: { label: "x", tint: "old" } }],
    });
    const text = scaffoldModelText(
      current,
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Panel>' +
          '<Text text="{name}"/><Component src="badge.xml" data="{badge}"/>' +
          "</Panel></GridLayout></View>",
      ),
      resolve,
    );
    // `tint` pruned (data object mirrors the component); `name` + label preserved.
    expect(JSON.parse(text as string)).toEqual({
      items: [{ name: "Milk", badge: { label: "x" } }],
    });
  });

  it("seeds one sample item when the array is present but empty", () => {
    const current = JSON.stringify({ items: [] });
    const text = scaffoldModelText(
      current,
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{name}"/></GridLayout></View>',
      ),
    );
    expect(JSON.parse(text as string)).toEqual({ items: [{ name: "name" }] });
  });

  it("leaves primitive (non-object) items alone — collections of non-objects are allowed", () => {
    // A collection of strings: items have no indexable fields, so there is nothing to
    // merge into each element. The grid child's token still records the item shape but
    // primitive elements are left untouched.
    const current = JSON.stringify({ items: ["a", "b"] });
    const text = scaffoldModelText(
      current,
      tree(
        '<View><GridLayout dataCollection="{$.items}"><Text text="{name}"/></GridLayout></View>',
      ),
    );
    // Each primitive element is left alone; no field merge happens → no rewrite.
    expect(text).toBeNull();
  });

  it("does not contribute the grid template's bare tokens to the ROOT scalars", () => {
    // A root Text with {$.title} plus a grid; only {$.title} is a root scalar, the bare
    // {name} is item-scope.
    const shape = extractShape(
      tree(
        '<View><Text text="{$.title}"/>' +
          '<GridLayout dataCollection="{$.items}"><Text text="{name}"/></GridLayout></View>',
      ),
    );
    expect([...shape.scalars]).toEqual(["title"]);
    expect(buildModel(shape)).toEqual({ title: "title", items: [{ name: "name" }] });
  });

  it("seats a NESTED grid's bare dataCollection as an array-valued item field", () => {
    // Outer grid over {$.packs}; each pack item holds an inner grid over bare
    // {creatures} — an item-frame collection, so `creatures` is a field of the pack item.
    const shape = extractShape(
      tree(
        '<View><GridLayout dataCollection="{$.packs}"><Panel>' +
          '<Text text="{packName}"/>' +
          '<GridLayout dataCollection="{creatures}"><Text text="{name}"/></GridLayout>' +
          "</Panel></GridLayout></View>",
      ),
    );
    expect(buildModel(shape)).toEqual({
      packs: [{ packName: "packName", creatures: [{ name: "name" }] }],
    });
  });
});
