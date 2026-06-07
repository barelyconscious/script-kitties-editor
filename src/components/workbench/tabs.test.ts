import { describe, expect, it } from "vitest";
import type { GameObject } from "./gameObjects";
import { closeTab, openTab, tabFromObject, tabKey, type WorkbenchTab } from "./tabs";

function gameObject(over: Partial<GameObject> & Pick<GameObject, "objectType" | "id">): GameObject {
  return {
    name: over.id,
    sprite: "",
    script: "",
    description: "",
    ...over,
  };
}

function tab(objectType: WorkbenchTab["objectType"], id: string): WorkbenchTab {
  return { objectType, id, name: id, scriptName: "" };
}

describe("tabKey", () => {
  it("combines objectType and id", () => {
    expect(tabKey({ objectType: "Ability", id: "bite" })).toBe("Ability:bite");
  });
});

describe("tabFromObject", () => {
  it("carries the script field into scriptName", () => {
    const t = tabFromObject(gameObject({ objectType: "Item", id: "bandage", script: "heal.lua" }));
    expect(t.scriptName).toBe("heal.lua");
  });

  it("leaves scriptName empty for a data-only object", () => {
    const t = tabFromObject(gameObject({ objectType: "Charm", id: "luck" }));
    expect(t.scriptName).toBe("");
  });
});

describe("openTab", () => {
  it("appends a new tab and makes it active", () => {
    const result = openTab([], gameObject({ objectType: "Ability", id: "bite" }));
    expect(result.tabs.map(tabKey)).toEqual(["Ability:bite"]);
    expect(result.activeKey).toBe("Ability:bite");
  });

  it("focuses an existing tab without duplicating", () => {
    const existing = [tab("Ability", "bite")];
    const result = openTab(existing, gameObject({ objectType: "Ability", id: "bite" }));
    expect(result.tabs).toHaveLength(1);
    expect(result.activeKey).toBe("Ability:bite");
  });

  it("distinguishes same id across different types", () => {
    const existing = [tab("Ability", "x")];
    const result = openTab(existing, gameObject({ objectType: "Item", id: "x" }));
    expect(result.tabs.map(tabKey)).toEqual(["Ability:x", "Item:x"]);
    expect(result.activeKey).toBe("Item:x");
  });
});

describe("closeTab", () => {
  const tabs = [tab("Ability", "a"), tab("Ability", "b"), tab("Ability", "c")];

  it("returns null active key when the last tab is closed", () => {
    const result = closeTab([tab("Ability", "a")], "Ability:a", "Ability:a");
    expect(result.tabs).toEqual([]);
    expect(result.activeKey).toBeNull();
  });

  it("focuses the right neighbor when the active middle tab closes", () => {
    const result = closeTab(tabs, "Ability:b", "Ability:b");
    expect(result.tabs.map(tabKey)).toEqual(["Ability:a", "Ability:c"]);
    expect(result.activeKey).toBe("Ability:c");
  });

  it("focuses the new last tab when the active rightmost closes", () => {
    const result = closeTab(tabs, "Ability:c", "Ability:c");
    expect(result.activeKey).toBe("Ability:b");
  });

  it("preserves the active tab when a non-active tab closes", () => {
    const result = closeTab(tabs, "Ability:a", "Ability:c");
    expect(result.tabs.map(tabKey)).toEqual(["Ability:b", "Ability:c"]);
    expect(result.activeKey).toBe("Ability:c");
  });

  it("is a no-op for an unknown key", () => {
    const result = closeTab(tabs, "Ability:zzz", "Ability:a");
    expect(result.tabs).toHaveLength(3);
    expect(result.activeKey).toBe("Ability:a");
  });
});
