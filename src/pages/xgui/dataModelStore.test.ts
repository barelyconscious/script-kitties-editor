/**
 * Tests the EDITOR-LOCAL Data Model persistence (task 484): per-component model
 * text stored under one localStorage key, read back by path, defensive against
 * corrupt/unavailable storage.
 *
 * The test environment is `node` (no DOM/localStorage), which is exactly the
 * defensive path: with no injected store and no global, reads return "nothing
 * stored" and writes no-op. The injected-storage cases exercise the real round-trip
 * with a tiny in-memory stand-in, so the pure map<->text logic is pinned without a
 * browser.
 */

import { describe, expect, it } from "vitest";
import {
  DATA_MODELS_KEY,
  getPersistedModel,
  type ModelStorage,
  setPersistedModel,
} from "./dataModelStore";

/** A minimal in-memory `Storage` stand-in satisfying `ModelStorage`. */
function memStorage(seed: Record<string, string> = {}): ModelStorage & { raw(): string | null } {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    raw: () => (map.has(DATA_MODELS_KEY) ? (map.get(DATA_MODELS_KEY) as string) : null),
  };
}

describe("getPersistedModel / setPersistedModel — round-trip per path", () => {
  it("returns undefined when nothing is stored for a path", () => {
    const store = memStorage();
    expect(getPersistedModel("gui/hud.xml", store)).toBeUndefined();
  });

  it("persists and reads back a model under its component path", () => {
    const store = memStorage();
    setPersistedModel("gui/hud.xml", '{"health":15}', store);
    expect(getPersistedModel("gui/hud.xml", store)).toBe('{"health":15}');
  });

  it("keeps models for different paths isolated", () => {
    const store = memStorage();
    setPersistedModel("gui/a.xml", '{"a":1}', store);
    setPersistedModel("gui/b.xml", '{"b":2}', store);
    expect(getPersistedModel("gui/a.xml", store)).toBe('{"a":1}');
    expect(getPersistedModel("gui/b.xml", store)).toBe('{"b":2}');
  });

  it("overwrites only the targeted path, preserving the others", () => {
    const store = memStorage();
    setPersistedModel("gui/a.xml", '{"a":1}', store);
    setPersistedModel("gui/b.xml", '{"b":2}', store);
    setPersistedModel("gui/a.xml", '{"a":99}', store);
    expect(getPersistedModel("gui/a.xml", store)).toBe('{"a":99}');
    expect(getPersistedModel("gui/b.xml", store)).toBe('{"b":2}');
  });

  it("stores all paths under a single key", () => {
    const store = memStorage();
    setPersistedModel("gui/a.xml", '{"a":1}', store);
    setPersistedModel("gui/b.xml", '{"b":2}', store);
    expect(JSON.parse(store.raw() as string)).toEqual({
      "gui/a.xml": '{"a":1}',
      "gui/b.xml": '{"b":2}',
    });
  });
});

describe("defensive reads — corrupt / unreadable storage falls back to undefined", () => {
  it("returns undefined when the stored value is not valid JSON", () => {
    const store = memStorage({ [DATA_MODELS_KEY]: "{ not json" });
    expect(getPersistedModel("gui/a.xml", store)).toBeUndefined();
  });

  it("returns undefined when the stored map is an array, not an object", () => {
    const store = memStorage({ [DATA_MODELS_KEY]: "[1,2,3]" });
    expect(getPersistedModel("gui/a.xml", store)).toBeUndefined();
  });

  it("returns undefined when the stored map is null", () => {
    const store = memStorage({ [DATA_MODELS_KEY]: "null" });
    expect(getPersistedModel("gui/a.xml", store)).toBeUndefined();
  });

  it("drops non-string entries but keeps valid sibling entries", () => {
    const store = memStorage({
      [DATA_MODELS_KEY]: JSON.stringify({ "gui/a.xml": 42, "gui/b.xml": '{"b":2}' }),
    });
    expect(getPersistedModel("gui/a.xml", store)).toBeUndefined();
    expect(getPersistedModel("gui/b.xml", store)).toBe('{"b":2}');
  });

  it("recovers by overwriting a corrupt map on the next write", () => {
    const store = memStorage({ [DATA_MODELS_KEY]: "garbage" });
    setPersistedModel("gui/a.xml", '{"a":1}', store);
    expect(getPersistedModel("gui/a.xml", store)).toBe('{"a":1}');
  });
});

describe("defensive against throwing/absent storage", () => {
  it("read returns undefined and write no-ops when there is no storage", () => {
    // No injected store; node test env has no global localStorage.
    expect(getPersistedModel("gui/a.xml")).toBeUndefined();
    expect(() => setPersistedModel("gui/a.xml", "{}")).not.toThrow();
  });

  it("read returns undefined when getItem throws (e.g. disabled storage)", () => {
    const throwing: ModelStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {},
    };
    expect(getPersistedModel("gui/a.xml", throwing)).toBeUndefined();
  });

  it("write swallows a setItem failure (e.g. quota exceeded)", () => {
    const throwing: ModelStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => setPersistedModel("gui/a.xml", "{}", throwing)).not.toThrow();
  });
});
