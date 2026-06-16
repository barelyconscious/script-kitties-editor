import { describe, expect, it } from "vitest";
import { isForEachTemplate, resolveCollection, stampForEach } from "./guiForEach";
import type { GuiNode } from "./guiNode";
import { mintNodeId } from "./guiNode";
import { ScopeStack } from "./guiScope";
import { isNodeSelected } from "./guiSelection";

/** Build a bare GuiNode with the given tag + attrs for stamping tests. */
function node(tag: GuiNode["tag"], attrs: Record<string, string>): GuiNode {
  return { nodeId: mintNodeId(), tag, attrs, children: [] };
}

describe("isForEachTemplate", () => {
  it("is true for a non-empty forEach attribute", () => {
    expect(isForEachTemplate(node("Panel", { forEach: "{items}" }))).toBe(true);
  });

  it("is false when forEach is absent", () => {
    expect(isForEachTemplate(node("Panel", { id: "x" }))).toBe(false);
  });

  it("is false for a blank forEach attribute", () => {
    expect(isForEachTemplate(node("Panel", { forEach: "   " }))).toBe(false);
  });
});

describe("resolveCollection", () => {
  it("resolves a {token} array in the enclosing scope", () => {
    const scope = ScopeStack.root({ items: [1, 2, 3] });
    expect(resolveCollection(node("Panel", { forEach: "{items}" }), scope)).toEqual([1, 2, 3]);
  });

  it("resolves the collection in the current ITEM scope when nested", () => {
    // forEach="{cells}" under an outer row item reads cells off the row.
    const rowScope = ScopeStack.root({}).push({ cells: ["a", "b"] });
    expect(resolveCollection(node("Panel", { forEach: "{cells}" }), rowScope)).toEqual(["a", "b"]);
  });

  it("resolves a $-prefixed collection against the root", () => {
    const item = ScopeStack.root({ all: [1] }).push({ name: "x" });
    expect(resolveCollection(node("Panel", { forEach: "{$.all}" }), item)).toEqual([1]);
  });

  it("returns null for an unresolved token (→ zero instances)", () => {
    const scope = ScopeStack.root({});
    expect(resolveCollection(node("Panel", { forEach: "{missing}" }), scope)).toBeNull();
  });

  it("returns null when the token binds to a non-array value", () => {
    const scope = ScopeStack.root({ items: { not: "an array" } });
    expect(resolveCollection(node("Panel", { forEach: "{items}" }), scope)).toBeNull();
  });

  it("returns null for a non-token / interpolated forEach value", () => {
    const scope = ScopeStack.root({ items: [1] });
    expect(resolveCollection(node("Panel", { forEach: "items" }), scope)).toBeNull();
    expect(resolveCollection(node("Panel", { forEach: "x{items}" }), scope)).toBeNull();
  });

  it("returns the empty array for an empty collection", () => {
    const scope = ScopeStack.root({ items: [] });
    expect(resolveCollection(node("Panel", { forEach: "{items}" }), scope)).toEqual([]);
  });
});

describe("stampForEach", () => {
  it("stamps a 3-item array into 3 instances", () => {
    const tmpl = node("Panel", { forEach: "{rows}" });
    const scope = ScopeStack.root({ rows: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    const instances = stampForEach(tmpl, scope);
    expect(instances).toHaveLength(3);
  });

  it("gives each instance an item-pushed scope (bare token resolves item-relative)", () => {
    const tmpl = node("Panel", { forEach: "{rows}" });
    const scope = ScopeStack.root({ currency: 99, rows: [{ name: "a" }, { name: "b" }] });
    const [first, second] = stampForEach(tmpl, scope);

    expect(first.scope.lookup("name")).toBe("a");
    expect(second.scope.lookup("name")).toBe("b");
    // An item-field miss does NOT fall through to the root.
    expect(first.scope.lookup("currency")).toBeUndefined();
    // $ still reaches the root from the item scope.
    expect(first.scope.lookup("$.currency")).toBe(99);
  });

  it("shares the template nodeId across instances and keys them positionally", () => {
    const tmpl = node("Panel", { forEach: "{rows}" });
    const scope = ScopeStack.root({ rows: ["x", "y"] });
    const instances = stampForEach(tmpl, scope);

    expect(instances[0].node.nodeId).toBe(tmpl.nodeId);
    expect(instances[1].node.nodeId).toBe(tmpl.nodeId);
    expect(instances[0].node).toBe(instances[1].node); // same template node object
    expect(instances.map((i) => i.instanceKey)).toEqual(["0", "1"]);
  });

  it("renders ZERO instances for an empty collection", () => {
    const scope = ScopeStack.root({ rows: [] });
    expect(stampForEach(node("Panel", { forEach: "{rows}" }), scope)).toEqual([]);
  });

  it("renders ZERO instances for an unresolved collection", () => {
    const scope = ScopeStack.root({});
    expect(stampForEach(node("Panel", { forEach: "{missing}" }), scope)).toEqual([]);
  });

  it("does not interpret the key attribute (stored verbatim, positional identity)", () => {
    const tmpl = node("Component", { forEach: "{rows}", key: "{id}", src: "slot.xml" });
    const scope = ScopeStack.root({ rows: [{ id: "alpha" }, { id: "beta" }] });
    const instances = stampForEach(tmpl, scope);
    // key is NOT used for the instance key — positional index is.
    expect(instances.map((i) => i.instanceKey)).toEqual(["0", "1"]);
    // The template node still carries the verbatim key attribute.
    expect(instances[0].node.attrs.key).toBe("{id}");
  });

  it("selecting any instance collapses to the template node", () => {
    // Selection compares only `node.nodeId`; since every instance shares the
    // template's nodeId, selecting the template id highlights every instance —
    // i.e. clicking any rendered instance (which yields the template nodeId off
    // the DOM) selects the template.
    const tmpl = node("Panel", { forEach: "{rows}" });
    const scope = ScopeStack.root({ rows: ["a", "b", "c"] });
    const instances = stampForEach(tmpl, scope);
    for (const instance of instances) {
      expect(isNodeSelected(instance.node.nodeId, tmpl.nodeId)).toBe(true);
    }
  });

  it("composes nested forEach by shadowing the outer item", () => {
    // outer rows → inner cells; the inner template's collection reads the row item.
    const root = ScopeStack.root({ rows: [{ cells: ["a", "b"] }, { cells: ["c"] }] });
    const outerTmpl = node("Panel", { forEach: "{rows}" });
    const outer = stampForEach(outerTmpl, root);
    expect(outer).toHaveLength(2);

    const innerTmpl = node("Text", { forEach: "{cells}" });
    const inner0 = stampForEach(innerTmpl, outer[0].scope);
    const inner1 = stampForEach(innerTmpl, outer[1].scope);
    expect(inner0).toHaveLength(2);
    expect(inner1).toHaveLength(1);
  });
});
