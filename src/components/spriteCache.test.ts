import { beforeEach, describe, expect, it, vi } from "vitest";

// The store imports `invoke` at module load; stub it so importing under the node
// test env doesn't pull the real IPC bridge. The memoization test drives the cache
// through `loadSprite`, feeding data URLs through the mocked `invoke`.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { clearSpriteCache, loadSprite, spriteCacheVersion } from "./spriteCache";

describe("spriteCache — memoization + invalidation store", () => {
  beforeEach(() => {
    // The module cache is shared across tests; clear it (and reset the fetch mock)
    // so each case starts from a known-empty state.
    clearSpriteCache();
    vi.mocked(invoke).mockReset();
  });

  it("fetches a name once and shares the promise across callers", async () => {
    vi.mocked(invoke).mockResolvedValue("data:image/png;base64,AAAA");

    const a = loadSprite("bitlynx");
    const b = loadSprite("bitlynx");

    expect(a).toBe(b); // same cached promise, not a second fetch
    await expect(a).resolves.toBe("data:image/png;base64,AAAA");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("resolves to null when the fetch rejects (missing/failed art)", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no such sprite"));
    await expect(loadSprite("ghost")).resolves.toBeNull();
  });

  it("clearSpriteCache evicts the cache so the next load re-fetches fresh bytes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,OLD");
    await expect(loadSprite("bitlynx")).resolves.toContain("OLD");

    // Simulate an external image edit: the cache is dropped.
    clearSpriteCache();

    vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,NEW");
    await expect(loadSprite("bitlynx")).resolves.toContain("NEW");
    expect(invoke).toHaveBeenCalledTimes(2); // re-fetched, not served from cache
  });

  it("clearSpriteCache bumps the version and notifies subscribers", () => {
    const before = spriteCacheVersion();
    clearSpriteCache();
    expect(spriteCacheVersion()).toBe(before + 1);
  });
});
