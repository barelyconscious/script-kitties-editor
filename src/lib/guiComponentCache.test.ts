import { describe, expect, it, vi } from "vitest";

// The cache module imports `invoke` from the Tauri core at module load; stub it so
// importing the module under the node test env doesn't pull the real IPC bridge.
// These tests exercise the PURE `parseComponentXml` bucketing only (no fetch).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { parseComponentXml } from "./guiComponentCache";

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
