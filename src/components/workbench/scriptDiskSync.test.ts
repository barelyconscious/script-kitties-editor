import { describe, expect, it } from "vitest";
import { noteScriptSaved, scriptBasename, wasScriptSavedByApp } from "./scriptDiskSync";

describe("scriptBasename", () => {
  it("returns a bare filename unchanged", () => {
    expect(scriptBasename("creature_bitlynx.lua")).toBe("creature_bitlynx.lua");
  });

  it("strips a forward-slash directory prefix", () => {
    expect(scriptBasename("Scripts/creature_bitlynx.lua")).toBe("creature_bitlynx.lua");
  });

  it("strips a backslash directory prefix", () => {
    expect(scriptBasename("Scripts\\creature_bitlynx.lua")).toBe("creature_bitlynx.lua");
  });

  it("trims surrounding whitespace", () => {
    expect(scriptBasename("  bite.lua  ")).toBe("bite.lua");
  });
});

describe("noteScriptSaved / wasScriptSavedByApp — own-save echo filter", () => {
  it("recognizes the exact contents last written for a name", () => {
    noteScriptSaved("echo_a.lua", "-- v1\n");
    expect(wasScriptSavedByApp("echo_a.lua", "-- v1\n")).toBe(true);
  });

  it("does not match different contents (a genuine external edit)", () => {
    noteScriptSaved("echo_b.lua", "-- ours\n");
    expect(wasScriptSavedByApp("echo_b.lua", "-- theirs\n")).toBe(false);
  });

  it("does not match a file the editor never wrote", () => {
    expect(wasScriptSavedByApp("never_written.lua", "-- x\n")).toBe(false);
  });

  it("keys by basename, so a path-qualified name matches a bare-name write", () => {
    noteScriptSaved("echo_c.lua", "-- c\n");
    expect(wasScriptSavedByApp("Scripts/echo_c.lua", "-- c\n")).toBe(true);
  });

  it("keeps only the newest write per file", () => {
    noteScriptSaved("echo_d.lua", "-- old\n");
    noteScriptSaved("echo_d.lua", "-- new\n");
    expect(wasScriptSavedByApp("echo_d.lua", "-- old\n")).toBe(false);
    expect(wasScriptSavedByApp("echo_d.lua", "-- new\n")).toBe(true);
  });
});
