import type * as Monaco from "monaco-editor";

/**
 * Lua language support for Monaco — registration of the language, its bracket /
 * comment / auto-closing configuration, and a Monarch tokenizer for syntax
 * highlighting. This is v1 scope: **highlighting only**. There is deliberately
 * no completion provider and no validation here (both are deferred — the future
 * inline intellisense is a projection of the single `ApiItem` source, not this
 * module's job).
 *
 * `registerLua` is dependency-injected with the Monaco namespace rather than
 * importing it, so the idempotency logic is unit-testable without pulling
 * Monaco's DOM-coupled runtime into a test process.
 */

export const LUA_LANGUAGE_ID = "lua";

/** Reserved words — highlighted as keywords. */
export const LUA_KEYWORDS = [
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
] as const;

/** Global stdlib functions — highlighted as predefined. */
export const LUA_BUILTINS = [
  "assert",
  "collectgarbage",
  "dofile",
  "error",
  "getfenv",
  "getmetatable",
  "ipairs",
  "load",
  "loadfile",
  "loadstring",
  "next",
  "pairs",
  "pcall",
  "print",
  "rawequal",
  "rawget",
  "rawlen",
  "rawset",
  "require",
  "select",
  "setfenv",
  "setmetatable",
  "tonumber",
  "tostring",
  "type",
  "unpack",
  "xpcall",
] as const;

/** Standard library tables — highlighted distinctly from plain identifiers. */
export const LUA_LIBRARIES = [
  "coroutine",
  "debug",
  "io",
  "math",
  "os",
  "package",
  "string",
  "table",
  "utf8",
] as const;

export const luaLanguageConfiguration: Monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: "--",
    blockComment: ["--[[", "]]"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "'", close: "'", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  indentationRules: {
    increaseIndentPattern:
      /^\s*(else|elseif|for|function|if|repeat|while|do|then)\b.*$|^\s*\{[^}]*$|.*\bfunction\b.*[({]\s*$/,
    decreaseIndentPattern: /^\s*(end|else|elseif|until|\}|\)).*$/,
  },
};

export const luaMonarchTokens: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".lua",
  keywords: [...LUA_KEYWORDS],
  builtins: [...LUA_BUILTINS],
  libraries: [...LUA_LIBRARIES],
  brackets: [
    { open: "{", close: "}", token: "delimiter.curly" },
    { open: "[", close: "]", token: "delimiter.square" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],
  tokenizer: {
    root: [
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@keywords": "keyword",
            "@builtins": "predefined",
            "@libraries": "type.identifier",
            "@default": "identifier",
          },
        },
      ],
      // Long-bracket block comments: --[[ ... ]]
      [/--\[\[/, "comment", "@blockComment"],
      [/--.*$/, "comment"],
      // Long-bracket strings: [[ ... ]]
      [/\[\[/, "string", "@longString"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@stringDouble"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/'/, "string", "@stringSingle"],
      [/\d*\.\d+([eE][+-]?\d+)?/, "number.float"],
      [/0[xX][0-9a-fA-F]+/, "number.hex"],
      [/\d+/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/[<>]=?|[!~=]=?|\.\.\.?|[+\-*/%^#]/, "operator"],
      [/[;,.]/, "delimiter"],
    ],
    blockComment: [
      [/[^\]]+/, "comment"],
      [/\]\]/, "comment", "@pop"],
      [/\]/, "comment"],
    ],
    longString: [
      [/[^\]]+/, "string"],
      [/\]\]/, "string", "@pop"],
      [/\]/, "string"],
    ],
    stringDouble: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
    stringSingle: [
      [/[^\\']+/, "string"],
      [/\\./, "string.escape"],
      [/'/, "string", "@pop"],
    ],
  },
};

let registered = false;

/**
 * Register the Lua language with the given Monaco namespace exactly once per
 * process. Safe to call repeatedly — subsequent calls are no-ops. Intended to
 * run at app init (from `setupMonaco`), never per editor mount.
 */
export function registerLua(m: typeof Monaco): void {
  if (registered) return;

  const alreadyKnown = m.languages.getLanguages().some((lang) => lang.id === LUA_LANGUAGE_ID);
  if (!alreadyKnown) {
    m.languages.register({
      id: LUA_LANGUAGE_ID,
      extensions: [".lua"],
      aliases: ["Lua", "lua"],
    });
  }

  m.languages.setLanguageConfiguration(LUA_LANGUAGE_ID, luaLanguageConfiguration);
  m.languages.setMonarchTokensProvider(LUA_LANGUAGE_ID, luaMonarchTokens);

  registered = true;
}

/** Test-only: reset the once-guard so idempotency can be re-exercised. */
export function __resetLuaRegistrationForTests(): void {
  registered = false;
}
