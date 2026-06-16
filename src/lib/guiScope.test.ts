import { describe, expect, it } from "vitest";
import { ScopeStack } from "./guiScope";

describe("ScopeStack.root", () => {
  it("resolves bare tokens against the root when no forEach is entered", () => {
    const scope = ScopeStack.root({ health: 15, maxHealth: 25 });
    expect(scope.lookup("health")).toBe(15);
    expect(scope.lookup("maxHealth")).toBe(25);
  });

  it("returns undefined for a missing root key (→ unresolved)", () => {
    const scope = ScopeStack.root({ health: 15 });
    expect(scope.lookup("money")).toBeUndefined();
  });

  it("treats a non-object root as empty (no bindable fields)", () => {
    expect(ScopeStack.root(null).lookup("x")).toBeUndefined();
    expect(ScopeStack.root([1, 2, 3]).lookup("0")).toBeUndefined();
    expect(ScopeStack.root(42).lookup("x")).toBeUndefined();
    expect(ScopeStack.root(undefined).lookup("x")).toBeUndefined();
  });

  it("does not fall through to prototype keys", () => {
    const scope = ScopeStack.root({ health: 15 });
    expect(scope.lookup("toString")).toBeUndefined();
    expect(scope.lookup("hasOwnProperty")).toBeUndefined();
  });

  it("resolves a falsy root value (0 / false / empty string)", () => {
    const scope = ScopeStack.root({ a: 0, b: false, c: "" });
    expect(scope.lookup("a")).toBe(0);
    expect(scope.lookup("b")).toBe(false);
    expect(scope.lookup("c")).toBe("");
  });

  it("starts at depth 1 (root only)", () => {
    expect(ScopeStack.root({}).depth).toBe(1);
  });
});

describe("ScopeStack.push — item-scoped bare tokens, no root fall-through", () => {
  it("resolves bare tokens against the pushed item", () => {
    const root = ScopeStack.root({ currency: 999 });
    const item = root.push({ name: "Bitlynx", color: "red" });
    expect(item.lookup("name")).toBe("Bitlynx");
    expect(item.lookup("color")).toBe("red");
  });

  it("does NOT fall through to the root for an item-field miss", () => {
    const root = ScopeStack.root({ currency: 999, name: "ROOT" });
    const item = root.push({ name: "Bitlynx" });
    // `name` is on the item — item wins.
    expect(item.lookup("name")).toBe("Bitlynx");
    // `currency` is only on the root — a bare token must NOT grab it.
    expect(item.lookup("currency")).toBeUndefined();
  });

  it("leaves the parent stack untouched (immutable push)", () => {
    const root = ScopeStack.root({ currency: 999 });
    root.push({ name: "x" });
    // The original stack still resolves against the root only.
    expect(root.lookup("currency")).toBe(999);
    expect(root.lookup("name")).toBeUndefined();
    expect(root.depth).toBe(1);
  });

  it("increments depth and tracks current/root frames", () => {
    const root = ScopeStack.root({ r: 1 });
    const item = root.push({ i: 2 });
    expect(item.depth).toBe(2);
    expect(item.current).toEqual({ i: 2 });
    expect(item.root).toEqual({ r: 1 });
  });
});

describe("ScopeStack — $ root escape", () => {
  it("{$.currency} resolves the root from inside an item scope", () => {
    const item = ScopeStack.root({ currency: 999 }).push({ name: "Bitlynx" });
    expect(item.lookup("$.currency")).toBe(999);
  });

  it("a bare $ denotes the root object itself", () => {
    const root = { currency: 999 };
    const item = ScopeStack.root(root).push({ name: "x" });
    expect(item.lookup("$")).toEqual(root);
  });

  it("$ reaches the root irrespective of nesting depth", () => {
    const stack = ScopeStack.root({ title: "T" }).push({ a: 1 }).push({ b: 2 });
    expect(stack.lookup("$.title")).toBe("T");
  });

  it("$.path walks a dotted path on the root", () => {
    const item = ScopeStack.root({ theme: { accent: "gold" } }).push({});
    expect(item.lookup("$.theme.accent")).toBe("gold");
  });

  it("a missing $-path segment stays unresolved", () => {
    const item = ScopeStack.root({ theme: { accent: "gold" } }).push({});
    expect(item.lookup("$.theme.missing")).toBeUndefined();
    expect(item.lookup("$.nope.accent")).toBeUndefined();
  });
});

describe("ScopeStack — nesting composes by lexical shadowing", () => {
  it("the inner item shadows the outer; only bare + $ are reachable", () => {
    // <Panel forEach="{rows}">  item A
    //   <Panel forEach="{cells}">  item B
    const root = ScopeStack.root({ title: "Grid" });
    const rowA = root.push({ label: "Row1", value: "OUTER" });
    const cellB = rowA.push({ value: "INNER" });

    // Bare token reads the nearest item (cell B) — outer `value` is shadowed.
    expect(cellB.lookup("value")).toBe("INNER");
    // The outer row's `label` is NOT reachable from the inner loop (no .. escape).
    expect(cellB.lookup("label")).toBeUndefined();
    // The root is still reachable via $.
    expect(cellB.lookup("$.title")).toBe("Grid");
  });

  it("a bare token absent on the inner item does not climb to the outer item", () => {
    const cell = ScopeStack.root({}).push({ outerOnly: "X" }).push({ innerOnly: "Y" });
    expect(cell.lookup("innerOnly")).toBe("Y");
    // `outerOnly` lives on the intermediate scope — not addressable.
    expect(cell.lookup("outerOnly")).toBeUndefined();
  });
});

describe("ScopeStack — dotted bare tokens walk the current item", () => {
  it("resolves a dotted path on the current item", () => {
    const item = ScopeStack.root({}).push({ stats: { hp: 12 } });
    expect(item.lookup("stats.hp")).toBe(12);
  });

  it("a dotted bare miss stays unresolved (no root fall-through)", () => {
    const item = ScopeStack.root({ stats: { hp: 99 } }).push({ name: "x" });
    expect(item.lookup("stats.hp")).toBeUndefined();
  });
});

describe("ScopeStack.asScope", () => {
  it("exposes a ResolveScope whose lookup matches the stack", () => {
    const item = ScopeStack.root({ currency: 5 }).push({ name: "Bitlynx" });
    const resolveScope = item.asScope();
    expect(resolveScope.lookup("name")).toBe("Bitlynx");
    expect(resolveScope.lookup("$.currency")).toBe(5);
    expect(resolveScope.lookup("currency")).toBeUndefined();
  });
});
