import { beforeEach, describe, expect, it, vi } from "vitest";

// The cache module imports `invoke` from the Tauri core at module load; stub it so
// importing the module under the node test env doesn't pull the real IPC bridge.
// `parseComponentXml` tests are pure (no fetch); the invalidation tests drive the
// module cache through `loadComponentTree`, feeding XML through the mocked `invoke`.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  componentsVersion,
  invalidateComponents,
  loadComponentTree,
  parseComponentXml,
  peekComponent,
} from "./guiComponentCache";

/** Flush the microtask queue so the settle-time `settled` write (a chained `.then`
 *  off the fetch promise) lands before we peek. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("parseComponentXml — failure bucketing", () => {
  it("buckets a null body (not in the manifest) as missing", () => {
    expect(parseComponentXml(null)).toEqual({ status: "missing" });
  });

  it("buckets unparseable XML as missing (render-robustness, no throw)", () => {
    // A non-<View> root is a parse error in F1.
    expect(parseComponentXml("<Panel/>")).toEqual({ status: "missing" });
    // Malformed XML is also a parse error.
    expect(parseComponentXml("<View><Panel></View>")).toEqual({ status: "missing" });
  });

  it("parses a valid <View> child into an ok entry", () => {
    const result = parseComponentXml('<View><Text text="hi"/></View>');
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.root.tag).toBe("View");
      expect(result.root.children).toHaveLength(1);
      expect(result.root.children[0].tag).toBe("Text");
      expect(result.root.children[0].attrs.text).toBe("hi");
    }
  });
});

describe("invalidateComponents — targeted vs. clear-all drop", () => {
  beforeEach(async () => {
    // The module cache is shared across tests; clear it (and reset the fetch mock)
    // so each case starts from a known-empty state.
    invalidateComponents();
    vi.mocked(invoke).mockReset();
  });

  it("caches a settled entry that peekComponent can read synchronously", async () => {
    vi.mocked(invoke).mockResolvedValue('<View><Text text="hi"/></View>');
    expect(peekComponent("bag_slot")).toBeUndefined(); // nothing loaded yet
    await loadComponentTree("bag_slot");
    await flush(); // let the settle-time `settled` write land
    const peeked = peekComponent("bag_slot");
    expect(peeked?.status).toBe("ok");
  });

  it("with a basename: drops ONLY that entry, leaving siblings cached; bumps version", async () => {
    vi.mocked(invoke).mockResolvedValue("<View/>");
    await loadComponentTree("bag_slot");
    await loadComponentTree("shop_row");
    await flush();
    expect(peekComponent("bag_slot")?.status).toBe("ok");
    expect(peekComponent("shop_row")?.status).toBe("ok");

    const before = componentsVersion();
    invalidateComponents("bag_slot");

    // The named entry is gone; the untouched sibling survives (so its mount re-reads
    // it via peekComponent without a loading flash) — the crux of task 523.
    expect(peekComponent("bag_slot")).toBeUndefined();
    expect(peekComponent("shop_row")?.status).toBe("ok");
    expect(componentsVersion()).toBe(before + 1);
  });

  it("is a harmless no-op on a stem that matches no cached entry (e.g. a controller .lua)", async () => {
    vi.mocked(invoke).mockResolvedValue("<View/>");
    await loadComponentTree("bag_slot");
    await flush();

    const before = componentsVersion();
    invalidateComponents("bag_controller.lua"); // controller stem — no matching XML entry

    expect(peekComponent("bag_slot")?.status).toBe("ok"); // untouched
    expect(componentsVersion()).toBe(before + 1); // still bumps (subscribers re-evaluate)
  });

  it("with no argument / null: clears the WHOLE cache; bumps version", async () => {
    vi.mocked(invoke).mockResolvedValue("<View/>");
    await loadComponentTree("bag_slot");
    await loadComponentTree("shop_row");
    await flush();

    const before = componentsVersion();
    invalidateComponents(); // coarse, unattributable signal → clear-all

    expect(peekComponent("bag_slot")).toBeUndefined();
    expect(peekComponent("shop_row")).toBeUndefined();
    expect(componentsVersion()).toBe(before + 1);

    // `null` behaves identically to omitted.
    await loadComponentTree("bag_slot");
    await flush();
    invalidateComponents(null);
    expect(peekComponent("bag_slot")).toBeUndefined();
  });
});
