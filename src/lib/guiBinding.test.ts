import { describe, expect, it } from "vitest";
import {
  colorCodeToCss,
  emptyItemScope,
  gridItemScope,
  hasToken,
  isWholeToken,
  resolveAttr,
  resolveAttrs,
  resolveColorProp,
  resolveCompoundProp,
  resolveStringProp,
  resolveTypedProp,
  resolveWholeTokenValue,
  viewScope,
} from "./guiBinding";

describe("viewScope (the `$.` View frame)", () => {
  it("walks a `$.` dotted path against the model", () => {
    const scope = viewScope({ creature: { sprite: "bitlynx.png", stats: { hp: 12 } } });
    expect(scope.lookup("$.creature.sprite")).toBe("bitlynx.png");
    expect(scope.lookup("$.creature.stats.hp")).toBe(12);
  });

  it("resolves a top-level `$.field`", () => {
    const scope = viewScope({ health: 15, maxHealth: 25 });
    expect(scope.lookup("$.health")).toBe(15);
    expect(scope.lookup("$.maxHealth")).toBe(25);
  });

  it("`$.` yields the WHOLE model (whole-object form)", () => {
    const model = { creature: { name: "Bit" } };
    expect(viewScope(model).lookup("$.")).toBe(model);
  });

  it("returns undefined for a missing `$.` key (→ unresolved)", () => {
    const scope = viewScope({ health: 15 });
    expect(scope.lookup("$.money")).toBeUndefined();
    expect(scope.lookup("$.creature.sprite")).toBeUndefined();
  });

  it("STRICT: a BARE token is unresolved at the View level (grid-only)", () => {
    const scope = viewScope({ health: 15, sprite: "x.png" });
    expect(scope.lookup("health")).toBeUndefined();
    expect(scope.lookup("sprite")).toBeUndefined();
    // `.` (whole-item form) is likewise meaningless outside a grid.
    expect(scope.lookup(".")).toBeUndefined();
  });

  it("a `$name.` reference is recognized but DEFERRED (unresolved, no crash)", () => {
    const scope = viewScope({ app: { theme: "dark" } });
    expect(scope.lookup("$app.theme")).toBeUndefined();
    expect(scope.lookup("$app.")).toBeUndefined();
    expect(scope.lookup("$theme.color")).toBeUndefined();
  });

  it("treats a non-object model as having no fields (`$.x` misses)", () => {
    expect(viewScope(null).lookup("$.x")).toBeUndefined();
    expect(viewScope([1, 2, 3]).lookup("$.x")).toBeUndefined();
    expect(viewScope(42).lookup("$.x")).toBeUndefined();
    expect(viewScope(undefined).lookup("$.x")).toBeUndefined();
  });

  it("walks own-array-index keys under `$.`", () => {
    expect(viewScope({ items: ["a", "b"] }).lookup("$.items.1")).toBe("b");
  });

  it("does not fall through to prototype keys", () => {
    const scope = viewScope({ health: 15 });
    expect(scope.lookup("$.toString")).toBeUndefined();
    expect(scope.lookup("$.hasOwnProperty")).toBeUndefined();
  });

  it("resolves a `$.` key whose value is falsy (0 / false / empty string)", () => {
    const scope = viewScope({ count: 0, open: false, label: "" });
    expect(scope.lookup("$.count")).toBe(0);
    expect(scope.lookup("$.open")).toBe(false);
    expect(scope.lookup("$.label")).toBe("");
  });
});

describe("gridItemScope (composite item-over-View frame)", () => {
  // The crux (Edge 1): inside a grid child, the item frame AND the View frame are
  // BOTH live — a bare token hits the item, `$.` still reaches the View model. The
  // item does NOT shadow `$.`.
  const view = viewScope({ creature: { name: "Bitlynx", hovered: true }, title: "Packs" });
  const item = { sprite: "cat.png", name: "Cat", stats: { atk: 3 } };
  const scope = gridItemScope(item, view);

  it("a BARE token resolves against the current grid ITEM", () => {
    expect(scope.lookup("sprite")).toBe("cat.png");
    expect(scope.lookup("name")).toBe("Cat");
    expect(scope.lookup("stats.atk")).toBe(3);
  });

  it("`.` yields the WHOLE current grid item", () => {
    expect(scope.lookup(".")).toBe(item);
  });

  it("`$.x` STILL reaches the View model (the item does not shadow `$.`)", () => {
    expect(scope.lookup("$.creature.name")).toBe("Bitlynx");
    expect(scope.lookup("$.creature.hovered")).toBe(true);
    expect(scope.lookup("$.title")).toBe("Packs");
  });

  it("`$.` yields the whole View model, not the item", () => {
    const model = { title: "Packs" };
    expect(gridItemScope(item, viewScope(model)).lookup("$.")).toBe(model);
  });

  it("a bare miss on the item is undefined (→ unresolved)", () => {
    expect(scope.lookup("missing")).toBeUndefined();
  });

  it("a `$name.` reference is still deferred (delegated to the View frame)", () => {
    expect(scope.lookup("$app.theme")).toBeUndefined();
  });

  it("a null/non-object item makes bare tokens miss but `$.` still resolves", () => {
    const s = gridItemScope(null, view);
    expect(s.lookup("sprite")).toBeUndefined();
    expect(s.lookup("$.title")).toBe("Packs");
  });
});

describe("emptyItemScope (null grid cell)", () => {
  it('resolves EVERY token form to "" (a successful resolution, not a miss)', () => {
    const scope = emptyItemScope();
    expect(scope.lookup("name")).toBe("");
    expect(scope.lookup("sprite")).toBe("");
    expect(scope.lookup("$.creature.name")).toBe("");
    expect(scope.lookup(".")).toBe("");
    expect(scope.lookup("$app.theme")).toBe("");
  });

  it('makes a null cell\'s {token} attrs resolve to "" with no unresolved entry', () => {
    // The bug: a live scope MISSES every unbound token → attr lands in `unresolved`
    // → the amber waiting affordance + literal `{name}` text. emptyItemScope() must
    // instead resolve each token to "" with resolved: true (no waiting state).
    const rawAttrs = {
      text: "{name}", // string interpolation → ""
      texture: "{sprite}", // string interpolation → "" (no sprite load)
      backgroundColor: "{c}", // color whole-token → "" → colorCodeToCss unset
      visible: "{v}", // typed whole-token → "" (not "false" → still shows)
      size: "{w},1,0,0", // compound per-field → ",1,0,0"
    };
    const { attrs, unresolved } = resolveAttrs(rawAttrs, emptyItemScope(), {});

    // Nothing is flagged as waiting-for-binding.
    expect(unresolved.size).toBe(0);
    // Tokens collapsed to "" rather than leaking their literal `{token}` form.
    expect(attrs.text).toBe("");
    expect(attrs.texture).toBe("");
    expect(attrs.backgroundColor).toBe("");
    expect(colorCodeToCss(attrs.backgroundColor)).toBeUndefined();
    expect(attrs.visible).toBe("");
    expect(attrs.size).toBe(",1,0,0");
  });

  it("leaves a non-token literal attr untouched so the chrome still paints", () => {
    // An empty inventory slot's literal backgroundColor must still fill.
    const { attrs, unresolved } = resolveAttrs(
      { backgroundColor: "50,50,50,255" },
      emptyItemScope(),
      {},
    );
    expect(unresolved.size).toBe(0);
    expect(attrs.backgroundColor).toBe("50,50,50,255");
    expect(colorCodeToCss(attrs.backgroundColor)).toBe("rgba(50,50,50,1)");
  });
});

describe("isWholeToken / hasToken", () => {
  it("isWholeToken is true only when the whole string is one {token}", () => {
    expect(isWholeToken("{$.x}")).toBe(true);
    expect(isWholeToken("  {$.x}  ")).toBe(true);
    expect(isWholeToken("{.}")).toBe(true);
    expect(isWholeToken("a {$.x}")).toBe(false);
    expect(isWholeToken("{$.x}{$.y}")).toBe(false);
    expect(isWholeToken("0.5")).toBe(false);
  });

  it("hasToken detects an embedded token anywhere", () => {
    expect(hasToken("Health: {$.health}")).toBe(true);
    expect(hasToken("{$.x}")).toBe(true);
    expect(hasToken("plain")).toBe(false);
  });
});

describe("resolveWholeTokenValue (object-valued consumers: data=/dataCollection)", () => {
  it("returns the raw bound OBJECT for a whole `{$.x}` (unstringified)", () => {
    const data = { label: "Save", tint: "Accent" };
    expect(resolveWholeTokenValue("{$.buttonData}", viewScope({ buttonData: data }))).toBe(data);
  });

  it("returns the raw bound ARRAY for a `dataCollection` token", () => {
    const creatures = [{ sprite: "a" }, { sprite: "b" }];
    expect(resolveWholeTokenValue("{$.creatures}", viewScope({ creatures }))).toBe(creatures);
  });

  it("resolves `{$.}` to the whole View model (transparency mount)", () => {
    const model = { a: 1 };
    expect(resolveWholeTokenValue("{$.}", viewScope(model))).toBe(model);
  });

  it("resolves `{.}` to the whole grid item inside a grid", () => {
    const item = { sprite: "cat.png" };
    expect(resolveWholeTokenValue("{.}", gridItemScope(item, viewScope({})))).toBe(item);
  });

  it("returns undefined when the raw is not a whole token", () => {
    expect(resolveWholeTokenValue("buttonData", viewScope({ buttonData: {} }))).toBeUndefined();
    expect(resolveWholeTokenValue("prefix {$.x}", viewScope({ x: 1 }))).toBeUndefined();
    expect(resolveWholeTokenValue("", viewScope({}))).toBeUndefined();
  });

  it("returns undefined for an unbound whole token", () => {
    expect(resolveWholeTokenValue("{$.missing}", viewScope({}))).toBeUndefined();
  });
});

describe("resolveStringProp (interpolation)", () => {
  it("interpolates 'Health: {$.health}/{$.maxHealth}' → 'Health: 15/25'", () => {
    // The headline acceptance-criteria example.
    const scope = viewScope({ health: 15, maxHealth: 25 });
    expect(resolveStringProp("Health: {$.health}/{$.maxHealth}", scope)).toEqual({
      value: "Health: 15/25",
      resolved: true,
    });
  });

  it("interpolates a real `$.`-nested string binding", () => {
    // Real kittypacks usage: text="Creature's name is: {$.creature.name}".
    const scope = viewScope({ creature: { name: "Bitlynx" } });
    expect(resolveStringProp("Creature's name is: {$.creature.name}", scope)).toEqual({
      value: "Creature's name is: Bitlynx",
      resolved: true,
    });
  });

  it("interpolates a texture name 'icon_{$.type}.png'", () => {
    const scope = viewScope({ type: "fire" });
    expect(resolveStringProp("icon_{$.type}.png", scope)).toEqual({
      value: "icon_fire.png",
      resolved: true,
    });
  });

  it("interpolates a BARE token against the grid item (in a grid)", () => {
    // Real kittypacks usage inside a GridLayout child: text="{name}".
    const scope = gridItemScope({ name: "Cat" }, viewScope({}));
    expect(resolveStringProp("{name}", scope)).toEqual({ value: "Cat", resolved: true });
  });

  it("passes a token-free string through as resolved", () => {
    expect(resolveStringProp("Bag", viewScope({}))).toEqual({
      value: "Bag",
      resolved: true,
    });
  });

  it("leaves an unbound token literal and marks unresolved", () => {
    const scope = viewScope({ health: 15 });
    expect(resolveStringProp("Health: {$.health}/{$.maxHealth}", scope)).toEqual({
      value: "Health: 15/{$.maxHealth}",
      resolved: false,
    });
  });

  it("STRICT: a bare token outside a grid stays literal + unresolved", () => {
    const scope = viewScope({ health: 15 });
    expect(resolveStringProp("HP {health}", scope)).toEqual({
      value: "HP {health}",
      resolved: false,
    });
  });

  it("stringifies boolean and number bindings", () => {
    const scope = viewScope({ n: 3, b: true });
    expect(resolveStringProp("{$.n}-{$.b}", scope).value).toBe("3-true");
  });
});

describe("resolveTypedProp (whole-value)", () => {
  it("binds a whole `$.` token to the entire value", () => {
    const scope = viewScope({ isOpen: true, fs: 22 });
    expect(resolveTypedProp("{$.isOpen}", scope)).toEqual({ value: "true", resolved: true });
    expect(resolveTypedProp("{$.fs}", scope)).toEqual({ value: "22", resolved: true });
  });

  it("binds a whole BARE token against the grid item (in a grid)", () => {
    const scope = gridItemScope({ visible: false }, viewScope({}));
    expect(resolveTypedProp("{visible}", scope)).toEqual({ value: "false", resolved: true });
  });

  it("passes a literal through unchanged", () => {
    expect(resolveTypedProp("14", viewScope({}))).toEqual({ value: "14", resolved: true });
    expect(resolveTypedProp("false", viewScope({}))).toEqual({
      value: "false",
      resolved: true,
    });
  });

  it("marks an unbound whole token unresolved, keeping the literal token", () => {
    expect(resolveTypedProp("{$.missing}", viewScope({}))).toEqual({
      value: "{$.missing}",
      resolved: false,
    });
  });

  it("STRICT: a bare whole token outside a grid is unresolved", () => {
    expect(resolveTypedProp("{isOpen}", viewScope({ isOpen: true }))).toEqual({
      value: "{isOpen}",
      resolved: false,
    });
  });

  it("does NOT interpolate an embedded token in a typed prop (whole-value only)", () => {
    // A partial token in a typed prop is treated as the literal string it is.
    const scope = viewScope({ n: 3 });
    expect(resolveTypedProp("x{$.n}", scope)).toEqual({ value: "x{$.n}", resolved: true });
  });
});

describe("resolveColorProp (palette three-step)", () => {
  const palette = { TextDefault: "185,178,165,255", Accent: "255,210,40,255" };

  it("(1) binds a `$.` {token} from the model", () => {
    const scope = viewScope({ barColor: "10,20,30,255" });
    expect(resolveColorProp("{$.barColor}", scope, palette)).toEqual({
      value: "10,20,30,255",
      resolved: true,
    });
  });

  it("(1b) binds a bare color token against the grid item (in a grid)", () => {
    const scope = gridItemScope({ tint: "1,2,3,255" }, viewScope({}));
    expect(resolveColorProp("{tint}", scope, palette)).toEqual({
      value: "1,2,3,255",
      resolved: true,
    });
  });

  it("(2) resolves a palette name to its code", () => {
    expect(resolveColorProp("TextDefault", viewScope({}), palette)).toEqual({
      value: "185,178,165,255",
      resolved: true,
    });
  });

  it("(3) passes a literal r,g,b,a code through", () => {
    expect(resolveColorProp("185,178,165,255", viewScope({}), palette)).toEqual({
      value: "185,178,165,255",
      resolved: true,
    });
  });

  it("accepts a literal r,g,b code (no alpha)", () => {
    expect(resolveColorProp("0,0,0", viewScope({}), palette).resolved).toBe(true);
  });

  it("marks an unbound color {token} unresolved", () => {
    expect(resolveColorProp("{$.barColor}", viewScope({}), palette)).toEqual({
      value: "{$.barColor}",
      resolved: false,
    });
  });

  it("marks a dangling palette name (renamed/removed) unresolved", () => {
    expect(resolveColorProp("GoneColor", viewScope({}), palette)).toEqual({
      value: "GoneColor",
      resolved: false,
    });
  });

  it("recoloring the palette changes what a palette name resolves to", () => {
    const recolored = { ...palette, TextDefault: "10,10,10,255" };
    expect(resolveColorProp("TextDefault", viewScope({}), recolored).value).toBe("10,10,10,255");
  });
});

describe("resolveCompoundProp (per-field)", () => {
  it("binds scale-x only for size='{$.healthRatio},1,0,0', leaving the rest literal", () => {
    // The acceptance-criteria health-bar example.
    const scope = viewScope({ healthRatio: 0.5 });
    expect(resolveCompoundProp("{$.healthRatio},1,0,0", scope)).toEqual({
      value: "0.5,1,0,0",
      resolved: true,
    });
  });

  it("binds a bare compound field against the grid item (in a grid)", () => {
    const scope = gridItemScope({ w: 0.25 }, viewScope({}));
    expect(resolveCompoundProp("{w},1,0,0", scope)).toEqual({
      value: "0.25,1,0,0",
      resolved: true,
    });
  });

  it("mixes a composite `$.` field and a bare item field in a grid", () => {
    const scope = gridItemScope({ rx: 0.5 }, viewScope({ ax: 12 }));
    expect(resolveCompoundProp("{rx},0,{$.ax},0", scope)).toEqual({
      value: "0.5,0,12,0",
      resolved: true,
    });
  });

  it("passes an all-literal compound through", () => {
    expect(resolveCompoundProp("0.5,1,0,0", viewScope({}))).toEqual({
      value: "0.5,1,0,0",
      resolved: true,
    });
  });

  it("leaves an unbound field literal and marks unresolved", () => {
    expect(resolveCompoundProp("{$.missing},1,0,0", viewScope({}))).toEqual({
      value: "{$.missing},1,0,0",
      resolved: false,
    });
  });

  it("STRICT: a bare compound field outside a grid is unresolved", () => {
    expect(resolveCompoundProp("{ratio},1,0,0", viewScope({ ratio: 0.5 }))).toEqual({
      value: "{ratio},1,0,0",
      resolved: false,
    });
  });

  it("resolves multiple bound `$.` fields independently", () => {
    const scope = viewScope({ rx: 1, ax: 5 });
    expect(resolveCompoundProp("{$.rx},0,{$.ax},0", scope)).toEqual({
      value: "1,0,5,0",
      resolved: true,
    });
  });
});

describe("colorCodeToCss", () => {
  it("converts r,g,b,a (alpha 0-255) to rgba (alpha 0-1)", () => {
    expect(colorCodeToCss("185,178,165,255")).toBe("rgba(185,178,165,1)");
    expect(colorCodeToCss("0,0,0,128")).toBe("rgba(0,0,0,0.5019607843137255)");
  });

  it("defaults a missing alpha to opaque", () => {
    expect(colorCodeToCss("10,20,30")).toBe("rgba(10,20,30,1)");
  });

  it("returns undefined for a non-code (e.g. an unresolved {token} left literal)", () => {
    expect(colorCodeToCss("{$.barColor}")).toBeUndefined();
    expect(colorCodeToCss("TextDefault")).toBeUndefined();
    expect(colorCodeToCss(undefined)).toBeUndefined();
    expect(colorCodeToCss("")).toBeUndefined();
  });
});

describe("resolveAttr (dispatch by name)", () => {
  const palette = { Accent: "255,210,40,255" };
  const scope = viewScope({ health: 15, maxHealth: 25, isOpen: true, ratio: 0.5 });

  it("dispatches text as a string prop (interpolation)", () => {
    expect(resolveAttr("text", "Health: {$.health}/{$.maxHealth}", scope, palette).value).toBe(
      "Health: 15/25",
    );
  });

  it("dispatches texture as a string prop", () => {
    expect(resolveAttr("texture", "icon_{$.type}.png", scope, palette).resolved).toBe(false);
  });

  it("dispatches backgroundColor as a color prop", () => {
    expect(resolveAttr("backgroundColor", "Accent", scope, palette).value).toBe("255,210,40,255");
  });

  it("dispatches position/size as compound props", () => {
    expect(resolveAttr("size", "{$.ratio},1,0,0", scope, palette).value).toBe("0.5,1,0,0");
  });

  it("dispatches visible/fontSize as whole-value typed props", () => {
    expect(resolveAttr("visible", "{$.isOpen}", scope, palette).value).toBe("true");
  });

  it("leaves literal-only structural attrs verbatim (id, src, handlers)", () => {
    // These must NEVER bind, even if they look like a token.
    expect(resolveAttr("id", "{$.health}", scope, palette)).toEqual({
      value: "{$.health}",
      resolved: true,
    });
    expect(resolveAttr("src", "bag_slot.xml", scope, palette).value).toBe("bag_slot.xml");
    expect(resolveAttr("onMouseClicked", "{$.health}", scope, palette).value).toBe("{$.health}");
  });
});

describe("resolveAttrs (whole node bag)", () => {
  const palette = { Accent: "255,210,40,255" };

  it("resolves every attr and reports which were unresolved", () => {
    const scope = viewScope({ health: 15 });
    const result = resolveAttrs(
      {
        text: "HP {$.health}",
        backgroundColor: "Accent",
        color: "{$.missingColor}",
        size: "{$.missingRatio},1,0,0",
      },
      scope,
      palette,
    );
    expect(result.attrs.text).toBe("HP 15");
    expect(result.attrs.backgroundColor).toBe("255,210,40,255");
    expect(result.attrs.color).toBe("{$.missingColor}");
    expect(result.attrs.size).toBe("{$.missingRatio},1,0,0");
    expect([...result.unresolved].sort()).toEqual(["color", "size"]);
  });

  it("resolves a real grid-child node bag against a composite scope", () => {
    // Mirrors the kittypacks in-grid Panel: texture="{sprite}" (item) with a
    // View-frame color, and a child text="{name}" (item).
    const scope = gridItemScope(
      { sprite: "cat.png", name: "Cat" },
      viewScope({ borderTint: "255,255,0,255" }),
    );
    const result = resolveAttrs(
      { texture: "{sprite}", text: "{name}", borderColor: "{$.borderTint}" },
      scope,
      {},
    );
    expect(result.attrs.texture).toBe("cat.png");
    expect(result.attrs.text).toBe("Cat");
    expect(result.attrs.borderColor).toBe("255,255,0,255");
    expect(result.unresolved.size).toBe(0);
  });

  it("preserves all keys and reports no unresolved when fully bound", () => {
    const scope = viewScope({ health: 15 });
    const result = resolveAttrs({ text: "HP {$.health}", id: "hp" }, scope, palette);
    expect(Object.keys(result.attrs).sort()).toEqual(["id", "text"]);
    expect(result.unresolved.size).toBe(0);
  });
});
