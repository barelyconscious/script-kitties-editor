/**
 * The single source of truth for the game's Lua scripting API.
 *
 * This is **editor knowledge** — a static, hand-authored description of the
 * surface a modder can call from a creature/ability/item/effect/biogram script.
 * It is NOT per-install game data and is never fetched from Rust; it ships in
 * the frontend bundle.
 *
 * "One source, two surfaces": the Workbench reference pane renders this tree
 * directly, and a future Monaco completion provider will be a *projection* of
 * the same tree (that is what the `insertText` / `detail` fields below feed).
 * Keeping both surfaces backed by one tree is the whole point — the predecessor
 * carried two independently hand-authored lists (`apiViewer/gameApi.ts` and
 * `services/CompletionProvider.ts`) that never shared a line and drifted out of
 * sync. This module is their reconciled merge.
 *
 * Authoring rules, so the merge does not re-fork:
 *  - Every item has a `name` and a `type`.
 *  - Top-level names are unique. Nested member names may repeat only where the
 *    game genuinely overloads them (e.g. `Creature.removeEffect`).
 *  - `documentation` is prose for the reference pane. `insertText` (a Monaco
 *    snippet) and `detail` (a short type hint) are completion-provider hints,
 *    carried over from the predecessor's CompletionProvider where it had them.
 */

/** A node in the API tree: a namespace, type, function, enum, member, … */
export type ApiItem = {
  /** The identifier as written in Lua (bare member name, not dotted path). */
  name: string;
  /**
   * What kind of thing this is. Drives the reference pane's grouping/icons and
   * the completion provider's `CompletionItemKind` mapping.
   */
  type: ApiItemType;
  /** Free-form classification tags (e.g. "items", "battle", "utility"). */
  tags?: string[];
  /** Human-readable prose shown in the reference pane and as completion docs. */
  documentation: string;
  /** Nested members — enum values, type fields/methods, library functions. */
  members?: ApiItem[];

  /** Parameters, for functions/methods/constructors. */
  args?: ApiArg[];
  /** Return type, for functions/methods that return a value. */
  returns?: { type: string };

  /** Worked examples shown in the reference pane. */
  examples?: ApiExample[];

  // --- Completion-provider projection hints (from the predecessor's
  // CompletionProvider). Optional: items authored only for the reference pane
  // may omit them and the provider falls back to inserting `name`. ---

  /** Monaco snippet string (may contain `${1:...}` tab stops). */
  insertText?: string;
  /** Short type hint shown to the right of a completion (e.g. "BattleCreature"). */
  detail?: string;
};

/**
 * The closed set of node kinds. Derived from what both predecessor sources
 * actually used: gameApi.ts's `enum`/`object`/`function`/`method`/`library`
 * plus the primitive/field types it stored in `type`, and CompletionProvider's
 * keyword/property/constant flavours.
 */
export type ApiItemType =
  // structural
  | "namespace" // a grouping with members but no value of its own (keywords, libraries)
  | "library" // a stdlib/game table you call functions on (string, math, Battle)
  | "object" // a game type with fields and methods
  | "enum" // a set of named constants
  | "function" // a global or constructor function
  | "method" // a function called on a receiver (obj:fn / obj.fn)
  | "property" // a readable/writable field on an object
  | "constant" // a named constant value (enum member, ArenaEffects entry)
  | "callback" // an overridable hook the modder implements
  | "keyword" // a Lua reserved word
  // primitive value types (used on members carried over from gameApi.ts)
  | "string"
  | "int"
  | "double"
  | "bool";

/** A function/method parameter. */
export type ApiArg = { name: string; type: string };

/** A worked example for the reference pane. */
export type ApiExample = { title: string; code: string };

// ---------------------------------------------------------------------------
// Lua language surface
//
// Source: CompletionProvider.ts (provideLuaKeywords / provideLuaStandardLibrary).
// gameApi.ts had none of this. Keywords become one `namespace` whose members
// are the reserved words; the stdlib becomes global functions plus `library`
// nodes for string/table/math (matching how the predecessor namespaced them in
// the completion labels, e.g. "string.find").
// ---------------------------------------------------------------------------

const luaKeywords = (): ApiItem => ({
  name: "keywords",
  type: "namespace",
  tags: ["lua"],
  documentation: "Lua reserved words.",
  members: [
    { name: "and", type: "keyword", documentation: "Logical AND operator." },
    { name: "break", type: "keyword", documentation: "Exit from a loop." },
    { name: "do", type: "keyword", documentation: "Start a block of statements." },
    { name: "else", type: "keyword", documentation: "Alternative branch in an if statement." },
    { name: "elseif", type: "keyword", documentation: "Additional condition in an if statement." },
    { name: "end", type: "keyword", documentation: "End a block of statements." },
    { name: "false", type: "keyword", documentation: "Boolean false value." },
    { name: "for", type: "keyword", documentation: "Start a for loop." },
    { name: "function", type: "keyword", documentation: "Define a function." },
    { name: "goto", type: "keyword", documentation: "Jump to a label." },
    { name: "if", type: "keyword", documentation: "Conditional statement." },
    { name: "in", type: "keyword", documentation: "Iterator clause in a for loop." },
    { name: "local", type: "keyword", documentation: "Declare a local variable." },
    { name: "nil", type: "keyword", documentation: "Null value." },
    { name: "not", type: "keyword", documentation: "Logical NOT operator." },
    { name: "or", type: "keyword", documentation: "Logical OR operator." },
    { name: "repeat", type: "keyword", documentation: "Start a repeat-until loop." },
    { name: "return", type: "keyword", documentation: "Return from a function." },
    { name: "then", type: "keyword", documentation: "Then clause in an if statement." },
    { name: "true", type: "keyword", documentation: "Boolean true value." },
    { name: "until", type: "keyword", documentation: "End condition for a repeat loop." },
    { name: "while", type: "keyword", documentation: "Start a while loop." },
  ],
});

const luaStdlib = (): ApiItem[] => [
  // Global functions
  {
    name: "assert",
    type: "function",
    tags: ["lua"],
    documentation: "Raises an error if the condition is false.",
    insertText: "assert(${1:condition}, ${2:message})",
    args: [
      { name: "condition", type: "any" },
      { name: "message", type: "string" },
    ],
  },
  {
    name: "error",
    type: "function",
    tags: ["lua"],
    documentation: "Raises an error with the given message.",
    insertText: "error(${1:message})",
    args: [{ name: "message", type: "string" }],
  },
  {
    name: "ipairs",
    type: "function",
    tags: ["lua"],
    documentation: "Returns an iterator for the array part of a table.",
    insertText: "ipairs(${1:table})",
    args: [{ name: "table", type: "table" }],
  },
  {
    name: "pairs",
    type: "function",
    tags: ["lua"],
    documentation: "Returns an iterator for all key-value pairs in a table.",
    insertText: "pairs(${1:table})",
    args: [{ name: "table", type: "table" }],
  },
  {
    name: "pcall",
    type: "function",
    tags: ["lua"],
    documentation: "Protected call — invokes a function and catches errors.",
    insertText: "pcall(${1:function}, ${2:...})",
    args: [{ name: "function", type: "function" }],
  },
  {
    name: "print",
    type: "function",
    tags: ["lua"],
    documentation: "Prints values to output.",
    insertText: "print(${1:...})",
  },
  {
    name: "tonumber",
    type: "function",
    tags: ["lua"],
    documentation: "Converts a value to a number.",
    insertText: "tonumber(${1:value})",
    args: [{ name: "value", type: "any" }],
    returns: { type: "number" },
  },
  {
    name: "tostring",
    type: "function",
    tags: ["lua"],
    documentation: "Converts a value to a string.",
    insertText: "tostring(${1:value})",
    args: [{ name: "value", type: "any" }],
    returns: { type: "string" },
  },
  {
    name: "type",
    type: "function",
    tags: ["lua"],
    documentation: "Returns the type of a value as a string.",
    insertText: "type(${1:value})",
    args: [{ name: "value", type: "any" }],
    returns: { type: "string" },
  },
  // String library
  {
    name: "string",
    type: "library",
    tags: ["lua"],
    documentation: "Lua string manipulation library.",
    members: [
      {
        name: "find",
        type: "function",
        documentation: "Find a pattern in a string.",
        insertText: "string.find(${1:str}, ${2:pattern})",
        args: [
          { name: "str", type: "string" },
          { name: "pattern", type: "string" },
        ],
      },
      {
        name: "sub",
        type: "function",
        documentation: "Extract a substring.",
        insertText: "string.sub(${1:str}, ${2:start}, ${3:end})",
        args: [
          { name: "str", type: "string" },
          { name: "start", type: "int" },
          { name: "end", type: "int" },
        ],
        returns: { type: "string" },
      },
      {
        name: "len",
        type: "function",
        documentation: "Get the length of a string.",
        insertText: "string.len(${1:str})",
        args: [{ name: "str", type: "string" }],
        returns: { type: "int" },
      },
      {
        name: "lower",
        type: "function",
        documentation: "Convert a string to lowercase.",
        insertText: "string.lower(${1:str})",
        args: [{ name: "str", type: "string" }],
        returns: { type: "string" },
      },
      {
        name: "upper",
        type: "function",
        documentation: "Convert a string to uppercase.",
        insertText: "string.upper(${1:str})",
        args: [{ name: "str", type: "string" }],
        returns: { type: "string" },
      },
      {
        name: "gsub",
        type: "function",
        documentation: "Global substitution within a string.",
        insertText: "string.gsub(${1:str}, ${2:pattern}, ${3:replacement})",
        args: [
          { name: "str", type: "string" },
          { name: "pattern", type: "string" },
          { name: "replacement", type: "string" },
        ],
        returns: { type: "string" },
      },
    ],
  },
  // Table library
  {
    name: "table",
    type: "library",
    tags: ["lua"],
    documentation: "Lua table manipulation library.",
    members: [
      {
        name: "insert",
        type: "function",
        documentation: "Insert a value into a table.",
        insertText: "table.insert(${1:table}, ${2:value})",
        args: [
          { name: "table", type: "table" },
          { name: "value", type: "any" },
        ],
      },
      {
        name: "remove",
        type: "function",
        documentation: "Remove a value from a table.",
        insertText: "table.remove(${1:table}, ${2:index})",
        args: [
          { name: "table", type: "table" },
          { name: "index", type: "int" },
        ],
      },
      {
        name: "sort",
        type: "function",
        documentation: "Sort a table in place.",
        insertText: "table.sort(${1:table})",
        args: [{ name: "table", type: "table" }],
      },
      {
        name: "concat",
        type: "function",
        documentation: "Concatenate the elements of a table into a string.",
        insertText: "table.concat(${1:table}, ${2:separator})",
        args: [
          { name: "table", type: "table" },
          { name: "separator", type: "string" },
        ],
        returns: { type: "string" },
      },
    ],
  },
  // Math library
  {
    name: "math",
    type: "library",
    tags: ["lua"],
    documentation: "Lua mathematics library.",
    members: [
      {
        name: "abs",
        type: "function",
        documentation: "Absolute value.",
        insertText: "math.abs(${1:number})",
        args: [{ name: "number", type: "double" }],
        returns: { type: "double" },
      },
      {
        name: "ceil",
        type: "function",
        documentation: "Round up to the nearest integer.",
        insertText: "math.ceil(${1:number})",
        args: [{ name: "number", type: "double" }],
        returns: { type: "int" },
      },
      {
        name: "floor",
        type: "function",
        documentation: "Round down to the nearest integer.",
        insertText: "math.floor(${1:number})",
        args: [{ name: "number", type: "double" }],
        returns: { type: "int" },
      },
      {
        name: "max",
        type: "function",
        documentation: "Maximum of the arguments.",
        insertText: "math.max(${1:...})",
        returns: { type: "double" },
      },
      {
        name: "min",
        type: "function",
        documentation: "Minimum of the arguments.",
        insertText: "math.min(${1:...})",
        returns: { type: "double" },
      },
      {
        name: "random",
        type: "function",
        documentation: "Random number.",
        insertText: "math.random(${1:max})",
        args: [{ name: "max", type: "int" }],
        returns: { type: "double" },
      },
      {
        name: "sqrt",
        type: "function",
        documentation: "Square root.",
        insertText: "math.sqrt(${1:number})",
        args: [{ name: "number", type: "double" }],
        returns: { type: "double" },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Basic types & enums
//
// Source: gameApi.ts getBasicTypes(). The CombatAction and DamageType enum
// VALUES are reconciled here with CompletionProvider's CombatAction.* /
// DamageType.* entries — gameApi.ts had bare "Enum value" docs, while the
// CompletionProvider carried a real one-line doc + insertText + detail per
// value. We keep gameApi.ts's structure and fold in the richer prose.
// ---------------------------------------------------------------------------

const basicTypes = (): ApiItem[] => [
  {
    name: "Biome",
    type: "enum",
    documentation: "The biome of an area.",
    members: [
      { name: "FOREST", type: "constant", documentation: "A FOREST biome." },
      { name: "PLAINS", type: "constant", documentation: "A PLAINS biome." },
      { name: "DESERT", type: "constant", documentation: "A DESERT biome." },
      { name: "TUNDRA", type: "constant", documentation: "A TUNDRA biome." },
      { name: "SWAMP", type: "constant", documentation: "A SWAMP biome." },
      { name: "MOUNTAINS", type: "constant", documentation: "A MOUNTAINS biome." },
      { name: "CAVE", type: "constant", documentation: "A CAVE biome." },
      { name: "CITY", type: "constant", documentation: "A CITY biome." },
      { name: "WATER", type: "constant", documentation: "A WATER biome." },
    ],
  },
  {
    name: "ItemRarity",
    type: "enum",
    documentation: "Represents the rarity of an item.",
    members: [
      { name: "POOR", type: "constant", documentation: "A POOR rarity." },
      { name: "COMMON", type: "constant", documentation: "A COMMON rarity." },
      { name: "UNCOMMON", type: "constant", documentation: "An UNCOMMON rarity." },
      { name: "RARE", type: "constant", documentation: "A RARE rarity." },
      { name: "EPIC", type: "constant", documentation: "An EPIC rarity." },
      { name: "UNIQUE", type: "constant", documentation: "A UNIQUE rarity." },
    ],
  },
  {
    name: "Point",
    type: "object",
    documentation: "A 2D coordinate.",
    members: [
      { name: "x", type: "int", documentation: "X coordinate." },
      { name: "y", type: "int", documentation: "Y coordinate." },
      {
        name: "toScreenPosition",
        type: "method",
        documentation: "Converts a world coordinate in combat to a screen coordinate.",
      },
    ],
  },
  {
    name: "Shape",
    type: "object",
    documentation: "A geometric shape. Supports sphere and square.",
    members: [
      {
        name: "contains",
        type: "method",
        documentation: "Whether the shape contains a point.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Sphere",
    type: "object",
    documentation: "A sphere shape.",
    members: [
      { name: "radius", type: "int", documentation: "The radius." },
      {
        name: "center",
        type: "property",
        documentation: "The center of the sphere.",
        detail: "Point",
      },
      {
        name: "new",
        type: "function",
        documentation: "Constructor.",
        args: [
          { name: "radius", type: "int" },
          { name: "center", type: "Point" },
        ],
        returns: { type: "Sphere" },
      },
      {
        name: "contains",
        type: "method",
        documentation: "Whether the shape contains a point.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "CombatAction",
    type: "enum",
    tags: ["battle"],
    documentation:
      "Describes an action taken as part of combat. Used both as an enum of action kinds and as the shape of an action object.",
    members: [
      {
        name: "DAMAGE",
        type: "constant",
        documentation: "Applies damage to a creature.",
        insertText: "CombatAction.DAMAGE",
        detail: "CombatAction",
      },
      {
        name: "HEALING",
        type: "constant",
        documentation: "Applies healing to a creature.",
        insertText: "CombatAction.HEALING",
        detail: "CombatAction",
      },
      {
        name: "APPLY_EFFECT",
        type: "constant",
        documentation: "Applies an effect to a creature.",
        insertText: "CombatAction.APPLY_EFFECT",
        detail: "CombatAction",
      },
      {
        name: "REMOVE_EFFECT",
        type: "constant",
        documentation: "Removes an effect from a creature.",
        insertText: "CombatAction.REMOVE_EFFECT",
        detail: "CombatAction",
      },
      {
        name: "MOVE",
        type: "constant",
        documentation: "Relocates a creature to a new location.",
        insertText: "CombatAction.MOVE",
        detail: "CombatAction",
      },
      {
        name: "SPRITE_ANIMATION",
        type: "constant",
        documentation: "Inserts a sprite animation.",
        insertText: "CombatAction.SPRITE_ANIMATION",
        detail: "CombatAction",
      },
      {
        name: "SET_ARENA_EFFECT",
        type: "constant",
        documentation: "Inserts an arena effect over the specified area.",
        insertText: "CombatAction.SET_ARENA_EFFECT",
        detail: "CombatAction",
      },
      {
        name: "CREATE_ENTITY",
        type: "constant",
        documentation: "Inserts a combat entity.",
        insertText: "CombatAction.CREATE_ENTITY",
        detail: "CombatAction",
      },
      {
        name: "action",
        type: "property",
        documentation: "The CombatAction enum value describing this action.",
        detail: "CombatAction",
      },
      {
        name: "target",
        type: "property",
        documentation: "The target creature of this action.",
        detail: "BattleCreature",
      },
      {
        name: "name",
        type: "property",
        documentation: "The name when creating a battle entity.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description when creating a battle entity.",
        detail: "string",
      },
      {
        name: "position",
        type: "property",
        documentation: "The position when creating a battle entity.",
        detail: "Point",
      },
      {
        name: "script",
        type: "property",
        documentation: "The script when creating a battle entity.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the action.",
        detail: "string",
      },
      {
        name: "amount",
        type: "property",
        documentation: "The amount of the action.",
        detail: "double",
      },
      {
        name: "damageType",
        type: "property",
        documentation: "The damage type of a DAMAGE action.",
        detail: "DamageType",
      },
      {
        name: "shape",
        type: "property",
        documentation: "The shape of the action.",
        detail: "Shape",
      },
      {
        name: "radius",
        type: "property",
        documentation: "The radius of the action.",
        detail: "int",
      },
      {
        name: "arenaEffect",
        type: "property",
        documentation: "The arena effect of a SET_ARENA_EFFECT action.",
        detail: "ArenaEffect",
      },
      {
        name: "creatureEffect",
        type: "property",
        documentation: "The creature effect of an APPLY_EFFECT action.",
        detail: "CreatureEffect",
      },
      {
        name: "mover",
        type: "property",
        documentation: "The creature being relocated by a MOVE action.",
        detail: "BattleCreature",
      },
    ],
  },
  {
    name: "DamageType",
    type: "enum",
    tags: ["battle"],
    documentation: "The type of damage dealt by an action.",
    members: [
      {
        name: "PHYSICAL",
        type: "constant",
        documentation: "Physical damage.",
        insertText: "DamageType.PHYSICAL",
        detail: "DamageType",
      },
      {
        name: "FIRE",
        type: "constant",
        documentation: "Fire damage.",
        insertText: "DamageType.FIRE",
        detail: "DamageType",
      },
      {
        name: "WATER",
        type: "constant",
        documentation: "Water damage.",
        insertText: "DamageType.WATER",
        detail: "DamageType",
      },
      {
        name: "ELECTRIC",
        type: "constant",
        documentation: "Electric damage.",
        insertText: "DamageType.ELECTRIC",
        detail: "DamageType",
      },
      {
        name: "POISON",
        type: "constant",
        documentation: "Poison damage.",
        insertText: "DamageType.POISON",
        detail: "DamageType",
      },
      {
        name: "FROST",
        type: "constant",
        documentation: "Frost damage.",
        insertText: "DamageType.FROST",
        detail: "DamageType",
      },
      {
        name: "TECHNICAL",
        type: "constant",
        documentation: "Technical damage.",
        insertText: "DamageType.TECHNICAL",
        detail: "DamageType",
      },
    ],
  },
  {
    name: "ArenaEffects",
    type: "namespace",
    tags: ["battle"],
    documentation:
      "Built-in arena effects you can place on the battlefield. (Only in the predecessor's CompletionProvider — not in its apiViewer tree.)",
    members: [
      {
        name: "frozen",
        type: "constant",
        documentation: "Frozen arena effect.",
        insertText: "ArenaEffects.frozen",
        detail: "ArenaEffects",
      },
      {
        name: "burning",
        type: "constant",
        documentation: "Burning arena effect.",
        insertText: "ArenaEffects.burning",
        detail: "ArenaEffects",
      },
      {
        name: "wet",
        type: "constant",
        documentation: "Wet arena effect.",
        insertText: "ArenaEffects.wet",
        detail: "ArenaEffects",
      },
      {
        name: "electrified",
        type: "constant",
        documentation: "Electrified arena effect.",
        insertText: "ArenaEffects.electrified",
        detail: "ArenaEffects",
      },
      {
        name: "poisoned",
        type: "constant",
        documentation: "Poisoned arena effect.",
        insertText: "ArenaEffects.poisoned",
        detail: "ArenaEffects",
      },
      {
        name: "steam",
        type: "constant",
        documentation: "Steam arena effect.",
        insertText: "ArenaEffects.steam",
        detail: "ArenaEffects",
      },
      {
        name: "blizzard",
        type: "constant",
        documentation: "Blizzard arena effect.",
        insertText: "ArenaEffects.blizzard",
        detail: "ArenaEffects",
      },
      {
        name: "ice",
        type: "constant",
        documentation: "Ice arena effect.",
        insertText: "ArenaEffects.ice",
        detail: "ArenaEffects",
      },
      {
        name: "lightningStrike",
        type: "constant",
        documentation: "Lightning strike arena effect.",
        insertText: "ArenaEffects.lightningStrike",
        detail: "ArenaEffects",
      },
      {
        name: "powerSurge",
        type: "constant",
        documentation: "Power surge arena effect.",
        insertText: "ArenaEffects.powerSurge",
        detail: "ArenaEffects",
      },
      {
        name: "smoke",
        type: "constant",
        documentation: "Smoke arena effect.",
        insertText: "ArenaEffects.smoke",
        detail: "ArenaEffects",
      },
      {
        name: "thunderstorm",
        type: "constant",
        documentation: "Thunderstorm arena effect.",
        insertText: "ArenaEffects.thunderstorm",
        detail: "ArenaEffects",
      },
      {
        name: "explosion",
        type: "constant",
        documentation: "Explosion arena effect.",
        insertText: "ArenaEffects.explosion",
        detail: "ArenaEffects",
      },
      {
        name: "sludge",
        type: "constant",
        documentation: "Sludge arena effect.",
        insertText: "ArenaEffects.sludge",
        detail: "ArenaEffects",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Complex game types
//
// Source: gameApi.ts getComplexTypes(). CompletionProvider's flat battle.* /
// battle:* / combat.* entries are reconciled INTO these objects (they are
// projections of BattleState / Combat members and add no new info beyond what
// the object members already carry) — with one exception noted below:
//   - battle:isSelected — present only in CompletionProvider; added to
//     BattleState as a new member so it is not dropped.
// ---------------------------------------------------------------------------

const complexTypes = (): ApiItem[] => [
  {
    name: "Area",
    type: "object",
    documentation: "A world or battle area.",
    members: [
      { name: "biome", type: "property", documentation: "The biome of the area.", detail: "Biome" },
      { name: "level", type: "property", documentation: "The level of the area.", detail: "int" },
      { name: "width", type: "property", documentation: "The width of the area.", detail: "int" },
      { name: "height", type: "property", documentation: "The height of the area.", detail: "int" },
      {
        name: "getTilesAt",
        type: "method",
        documentation: "Returns the tiles at a location.",
        args: [
          { name: "x", type: "int" },
          { name: "y", type: "int" },
        ],
        returns: { type: "Tile[]" },
      },
      {
        name: "setTileLit",
        type: "method",
        documentation: "Sets whether a given tile is lit.",
        args: [
          { name: "point", type: "Point" },
          { name: "isLit", type: "bool" },
        ],
      },
      {
        name: "isTileBlocked",
        type: "method",
        documentation: "Whether there is a blocking tile at this location.",
        args: [
          { name: "x", type: "int" },
          { name: "y", type: "int" },
        ],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Tile",
    type: "object",
    documentation: "A tile within an area.",
    members: [
      { name: "name", type: "property", documentation: "The tile's name.", detail: "string" },
      {
        name: "description",
        type: "property",
        documentation: "The tile's description.",
        detail: "string",
      },
      {
        name: "blocksVision",
        type: "property",
        documentation: "Whether the tile blocks vision.",
        detail: "bool",
      },
      {
        name: "hasCollision",
        type: "property",
        documentation: "Whether the tile has collision.",
        detail: "bool",
      },
      {
        name: "interactable",
        type: "property",
        documentation: "Whether the tile is interactable.",
        detail: "bool",
      },
      {
        name: "isTileExplored",
        type: "property",
        documentation: "Whether the tile has been explored.",
        detail: "bool",
      },
      {
        name: "isTileLit",
        type: "property",
        documentation: "Whether the tile is lit.",
        detail: "bool",
      },
      { name: "tags", type: "property", documentation: "The tile's tags.", detail: "string[]" },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether the tile has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
      {
        name: "onUse",
        type: "callback",
        documentation: "Overridable. Called when the tile is used.",
      },
      {
        name: "playerSteppedOn",
        type: "callback",
        documentation: "Overridable. Called when the player steps on the tile.",
        args: [{ name: "player", type: "Player" }],
      },
    ],
  },
  {
    name: "ArenaEffect",
    type: "object",
    tags: ["battle"],
    documentation: "An effect placed on a tile of the battle arena.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the effect.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the effect.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the effect.",
        detail: "string",
      },
      {
        name: "duration",
        type: "property",
        documentation: "The duration of the effect.",
        detail: "int",
      },
      {
        name: "onSteppedOn",
        type: "callback",
        documentation: "Overridable. Called when a creature steps on the effect.",
      },
      {
        name: "new",
        type: "function",
        documentation: "Constructor.",
        args: [
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "sprite", type: "string" },
          { name: "creatureEffect", type: "string" },
          { name: "duration", type: "int" },
        ],
        returns: { type: "ArenaEffect" },
      },
    ],
  },
  {
    name: "BattleEntity",
    type: "object",
    tags: ["battle"],
    documentation: "A non-creature entity placed on the battlefield.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the entity.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the entity.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the entity.",
        detail: "string",
      },
      {
        name: "position",
        type: "property",
        documentation: "The position of the entity.",
        detail: "Point",
      },
      {
        name: "owner",
        type: "property",
        documentation: "The owner of the entity.",
        detail: "BattleCreature",
      },
      {
        name: "script",
        type: "property",
        documentation: "The script of the entity.",
        detail: "string",
      },
      {
        name: "remove",
        type: "property",
        documentation: "If true, the entity will be destroyed.",
        detail: "bool",
      },
    ],
  },
  {
    name: "Item",
    type: "object",
    tags: ["items"],
    documentation: "An item.",
    members: [
      { name: "name", type: "property", documentation: "The name of the item.", detail: "string" },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the item.",
        detail: "string",
      },
      {
        name: "script",
        type: "property",
        documentation: "The script of the item.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the item.",
        detail: "string",
      },
      {
        name: "rarity",
        type: "property",
        documentation: "The rarity of the item.",
        detail: "ItemRarity",
      },
      { name: "value", type: "property", documentation: "The value of the item.", detail: "int" },
      {
        name: "stackSize",
        type: "property",
        documentation: "The stack size of the item.",
        detail: "int",
      },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether the item has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
      {
        name: "onUse",
        type: "callback",
        documentation: "Overridable. Called when the item is used.",
        args: [{ name: "target", type: "Creature" }],
      },
    ],
  },
  {
    name: "CreatureStats",
    type: "object",
    documentation: "A creature's stat block.",
    members: [
      { name: "health", type: "property", documentation: "The health stat.", detail: "double" },
      {
        name: "maxHealth",
        type: "property",
        documentation: "The maximum health stat.",
        detail: "double",
      },
      { name: "attack", type: "property", documentation: "The attack stat.", detail: "double" },
      { name: "defense", type: "property", documentation: "The defense stat.", detail: "double" },
      { name: "speed", type: "property", documentation: "The speed stat.", detail: "double" },
      {
        name: "specialAttack",
        type: "property",
        documentation: "The special attack stat.",
        detail: "double",
      },
      {
        name: "specialDefense",
        type: "property",
        documentation: "The special defense stat.",
        detail: "double",
      },
      { name: "luck", type: "property", documentation: "The luck stat.", detail: "double" },
      {
        name: "fireDamage",
        type: "property",
        documentation: "The fire damage stat.",
        detail: "double",
      },
      {
        name: "fireDefense",
        type: "property",
        documentation: "The fire defense stat.",
        detail: "double",
      },
      {
        name: "frostDamage",
        type: "property",
        documentation: "The frost damage stat.",
        detail: "double",
      },
      {
        name: "frostDefense",
        type: "property",
        documentation: "The frost defense stat.",
        detail: "double",
      },
      {
        name: "lightningDamage",
        type: "property",
        documentation: "The lightning damage stat.",
        detail: "double",
      },
      {
        name: "lightningDefense",
        type: "property",
        documentation: "The lightning defense stat.",
        detail: "double",
      },
      {
        name: "poisonDamage",
        type: "property",
        documentation: "The poison damage stat.",
        detail: "double",
      },
      {
        name: "poisonDefense",
        type: "property",
        documentation: "The poison defense stat.",
        detail: "double",
      },
    ],
  },
  {
    name: "CreatureEffect",
    type: "object",
    tags: ["battle"],
    documentation: "An effect applied to a creature.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the effect.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the effect.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the effect.",
        detail: "string",
      },
      {
        name: "duration",
        type: "property",
        documentation: "The duration of the effect.",
        detail: "int",
      },
      {
        name: "caster",
        type: "property",
        documentation: "The caster of the effect.",
        detail: "Creature",
      },
      {
        name: "tags",
        type: "property",
        documentation: "The tags of the effect.",
        detail: "string[]",
      },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether the effect has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
      {
        name: "tick",
        type: "callback",
        documentation: "Overridable. Called on game tick / start of turn.",
        args: [{ name: "target", type: "BattleCreature" }],
      },
      {
        name: "onApplied",
        type: "callback",
        documentation: "Overridable. Called when the effect is first applied.",
        args: [{ name: "target", type: "BattleCreature" }],
      },
      {
        name: "onRemoved",
        type: "callback",
        documentation: "Overridable. Called when the effect is removed.",
        args: [{ name: "target", type: "BattleCreature" }],
      },
      {
        name: "onIncomingAction",
        type: "callback",
        documentation: "Overridable. Called on the IncomingAction stage of an attack.",
        args: [
          { name: "caster", type: "BattleCreature" },
          { name: "action", type: "CombatAction" },
        ],
      },
      {
        name: "onOutgoingAction",
        type: "callback",
        documentation: "Overridable. Called on the OutgoingAction stage of an attack.",
        args: [{ name: "action", type: "CombatAction" }],
      },
    ],
  },
  {
    name: "Biogram",
    type: "object",
    documentation: "A biogram that can be slotted into abilities.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the biogram.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the biogram.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the biogram.",
        detail: "string",
      },
      {
        name: "tags",
        type: "property",
        documentation: "The tags of the biogram.",
        detail: "string[]",
      },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether the biogram has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
      {
        name: "enact",
        type: "callback",
        documentation: "Overridable. Transforms the combat actions produced by an ability.",
        args: [
          { name: "combat", type: "Combat" },
          { name: "actions", type: "CombatAction[]" },
        ],
        returns: { type: "CombatAction[]" },
      },
    ],
  },
  {
    name: "Ability",
    type: "object",
    documentation: "A creature's ability.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the ability.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the ability.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the ability.",
        detail: "string",
      },
      {
        name: "shape",
        type: "property",
        documentation: "The shape of the ability.",
        detail: "Shape",
      },
      {
        name: "tags",
        type: "property",
        documentation: "The tags of the ability.",
        detail: "string[]",
      },
      {
        name: "maxTargets",
        type: "property",
        documentation: "The max targets of the ability.",
        detail: "int",
      },
      {
        name: "range",
        type: "property",
        documentation: "The range of the ability.",
        detail: "int",
      },
      { name: "cost", type: "property", documentation: "The cost of the ability.", detail: "int" },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether the ability has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
      {
        name: "enact",
        type: "callback",
        documentation: "Overridable. Produces the combat actions when the ability is cast.",
        args: [{ name: "combat", type: "Combat" }],
        returns: { type: "CombatAction[]" },
      },
    ],
  },
  {
    name: "AbilityAttack",
    type: "object",
    documentation: "An ability paired with a socketed biogram, as cast in combat.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the attack.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the attack.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the attack.",
        detail: "string",
      },
      {
        name: "shape",
        type: "property",
        documentation: "The shape of the attack.",
        detail: "Shape",
      },
      {
        name: "tags",
        type: "property",
        documentation: "The tags of the attack.",
        detail: "string[]",
      },
      {
        name: "maxTargets",
        type: "property",
        documentation: "The max targets of the attack.",
        detail: "int",
      },
      { name: "range", type: "property", documentation: "The range of the attack.", detail: "int" },
      { name: "cost", type: "property", documentation: "The cost of the attack.", detail: "int" },
      {
        name: "ability",
        type: "property",
        documentation: "The underlying ability.",
        detail: "Ability",
      },
      {
        name: "biogram",
        type: "property",
        documentation: "The socketed biogram.",
        detail: "Biogram",
      },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether the attack has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
      {
        name: "acceptsBiogram",
        type: "method",
        documentation: "Whether the attack accepts the given biogram.",
        args: [{ name: "biogram", type: "Biogram" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Creature",
    type: "object",
    documentation: "A creature (out of combat).",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the creature.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the creature.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the creature.",
        detail: "string",
      },
      {
        name: "level",
        type: "property",
        documentation: "The level of the creature.",
        detail: "int",
      },
      {
        name: "currentXP",
        type: "property",
        documentation: "The current XP of the creature.",
        detail: "int",
      },
      {
        name: "nextXP",
        type: "property",
        documentation: "The XP required for the next level.",
        detail: "int",
      },
      {
        name: "stats",
        type: "property",
        documentation: "The stats of the creature.",
        detail: "CreatureStats",
      },
      {
        name: "effects",
        type: "property",
        documentation: "The effects on the creature.",
        detail: "CreatureEffect[]",
      },
      {
        name: "abilities",
        type: "property",
        documentation: "The abilities of the creature.",
        detail: "Ability[]",
      },
      {
        name: "applyEffect",
        type: "method",
        documentation: "Applies an effect to the creature.",
        args: [
          { name: "effect", type: "string" },
          { name: "duration", type: "int" },
        ],
      },
      {
        name: "removeEffect",
        type: "method",
        documentation: "Removes an effect from the creature by name.",
        args: [{ name: "effectName", type: "string" }],
      },
      {
        name: "removeEffect",
        type: "method",
        documentation: "Removes a specific effect instance from the creature.",
        args: [{ name: "effect", type: "CreatureEffect" }],
      },
    ],
  },
  {
    name: "BattleCreature",
    type: "object",
    tags: ["battle"],
    documentation: "A creature in combat (a Creature with combat state and actions).",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the creature.",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the creature.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the creature.",
        detail: "string",
      },
      {
        name: "level",
        type: "property",
        documentation: "The level of the creature.",
        detail: "int",
      },
      {
        name: "stats",
        type: "property",
        documentation: "The stats of the creature.",
        detail: "CreatureStats",
      },
      {
        name: "effects",
        type: "property",
        documentation: "The effects on the creature.",
        detail: "CreatureEffect[]",
      },
      {
        name: "currentXP",
        type: "property",
        documentation: "The current XP of the creature.",
        detail: "int",
      },
      {
        name: "nextXP",
        type: "property",
        documentation: "The XP required for the next level.",
        detail: "int",
      },
      {
        name: "maxActionPoints",
        type: "property",
        documentation: "The maximum action points of the creature.",
        detail: "double",
      },
      {
        name: "position",
        type: "property",
        documentation: "The position of the creature.",
        detail: "Point",
      },
      {
        name: "actionPoints",
        type: "property",
        documentation: "The current action points of the creature.",
        detail: "double",
      },
      {
        name: "applyEffect",
        type: "method",
        documentation: "Applies an effect to the creature.",
        args: [
          { name: "effect", type: "string" },
          { name: "duration", type: "int" },
        ],
      },
      {
        name: "removeEffect",
        type: "method",
        documentation: "Removes an effect from the creature.",
        args: [{ name: "effect", type: "string" }],
      },
      {
        name: "takeDamage",
        type: "method",
        documentation: "Takes some amount of damage. Handles death.",
        args: [
          { name: "amount", type: "double" },
          { name: "type", type: "DamageType" },
        ],
      },
      {
        name: "takeHealing",
        type: "method",
        documentation: "Takes some amount of healing. Handles over-heal.",
        args: [{ name: "amount", type: "double" }],
      },
      {
        name: "distance",
        type: "method",
        documentation: "Distance to another creature.",
        args: [{ name: "other", type: "BattleCreature" }],
        returns: { type: "double" },
      },
    ],
  },
  {
    name: "BattleState",
    type: "object",
    tags: ["battle"],
    documentation: "The current battle. Obtained via GetBattleState().",
    members: [
      {
        name: "battlemap",
        type: "property",
        documentation: "The battle map / arena.",
        detail: "Area",
      },
      {
        name: "activeCreature",
        type: "property",
        documentation: "The creature whose turn it is.",
        detail: "BattleCreature",
      },
      {
        name: "opponents",
        type: "property",
        documentation: "The opposing creatures.",
        detail: "BattleCreature[]",
      },
      {
        name: "party",
        type: "property",
        documentation: "The friendly party.",
        detail: "BattleCreature[]",
      },
      {
        name: "targets",
        type: "property",
        documentation: "The player-selected targets.",
        detail: "BattleCreature[]",
      },
      {
        name: "getBattleOrder",
        type: "method",
        documentation: "The turn order of the battle.",
        returns: { type: "BattleCreature[]" },
        insertText: "local ${1:battleOrder} = battle:getBattleOrder()",
        detail: "BattleCreature[]",
      },
      {
        name: "isPlayerOwned",
        type: "method",
        documentation: "Whether the creature is owned by the player.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
      },
      {
        name: "isFriendly",
        type: "method",
        documentation: "Whether the creature is friendly to the active creature.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
        insertText: "local ${1:friendly} = battle:isFriendly(${2:creature})",
        detail: "bool",
      },
      {
        name: "isFriendly",
        type: "method",
        documentation: "Whether two creatures are friendly to each other.",
        args: [
          { name: "creatureA", type: "BattleCreature" },
          { name: "creatureB", type: "BattleCreature" },
        ],
        returns: { type: "bool" },
      },
      {
        name: "isSelected",
        type: "method",
        documentation:
          "Whether the creature is currently selected as a target. (Only in the predecessor's CompletionProvider.)",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
        insertText: "local ${1:selected} = battle:isSelected(${2:creature})",
        detail: "bool",
      },
      {
        name: "isCreatureVisible",
        type: "method",
        documentation: "Whether the creature is visible.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
        insertText: "local ${1:visible} = battle:isCreatureVisible(${2:creature})",
        detail: "bool",
      },
      {
        name: "findCreatures",
        type: "method",
        documentation: "Search for creatures within a shape.",
        args: [{ name: "shape", type: "Shape" }],
        returns: { type: "BattleCreature[]" },
        insertText: "local ${1:creatures} = battle:findCreatures(${2:shape})",
        detail: "BattleCreature[]",
      },
      {
        name: "getCatchGuardRating",
        type: "method",
        documentation: "The catch guard rating of a creature.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "int" },
        insertText: "local ${1:guardRating} = battle:getCatchGuardRating(${2:creature})",
        detail: "int",
      },
      {
        name: "getMoveAPCost",
        type: "method",
        documentation: "How much it costs to move a creature along a path.",
        args: [
          { name: "creature", type: "BattleCreature" },
          { name: "path", type: "Point[]" },
        ],
        returns: { type: "double" },
        insertText: "local ${1:moveAPCost} = battle:getMoveAPCost(${2:creature}, ${3:path})",
        detail: "double",
      },
      {
        name: "getCreatureAt",
        type: "method",
        documentation: "The creature at a specific point, if any.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "BattleCreature" },
        insertText: "local ${1:creature} = battle:getCreatureAt(${2:point})",
        detail: "BattleCreature",
      },
      {
        name: "isCreaturePresent",
        type: "method",
        documentation: "Whether a creature exists at a point.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "bool" },
        insertText: "local ${1:present} = battle:isCreaturePresent(${2:point})",
        detail: "bool",
      },
      {
        name: "getArenaEffect",
        type: "method",
        documentation: "The arena effect at a location, if any.",
        args: [
          { name: "x", type: "int" },
          { name: "y", type: "int" },
        ],
        returns: { type: "ArenaEffect" },
        insertText: "local ${1:arenaEffect} = battle:getArenaEffect(${2:x}, ${3:y})",
        detail: "ArenaEffect",
      },
      {
        name: "setArenaEffect",
        type: "method",
        documentation: "Sets the arena effect at a location.",
        args: [
          { name: "x", type: "int" },
          { name: "y", type: "int" },
          { name: "effect", type: "ArenaEffect" },
        ],
        insertText: "battle:setArenaEffect(${1:x}, ${2:y}, ${3:effect})",
        detail: "void",
      },
      {
        name: "createEntity",
        type: "method",
        documentation: "Creates a battle entity.",
        args: [{ name: "props", type: "table" }],
        returns: { type: "BattleEntity" },
        insertText: "local ${1:battleEntity} = battle:createEntity(${2:props})",
        detail: "BattleEntity",
      },
      {
        name: "getCreaturesByDistance",
        type: "method",
        documentation: "Creatures ordered by distance from a position.",
        args: [
          { name: "position", type: "Point" },
          { name: "includeFriendly", type: "bool" },
          { name: "includeEnemy", type: "bool" },
        ],
        returns: { type: "BattleCreature[]" },
      },
      {
        name: "resolveCombat",
        type: "method",
        documentation: "Resolves a combat round for a cast.",
        args: [
          { name: "caster", type: "BattleCreature" },
          { name: "castingLocation", type: "Point" },
          { name: "targets", type: "BattleCreature[]" },
          { name: "attack", type: "AbilityAttack" },
        ],
      },
    ],
  },
  {
    name: "Inventory",
    type: "object",
    tags: ["items"],
    documentation: "The player's items and money.",
    members: [
      {
        name: "money",
        type: "property",
        documentation: "The amount of money the player is carrying.",
        detail: "int",
      },
      {
        name: "items",
        type: "property",
        documentation: "The items stored in the inventory.",
        detail: "Item[]",
      },
      {
        name: "swapItems",
        type: "method",
        documentation: "Swaps two items in the inventory.",
        args: [
          { name: "itemA", type: "Item" },
          { name: "itemB", type: "Item" },
        ],
      },
      {
        name: "addItem",
        type: "method",
        documentation: "Adds an item to the inventory.",
        args: [{ name: "item", type: "Item" }],
        returns: { type: "bool" },
      },
      {
        name: "getItem",
        type: "method",
        documentation: "Retrieves the item at the specified index.",
        args: [{ name: "index", type: "int" }],
        returns: { type: "Item" },
      },
    ],
  },
  {
    name: "Player",
    type: "object",
    documentation: "The player.",
    members: [
      { name: "name", type: "property", documentation: "The player's name.", detail: "string" },
      {
        name: "x",
        type: "property",
        documentation: "The x position of the player.",
        detail: "int",
      },
      {
        name: "y",
        type: "property",
        documentation: "The y position of the player.",
        detail: "int",
      },
    ],
  },
  {
    name: "Combat",
    type: "object",
    tags: ["battle"],
    documentation:
      "The combat context passed to an ability's enact. The flat combat.caster / combat.castingLocation / combat.targets completions in the predecessor are these members.",
    members: [
      {
        name: "caster",
        type: "property",
        documentation: "The creature casting in this combat round.",
        detail: "BattleCreature",
      },
      {
        name: "castingLocation",
        type: "property",
        documentation: "The location at which the caster is casting.",
        detail: "Point",
      },
      {
        name: "targets",
        type: "property",
        documentation: "The creatures the player has targeted (0 or more).",
        detail: "BattleCreature[]",
      },
      {
        name: "attack",
        type: "property",
        documentation: "The ability being cast.",
        detail: "AbilityAttack",
      },
      {
        name: "addAction",
        type: "method",
        documentation: "Adds a new combat action.",
        args: [{ name: "action", type: "CombatAction" }],
      },
      {
        name: "addSpriteAnimation",
        type: "method",
        documentation: "Adds a new sprite animation.",
        args: [
          { name: "position", type: "Point" },
          { name: "sprite", type: "string" },
        ],
      },
      {
        name: "addArenaEffect",
        type: "method",
        documentation: "Adds a new arena effect.",
        args: [
          { name: "position", type: "Point" },
          { name: "shape", type: "Shape" },
          { name: "radius", type: "int" },
          { name: "effect", type: "ArenaEffect" },
        ],
      },
      {
        name: "addEntity",
        type: "method",
        documentation: "Adds a new entity.",
        args: [{ name: "props", type: "table" }],
      },
      {
        name: "getActions",
        type: "method",
        documentation: "The combat actions accumulated so far.",
        returns: { type: "CombatAction[]" },
      },
    ],
  },
  {
    name: "PlayerController",
    type: "object",
    documentation: "Interact with the game in a protected manner. Obtained via GetController().",
    members: [
      {
        name: "cast",
        type: "method",
        documentation: "Uses an ability.",
        args: [
          { name: "attack", type: "AbilityAttack" },
          { name: "castingLocation", type: "Point" },
          { name: "targets", type: "BattleCreature[]" },
        ],
      },
      {
        name: "moveCreature",
        type: "method",
        documentation: "Moves a creature along a path.",
        args: [
          { name: "creature", type: "BattleCreature" },
          { name: "path", type: "Point[]" },
        ],
      },
      { name: "endTurn", type: "method", documentation: "Ends the turn in combat." },
      {
        name: "useItem",
        type: "method",
        documentation: "Uses an item outside of combat. Target is optional.",
        args: [
          { name: "item", type: "Item" },
          { name: "target", type: "Creature" },
        ],
      },
      {
        name: "useBattleItem",
        type: "method",
        documentation: "Uses an item in combat. Target is optional.",
        args: [
          { name: "item", type: "Item" },
          { name: "target", type: "BattleCreature" },
        ],
      },
      {
        name: "dropItem",
        type: "method",
        documentation: "Drops an item on the ground.",
        args: [{ name: "item", type: "Item" }],
      },
      {
        name: "socketBiogram",
        type: "method",
        documentation: "Sockets a biogram into an ability.",
        args: [
          { name: "creature", type: "Creature" },
          { name: "ability", type: "AbilityAttack" },
          { name: "biogram", type: "Biogram" },
        ],
      },
      {
        name: "unsocketBiogram",
        type: "method",
        documentation: "Removes a biogram from an ability.",
        args: [{ name: "attack", type: "AbilityAttack" }],
      },
      {
        name: "sellItem",
        type: "method",
        documentation: "Sells an item to the shop.",
        args: [{ name: "item", type: "Item" }],
      },
      {
        name: "buyItem",
        type: "method",
        documentation: "Buys an item from the shop.",
        args: [
          { name: "item", type: "Item" },
          { name: "cost", type: "int" },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Global functions & libraries
//
// Source: gameApi.ts getGlobals() reconciled with CompletionProvider's
// getGameAPI()/getCombatAPICompletions() globals.
//   - GetBag, GetStore, GetBattleState: present in both. gameApi.ts's
//     args/returns kept; CompletionProvider's insertText folded in.
//   - GetParty, GetArea, GetGameManager: present only in CompletionProvider —
//     added here so they are not dropped.
// ---------------------------------------------------------------------------

const globals = (): ApiItem[] => [
  {
    name: "GetStore",
    type: "function",
    tags: ["utility"],
    documentation: "Keeps track of global state per store name.",
    args: [{ name: "storeName", type: "string" }],
    returns: { type: "table" },
    insertText: 'local ${1:store} = GetStore("${2:name}")',
    detail: "table",
    examples: [
      {
        title: "Persist a flag",
        code: 'local playerStore = GetStore("player")\nplayerStore.hasUnlockedTorch = true\n',
      },
    ],
  },
  {
    name: "GetBag",
    type: "function",
    tags: ["items"],
    documentation: "Returns the player's bag (inventory).",
    args: [],
    returns: { type: "Inventory" },
    insertText: "local ${1:bag} = GetBag()",
    detail: "Inventory",
  },
  {
    name: "GetParty",
    type: "function",
    documentation:
      "Returns the player's party of creatures. (Only in the predecessor's CompletionProvider.)",
    returns: { type: "Creature[]" },
    insertText: "local ${1:party} = GetParty()",
    detail: "Creature[]",
  },
  {
    name: "GetArea",
    type: "function",
    documentation: "Returns the current area. (Only in the predecessor's CompletionProvider.)",
    returns: { type: "Area" },
    insertText: "local ${1:area} = GetArea()",
    detail: "Area",
  },
  {
    name: "GetGameManager",
    type: "function",
    tags: ["utility"],
    documentation:
      "Returns the game's GameManager. (Only in the predecessor's CompletionProvider; the GameManager type is not described in either source.)",
    returns: { type: "GameManager" },
    insertText: "local ${1:gm} = GetGameManager()",
    detail: "GameManager",
  },
  {
    name: "Battle",
    type: "library",
    tags: ["battle"],
    documentation: "Battle utility functions.",
    members: [
      {
        name: "LogCombat",
        type: "function",
        documentation: "Writes a battle log message.",
        args: [{ name: "message", type: "string" }],
      },
    ],
  },
  {
    name: "GetNearestEnemy",
    type: "function",
    tags: ["battle"],
    documentation: "Returns the nearest enemy to the active creature.",
    returns: { type: "BattleCreature" },
  },
  {
    name: "GetNearestFriendly",
    type: "function",
    tags: ["battle"],
    documentation: "Returns the nearest friendly to the active creature.",
    returns: { type: "BattleCreature" },
  },
  {
    name: "GetBattleState",
    type: "function",
    tags: ["battle"],
    documentation: "Returns the current battle state, if the current state is a battle.",
    returns: { type: "BattleState" },
    insertText: "local ${1:battle} = GetBattleState()",
    detail: "BattleState",
  },
  {
    name: "IsPlayerOwned",
    type: "function",
    tags: ["battle"],
    documentation: "Whether the creature is owned by the player.",
    returns: { type: "bool" },
  },
  {
    name: "GetJournal",
    type: "function",
    documentation: "Returns the player's journal, which tracks progress in the game.",
    returns: { type: "Journal" },
  },
  {
    name: "GetPlayer",
    type: "function",
    documentation: "Returns the player.",
    returns: { type: "Player" },
  },
  {
    name: "GetAbilityById",
    type: "function",
    documentation: "Returns the ability with the given id.",
    args: [{ name: "id", type: "string" }],
    returns: { type: "Ability" },
  },
  {
    name: "GetItemById",
    type: "function",
    tags: ["items"],
    documentation: "Returns the item with the given id.",
    args: [{ name: "id", type: "string" }],
    returns: { type: "Item" },
  },
  {
    name: "SaveGame",
    type: "function",
    documentation: "Attempts to save the game. You cannot save during combat.",
  },
  {
    name: "GetController",
    type: "function",
    documentation: "Returns the player controller.",
    returns: { type: "PlayerController" },
  },
  {
    name: "GetAbilityLibrary",
    type: "function",
    documentation:
      "Returns the ability library from which the player can train their kitties new abilities.",
    returns: { type: "Ability[]" },
  },
  {
    name: "GetUnlockedDLC",
    type: "function",
    documentation: "Returns all unlocked DLC.",
    returns: { type: "DLCPack[]" },
  },
  {
    name: "GetAllDLC",
    type: "function",
    documentation: "Returns all DLC, locked included.",
    returns: { type: "DLCPack[]" },
  },
  {
    name: "IsDLCUnlocked",
    type: "function",
    documentation: "Returns true if the player has unlocked the DLC.",
    args: [{ name: "id", type: "string" }],
    returns: { type: "bool" },
  },
  {
    name: "UnlockDLC",
    type: "function",
    documentation: "Unlocks a DLC if possible.",
    args: [{ name: "id", type: "string" }],
  },
];

// ---------------------------------------------------------------------------
// `self` — the script's own object
//
// Source: CompletionProvider's getSelfCompletions / per-entity self.*.
// gameApi.ts had no `self` surface. Inside a creature/ability/item/effect/
// biogram script, `self` is the object being scripted. The members vary by
// entity kind; we collect them under one `self` namespace and tag each member
// with the entity kind(s) it applies to, so a future context-aware completion
// provider can filter by the active script's entity type.
// ---------------------------------------------------------------------------

const selfApi = (): ApiItem => ({
  name: "self",
  type: "namespace",
  documentation:
    "The object this script belongs to. Available members depend on the entity kind (creature, ability, item, effect, biogram).",
  members: [
    // Common to all entity scripts.
    {
      name: "name",
      type: "property",
      documentation: "The name.",
      detail: "string",
      tags: ["ability", "item", "effect", "biogram"],
    },
    {
      name: "sprite",
      type: "property",
      documentation: "The sprite.",
      detail: "Image",
      tags: ["ability", "item", "effect", "biogram"],
    },
    {
      name: "description",
      type: "property",
      documentation: "The description.",
      detail: "string",
      tags: ["ability", "item", "effect", "biogram"],
    },
    // Ability-only.
    {
      name: "shape",
      type: "property",
      documentation: "The shape (ability scripts).",
      detail: "Shape",
      tags: ["ability"],
    },
    {
      name: "cost",
      type: "property",
      documentation: "The cost (ability scripts).",
      detail: "int",
      tags: ["ability"],
    },
    {
      name: "range",
      type: "property",
      documentation: "The range (ability scripts).",
      detail: "int",
      tags: ["ability"],
    },
    {
      name: "radius",
      type: "property",
      documentation: "The radius (ability scripts).",
      detail: "int",
      tags: ["ability"],
    },
    {
      name: "maxTargets",
      type: "property",
      documentation: "The max targets (ability scripts).",
      detail: "int",
      tags: ["ability"],
    },
    // tags / hasTag are available on ability and biogram scripts.
    {
      name: "tags",
      type: "property",
      documentation: "The tags.",
      detail: "string[]",
      tags: ["ability", "biogram"],
    },
    {
      name: "hasTag",
      type: "method",
      documentation: "Whether the tag is present.",
      args: [{ name: "tag", type: "string" }],
      returns: { type: "bool" },
      insertText: "local ${1:hasTag} = self:hasTag(${2:tag})",
      detail: "bool",
      tags: ["ability", "biogram"],
    },
  ],
});

// ---------------------------------------------------------------------------
// XGUI interaction reference
//
// This section documents the GUI editor's INTERACTION surface — the handler,
// `modal`, and tooltip ATTRIBUTES a GUI component element can carry, how the
// worlds-cpp XGUI runtime derives hit-testing/focus from them, and the Lua
// handler signatures a controller implements. These are XML attributes (not Lua
// globals), but they live in this one tree so the reference pane and future
// intellisense share a single source. Ground truth for the derivation rules is
// the engine (see src/lib/guiInteraction.ts, which cites the engine file:line);
// the prose here is kept tight — reference, not tutorial.
// ---------------------------------------------------------------------------

/** Which element tags accept the mouse + focus (non-key) input handlers. */
const INPUT_HANDLER_TAGS = "Panel · Text · Component";
/** onKeyPressed is additionally accepted on the root View (unfocused key events). */
const KEY_HANDLER_TAGS = "View · Panel · Text · Component";

const xguiInteraction = (): ApiItem => ({
  name: "XGUI Interaction",
  type: "namespace",
  tags: ["xgui", "gui"],
  documentation:
    "GUI component interaction attributes — the mouse/key/focus handlers, `modal`, and tooltip attributes an element can carry, how the engine derives hit-testing and focus from them, and the Lua handler signatures. These are XML attributes on a component's elements (authored in the GUI editor), documented here so the reference and future intellisense share one source.",
  examples: [
    {
      title: "Handler families (controller table)",
      code: `return function(view)
    return {
        -- input handlers: mouse clicks/moves + focus/blur -> (self, mouse)
        onBuyClicked = function(self, mouse) end,
        -- key handler: onKeyPressed -> (self, input); 2nd arg not yet frozen engine-side
        onKeyPressed = function(self, input) end,
        -- <Event handler="..."> -> (payload); no self
        onItemBought = function(payload) end,
    }
end`,
    },
  ],
  members: [
    {
      name: "attributes",
      type: "namespace",
      documentation:
        "The interaction attributes and which element tags accept each. Handler values are LITERAL controller-function names (never a {token}); `modal` is a literal boolean; `tooltip` is a component ref; `tooltipData` is a binding.",
      members: [
        {
          name: "onMouseClicked",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            "Fires when the element is clicked. Input handler: function(self, mouse). Makes the element hit-testable.",
        },
        {
          name: "onMouseEntered",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            "Fires when the cursor enters the element. Input handler: function(self, mouse). Makes the element hit-testable.",
        },
        {
          name: "onMouseExited",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            "Fires when the cursor leaves the element. Input handler: function(self, mouse). Makes the element hit-testable.",
        },
        {
          name: "onMouseMoved",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            "Fires as the cursor moves over the element. Input handler: function(self, mouse). Makes the element hit-testable.",
        },
        {
          name: "onKeyPressed",
          type: "property",
          detail: KEY_HANDLER_TAGS,
          documentation:
            "Fires on a key press while the element is focused; the root View also receives UNFOCUSED key events. Key handler: function(self, input) — the 2nd arg is not yet frozen engine-side. Grants focus.",
        },
        {
          name: "onFocus",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            "Fires when the element gains keyboard focus. Input handler: function(self, mouse). Grants focus.",
        },
        {
          name: "onBlur",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            "Fires when the element loses keyboard focus. Input handler: function(self, mouse). Grants focus.",
        },
        {
          name: "modal",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            "Literal boolean hit/focus policy. Read PRE-binding via pugixml as_bool, which inspects ONLY the first character: truthy for 1, t/T, y/Y (so true / yes / 1 all work). NOTE: \"on\" is FALSY ('o' isn't in the set). A {token} never resolves here — modal is read straight off the XML. A modal element is hit-testable AND receives focus.",
        },
        {
          name: "tooltip",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            'A tooltip component reference (resolved by basename), e.g. tooltip="gui.kittypacks-tooltip.xml". A non-empty tooltip makes the element hit-testable — a tooltip-only element still eats clicks.',
        },
        {
          name: "tooltipData",
          type: "property",
          detail: INPUT_HANDLER_TAGS,
          documentation:
            'A whole-value binding (e.g. tooltipData="{$.creature}") seeding the tooltip component\'s root model. Has no effect without a tooltip; a bare literal never binds (wrap the model path as {$.path}).',
        },
      ],
    },
    {
      name: "derivation",
      type: "namespace",
      documentation:
        "How the engine derives an element's capabilities from its raw attributes (ground truth: src/lib/guiInteraction.ts, mirroring the worlds-cpp XGUI runtime).",
      members: [
        {
          name: "hit-testable",
          type: "property",
          documentation:
            "The engine tests the element under the cursor when it has ANY mouse handler (onMouseClicked/Entered/Exited/Moved), OR a tooltip, OR is modal. The non-obvious clause: a tooltip-only element (no handlers) is STILL hit-testable — it eats clicks.",
        },
        {
          name: "focusable",
          type: "property",
          documentation:
            "The element can receive keyboard focus when it has a key/focus/blur handler (onKeyPressed / onFocus / onBlur), OR is modal — modal grants focus per XGUI.h:155. Mouse handlers do NOT grant focus.",
        },
      ],
    },
    {
      name: "tooltips",
      type: "namespace",
      documentation:
        "Conventions for tooltip components (v1). A tooltip is a separate component wired via a widget's tooltip attribute.",
      members: [
        {
          name: "component ref",
          type: "property",
          documentation:
            'tooltip is a component ref WITH the .xml suffix, resolved by basename anywhere in the gui tree — e.g. tooltip="gui.kittypacks-tooltip.xml".',
        },
        {
          name: "tooltipData",
          type: "property",
          documentation:
            "tooltipData is a binding like {$.creature} that seeds the tooltip component's root model, so its bound text/props resolve against that data.",
        },
        {
          name: "pixel-sized root",
          type: "property",
          documentation:
            "A tooltip component's root must be PIXEL-SIZED (absolute size, relative width/height zero) — a relative root size won't lay out predictably. The New-component dialog's Tooltip template scaffolds this.",
        },
        {
          name: "no controller",
          type: "property",
          documentation:
            "v1 tooltip components are presentation-only — no controller runs. A tooltip that declares a controller is flagged by the editor's lints.",
        },
      ],
    },
  ],
});

/**
 * The merged Lua API tree — the single source of truth.
 *
 * Order is reference-pane-friendly: language first, then types, then the
 * globals you actually call, the contextual `self` object, and finally the XGUI
 * interaction reference (GUI editor knowledge, not a Lua global).
 */
export const GAME_API: ApiItem[] = [
  luaKeywords(),
  ...luaStdlib(),
  ...basicTypes(),
  ...complexTypes(),
  ...globals(),
  selfApi(),
  xguiInteraction(),
];
