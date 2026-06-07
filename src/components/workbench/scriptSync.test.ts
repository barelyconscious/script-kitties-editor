import { describe, expect, it, vi } from "vitest";
import { createScriptSyncRegistry, openScriptCounts, scriptOpenInOtherTab } from "./scriptSync";

describe("createScriptSyncRegistry", () => {
  it("delivers a publish to subscribers of the matching name only", () => {
    const reg = createScriptSyncRegistry();
    const onA = vi.fn();
    const onB = vi.fn();
    reg.subscribe("a.lua", onA);
    reg.subscribe("b.lua", onB);

    reg.publish("a.lua", "new contents", "origin-1");

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onA).toHaveBeenCalledWith("new contents", "origin-1");
    expect(onB).not.toHaveBeenCalled();
  });

  it("delivers to every subscriber of the same name", () => {
    const reg = createScriptSyncRegistry();
    const one = vi.fn();
    const two = vi.fn();
    reg.subscribe("shared.lua", one);
    reg.subscribe("shared.lua", two);

    reg.publish("shared.lua", "x", "origin");

    expect(one).toHaveBeenCalledWith("x", "origin");
    expect(two).toHaveBeenCalledWith("x", "origin");
  });

  it("passes originId through so a subscriber can skip its own save", () => {
    const reg = createScriptSyncRegistry();
    const seen: string[] = [];
    reg.subscribe("a.lua", (_contents, originId) => seen.push(originId));

    reg.publish("a.lua", "c", "pane-7");

    expect(seen).toEqual(["pane-7"]);
  });

  it("stops delivering after unsubscribe", () => {
    const reg = createScriptSyncRegistry();
    const listener = vi.fn();
    const unsubscribe = reg.subscribe("a.lua", listener);

    reg.publish("a.lua", "first", "o");
    unsubscribe();
    reg.publish("a.lua", "second", "o");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("first", "o");
  });

  it("unsubscribing one listener leaves others subscribed", () => {
    const reg = createScriptSyncRegistry();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = reg.subscribe("a.lua", a);
    reg.subscribe("a.lua", b);

    unsubA();
    reg.publish("a.lua", "c", "o");

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("publishing to a name with no subscribers is a safe no-op", () => {
    const reg = createScriptSyncRegistry();
    expect(() => reg.publish("nobody.lua", "c", "o")).not.toThrow();
  });

  it("a listener that unsubscribes during delivery does not break the fan-out", () => {
    const reg = createScriptSyncRegistry();
    const b = vi.fn();
    let unsubB: () => void = () => {};
    // a unsubscribes b mid-delivery; b should still receive THIS publish
    // (delivery iterates a snapshot) and be gone for the next.
    const a = vi.fn(() => unsubB());
    reg.subscribe("a.lua", a);
    unsubB = reg.subscribe("a.lua", b);

    reg.publish("a.lua", "first", "o");
    expect(b).toHaveBeenCalledTimes(1);

    reg.publish("a.lua", "second", "o");
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("openScriptCounts", () => {
  it("counts open tabs per non-empty script name", () => {
    const counts = openScriptCounts([
      { scriptName: "a.lua" },
      { scriptName: "a.lua" },
      { scriptName: "b.lua" },
    ]);
    expect(counts.get("a.lua")).toBe(2);
    expect(counts.get("b.lua")).toBe(1);
  });

  it("excludes empty / whitespace script names", () => {
    const counts = openScriptCounts([
      { scriptName: "" },
      { scriptName: "   " },
      { scriptName: "a.lua" },
    ]);
    expect(counts.has("")).toBe(false);
    expect(counts.has("   ")).toBe(false);
    expect(counts.get("a.lua")).toBe(1);
  });
});

describe("scriptOpenInOtherTab", () => {
  it("is true for both tabs when two open tabs share a script", () => {
    const tabs = [{ scriptName: "shared.lua" }, { scriptName: "shared.lua" }];
    expect(scriptOpenInOtherTab(tabs, "shared.lua")).toBe(true);
  });

  it("is false when a script is open in only one tab", () => {
    const tabs = [{ scriptName: "solo.lua" }, { scriptName: "other.lua" }];
    expect(scriptOpenInOtherTab(tabs, "solo.lua")).toBe(false);
  });

  it("never counts the empty name", () => {
    const tabs = [{ scriptName: "" }, { scriptName: "" }];
    expect(scriptOpenInOtherTab(tabs, "")).toBe(false);
  });
});
