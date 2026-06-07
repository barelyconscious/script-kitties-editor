import type * as Monaco from "monaco-editor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetLuaRegistrationForTests,
  LUA_BUILTINS,
  LUA_KEYWORDS,
  LUA_LANGUAGE_ID,
  luaMonarchTokens,
  registerLua,
} from "./lua";

/**
 * A minimal stand-in for the slice of the Monaco namespace `registerLua`
 * touches. Lets us exercise the once-guard without loading Monaco's
 * DOM-coupled runtime in a node test process.
 */
function makeMonacoMock(knownLanguageIds: string[] = []) {
  const register = vi.fn();
  const setLanguageConfiguration = vi.fn();
  const setMonarchTokensProvider = vi.fn();
  const getLanguages = vi.fn(() => knownLanguageIds.map((id) => ({ id })));

  const mock = {
    languages: {
      register,
      setLanguageConfiguration,
      setMonarchTokensProvider,
      getLanguages,
    },
  } as unknown as typeof Monaco;

  return { mock, register, setLanguageConfiguration, setMonarchTokensProvider };
}

describe("registerLua", () => {
  beforeEach(() => {
    __resetLuaRegistrationForTests();
  });

  it("registers the lua language with its config and tokenizer", () => {
    const { mock, register, setLanguageConfiguration, setMonarchTokensProvider } = makeMonacoMock();

    registerLua(mock);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: LUA_LANGUAGE_ID }));
    expect(setLanguageConfiguration).toHaveBeenCalledWith(LUA_LANGUAGE_ID, expect.anything());
    expect(setMonarchTokensProvider).toHaveBeenCalledWith(LUA_LANGUAGE_ID, expect.anything());
  });

  it("is idempotent — repeated calls register the language only once", () => {
    const { mock, register, setMonarchTokensProvider } = makeMonacoMock();

    registerLua(mock);
    registerLua(mock);
    registerLua(mock);

    expect(register).toHaveBeenCalledTimes(1);
    expect(setMonarchTokensProvider).toHaveBeenCalledTimes(1);
  });

  it("does not re-register a language Monaco already knows, but still applies config", () => {
    const { mock, register, setLanguageConfiguration } = makeMonacoMock([LUA_LANGUAGE_ID]);

    registerLua(mock);

    // Monaco ships a built-in 'lua' id; we must not register it twice...
    expect(register).not.toHaveBeenCalled();
    // ...but our config + tokenizer must still be applied over it.
    expect(setLanguageConfiguration).toHaveBeenCalledWith(LUA_LANGUAGE_ID, expect.anything());
  });
});

describe("lua monarch grammar", () => {
  it("covers core Lua keywords and stdlib builtins", () => {
    // Spot-check the data the tokenizer keys off, so an accidental deletion
    // of a keyword/builtin is caught.
    for (const kw of ["function", "local", "end", "return", "then"]) {
      expect(LUA_KEYWORDS).toContain(kw);
    }
    for (const fn of ["print", "pairs", "ipairs", "type", "tostring"]) {
      expect(LUA_BUILTINS).toContain(fn);
    }
  });

  it("exposes keyword, builtin, and library buckets to the tokenizer", () => {
    expect(luaMonarchTokens.keywords).toEqual([...LUA_KEYWORDS]);
    expect(luaMonarchTokens.builtins).toEqual([...LUA_BUILTINS]);
    expect(Array.isArray(luaMonarchTokens.libraries)).toBe(true);
  });
});
