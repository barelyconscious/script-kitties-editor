import { describe, expect, it } from "vitest";
import { createTooltipRegistry } from "./guiTooltipRegistry";

// A DOMRect-ish stub — only the fields the snapshot/consumers read.
function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function fixed(rect: DOMRect | null) {
  return () => rect;
}

describe("createTooltipRegistry", () => {
  it("snapshots registered providers in registration order", () => {
    const reg = createTooltipRegistry();
    reg.register("a", { getRect: fixed(domRect(0, 0, 10, 10)), src: "a.xml", data: 1 });
    reg.register("b", { getRect: fixed(domRect(20, 0, 10, 10)), src: "b.xml", data: 2 });
    expect(reg.snapshot().map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("carries src + data + the measured rect through the snapshot", () => {
    const reg = createTooltipRegistry();
    reg.register("a", { getRect: fixed(domRect(5, 6, 10, 20)), src: "card.xml", data: { n: 1 } });
    const [snap] = reg.snapshot();
    expect(snap.src).toBe("card.xml");
    expect(snap.data).toEqual({ n: 1 });
    expect(snap.rect.left).toBe(5);
    expect(snap.rect.top).toBe(6);
  });

  it("drops providers whose ref has unmounted (getRect → null)", () => {
    const reg = createTooltipRegistry();
    reg.register("a", { getRect: fixed(domRect(0, 0, 10, 10)), src: "a.xml", data: 1 });
    reg.register("gone", { getRect: fixed(null), src: "b.xml", data: 2 });
    expect(reg.snapshot().map((s) => s.key)).toEqual(["a"]);
  });

  it("unregister removes the provider", () => {
    const reg = createTooltipRegistry();
    reg.register("a", { getRect: fixed(domRect(0, 0, 10, 10)), src: "a.xml", data: 1 });
    reg.register("b", { getRect: fixed(domRect(0, 0, 10, 10)), src: "b.xml", data: 2 });
    reg.unregister("a");
    expect(reg.snapshot().map((s) => s.key)).toEqual(["b"]);
  });

  it("re-registering an existing key updates data but KEEPS its insertion order", () => {
    const reg = createTooltipRegistry();
    reg.register("a", { getRect: fixed(domRect(0, 0, 10, 10)), src: "a.xml", data: 1 });
    reg.register("b", { getRect: fixed(domRect(0, 0, 10, 10)), src: "b.xml", data: 2 });
    // Model change → provider "a" re-registers with fresh data.
    reg.register("a", { getRect: fixed(domRect(0, 0, 10, 10)), src: "a.xml", data: 99 });
    const snap = reg.snapshot();
    expect(snap.map((s) => s.key)).toEqual(["a", "b"]); // order preserved, not moved to end
    expect(snap[0].data).toBe(99); // data updated
  });

  it("is idempotent under a strict-mode-style register → unregister → register", () => {
    const reg = createTooltipRegistry();
    reg.register("a", { getRect: fixed(domRect(0, 0, 10, 10)), src: "a.xml", data: 1 });
    reg.unregister("a");
    reg.register("a", { getRect: fixed(domRect(0, 0, 10, 10)), src: "a.xml", data: 1 });
    expect(reg.snapshot().map((s) => s.key)).toEqual(["a"]);
  });
});
