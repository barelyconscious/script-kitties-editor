import { describe, expect, it } from "vitest";
import { flatRootScope } from "./guiBinding";
import {
  mountDecision,
  resolveChildRoot,
  resolveOverrides,
  srcBasename,
} from "./guiComponentMount";
import type { GuiNode } from "./guiNode";
import { mintNodeId } from "./guiNode";

/** Build a bare `<Component>` GuiNode with the given attrs. */
function component(attrs: Record<string, string>): GuiNode {
  return { nodeId: mintNodeId(), tag: "Component", attrs, children: [] };
}

describe("srcBasename", () => {
  it("returns a bare basename unchanged", () => {
    expect(srcBasename("bag_slot.xml")).toBe("bag_slot.xml");
  });

  it("strips path segments (defensive — src is basename by design)", () => {
    expect(srcBasename("widgets/bag_slot.xml")).toBe("bag_slot.xml");
    expect(srcBasename("a\\b\\bag_slot.xml")).toBe("bag_slot.xml");
  });

  it("trims surrounding whitespace", () => {
    expect(srcBasename("  bag_slot.xml  ")).toBe("bag_slot.xml");
  });

  it("maps blank/absent to the empty string (→ missing)", () => {
    expect(srcBasename("")).toBe("");
    expect(srcBasename("   ")).toBe("");
    expect(srcBasename(undefined)).toBe("");
  });
});

describe("resolveOverrides — child fresh-root model (F6a)", () => {
  it("passes literal overrides straight through as concrete values", () => {
    const node = component({ src: "row.xml", actionText: "Sell", qty: "3" });
    const overrides = resolveOverrides(node, flatRootScope({}));
    expect(overrides).toEqual({ actionText: "Sell", qty: "3" });
  });

  it("excludes structural attrs (src/id/geometry/layer/visible)", () => {
    const node = component({
      src: "row.xml",
      id: "slot",
      position: "0,0,0,0",
      size: "0,0,64,64",
      layer: "5",
      visible: "true",
      label: "Hi",
    });
    const overrides = resolveOverrides(node, flatRootScope({}));
    // Only the freeform `label` survives as a data override.
    expect(overrides).toEqual({ label: "Hi" });
  });

  it("PRE-RESOLVES a bare token override in the PARENT scope", () => {
    const scope = flatRootScope({ name: "Bitlynx" });
    const node = component({ src: "slot.xml", label: "{name}" });
    const overrides = resolveOverrides(node, scope);
    expect(overrides).toEqual({ label: "Bitlynx" });
  });

  it("interpolates string-form overrides in the parent scope", () => {
    const scope = flatRootScope({ n: 7 });
    const node = component({ src: "slot.xml", caption: "Item {n}" });
    const overrides = resolveOverrides(node, scope);
    expect(overrides).toEqual({ caption: "Item 7" });
  });

  it("passes an UNRESOLVED-in-parent override as its literal token form (visible miss)", () => {
    // {missing} is not in the parent model → it stays "{missing}", surfacing the
    // miss visibly at the boundary rather than silently re-resolving in the child.
    const node = component({ src: "slot.xml", label: "{missing}" });
    const overrides = resolveOverrides(node, flatRootScope({ other: 1 }));
    expect(overrides).toEqual({ label: "{missing}" });
  });

  it("builds a fresh root with NO parent data leak", () => {
    // The parent has `money`; the child is NOT handed it (not named as an override).
    const node = component({ src: "slot.xml", qty: "3" });
    const overrides = resolveOverrides(node, flatRootScope({ money: 999 }));
    expect(overrides).not.toHaveProperty("money");
    // And the child root resolves its own bare tokens against overrides only:
    const childScope = flatRootScope(overrides);
    expect(childScope.lookup("qty")).toBe("3");
    expect(childScope.lookup("money")).toBeUndefined(); // no parent fall-through
  });

  it("excludes the `data` attr from the flat overrides", () => {
    const node = component({ src: "button.xml", data: "buttonProps", label: "Hi" });
    expect(resolveOverrides(node, flatRootScope({ buttonProps: { label: "x" } }))).toEqual({
      label: "Hi",
    });
  });
});

describe("resolveChildRoot — data base + overrides layered on top", () => {
  it("seats the named data object as the child's whole root", () => {
    const node = component({ src: "button.xml", data: "buttonProps" });
    const parent = flatRootScope({ buttonProps: { label: "Save", tint: "{accent}" } });
    expect(resolveChildRoot(node, parent)).toEqual({ label: "Save", tint: "{accent}" });
  });

  it("layers explicit override attrs ON TOP of the data base", () => {
    const node = component({ src: "button.xml", data: "buttonProps", label: "Override" });
    const parent = flatRootScope({ buttonProps: { label: "Base", icon: "star" } });
    // The override wins for `label`; untouched base fields survive.
    expect(resolveChildRoot(node, parent)).toEqual({ label: "Override", icon: "star" });
  });

  it("yields an empty root when the data key is missing or non-object (visible miss)", () => {
    const missing = component({ src: "button.xml", data: "absent" });
    expect(resolveChildRoot(missing, flatRootScope({ other: 1 }))).toEqual({});
    const scalar = component({ src: "button.xml", data: "n" });
    expect(resolveChildRoot(scalar, flatRootScope({ n: 5 }))).toEqual({});
  });

  it("reduces to the flat overrides when there is no data attr", () => {
    const node = component({ src: "button.xml", label: "Hi", qty: "3" });
    expect(resolveChildRoot(node, flatRootScope({}))).toEqual({ label: "Hi", qty: "3" });
  });

  it("does not mutate the parent model object (shallow copy)", () => {
    const buttonProps = { label: "Base" };
    const node = component({ src: "button.xml", data: "buttonProps", label: "New" });
    resolveChildRoot(node, flatRootScope({ buttonProps }));
    expect(buttonProps).toEqual({ label: "Base" });
  });
});

describe("mountDecision — cycle guard + blank src", () => {
  it("yields a mount decision for a resolvable src with empty ancestry", () => {
    const decision = mountDecision(component({ src: "a.xml" }));
    expect(decision).toEqual({
      kind: "mount",
      basename: "a.xml",
      childAncestry: new Set(["a.xml"]),
    });
  });

  it("carries the parent ancestry forward, adding this basename", () => {
    const decision = mountDecision(component({ src: "b.xml" }), new Set(["a.xml"]));
    expect(decision.kind).toBe("mount");
    if (decision.kind === "mount") {
      expect(decision.basename).toBe("b.xml");
      expect([...decision.childAncestry].sort()).toEqual(["a.xml", "b.xml"]);
    }
  });

  it("returns a 'missing' placeholder for a blank/absent src", () => {
    expect(mountDecision(component({}))).toEqual({ kind: "placeholder", reason: "missing" });
    expect(mountDecision(component({ src: "   " }))).toEqual({
      kind: "placeholder",
      reason: "missing",
    });
  });

  it("returns a 'recursive' placeholder when src is already on the mount path (A→A)", () => {
    const decision = mountDecision(component({ src: "a.xml" }), new Set(["a.xml"]));
    expect(decision).toEqual({ kind: "placeholder", reason: "recursive" });
  });

  it("catches A→B→A via the ancestor set (not a depth cap)", () => {
    // Simulate descending A (ancestry {}), then B (ancestry {a}), then A again.
    const a = mountDecision(component({ src: "a.xml" }), new Set());
    expect(a.kind).toBe("mount");
    if (a.kind !== "mount") return;
    const b = mountDecision(component({ src: "b.xml" }), a.childAncestry);
    expect(b.kind).toBe("mount");
    if (b.kind !== "mount") return;
    // Now B mounts A again — already in {a, b} → recursive stub.
    const aAgain = mountDecision(component({ src: "a.xml" }), b.childAncestry);
    expect(aAgain).toEqual({ kind: "placeholder", reason: "recursive" });
  });

  it("does NOT false-trip on a legitimately deep acyclic chain (A→B→C→D)", () => {
    let ancestry: ReadonlySet<string> = new Set();
    for (const src of ["a.xml", "b.xml", "c.xml", "d.xml"]) {
      const d = mountDecision(component({ src }), ancestry);
      expect(d.kind).toBe("mount");
      if (d.kind !== "mount") return;
      ancestry = d.childAncestry;
    }
    // A sibling re-use of a NON-ancestor basename is fine (diamond, not cycle):
    // mounting `b.xml` again from a path that does not contain it still mounts.
    const fresh = mountDecision(component({ src: "b.xml" }), new Set(["a.xml"]));
    expect(fresh.kind).toBe("mount");
  });

  it("normalizes the src basename before the ancestry check", () => {
    // A path-y src collides with a bare-basename ancestor entry.
    const decision = mountDecision(component({ src: "widgets/a.xml" }), new Set(["a.xml"]));
    expect(decision).toEqual({ kind: "placeholder", reason: "recursive" });
  });
});
