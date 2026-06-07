import { describe, expect, it } from "vitest";
import { LUA_LANGUAGE_ID } from "./lua";
import { resolveMonacoTheme, scriptEditorOptions } from "./options";

describe("resolveMonacoTheme", () => {
  it("maps dark mode to vs-dark", () => {
    expect(resolveMonacoTheme(true)).toBe("vs-dark");
  });

  it("maps light mode to vs", () => {
    expect(resolveMonacoTheme(false)).toBe("vs");
  });
});

describe("scriptEditorOptions", () => {
  it("always targets the Lua language", () => {
    expect(scriptEditorOptions(false).language).toBe(LUA_LANGUAGE_ID);
  });

  it("threads the readOnly flag through", () => {
    expect(scriptEditorOptions(true).readOnly).toBe(true);
    expect(scriptEditorOptions(false).readOnly).toBe(false);
  });

  it("enables automatic layout so the editor fills its container", () => {
    expect(scriptEditorOptions(false).automaticLayout).toBe(true);
  });
});
