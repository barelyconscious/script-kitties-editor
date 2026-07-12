/**
 * The single source of truth for the game's Lua scripting API.
 *
 * This is **editor knowledge** — a static, hand-authored description of the
 * surface a modder can call from a creature/ability/item/effect/biogram script
 * or a GUI controller. It is NOT per-install game data and is never fetched
 * from Rust; it ships in the frontend bundle.
 *
 * "One source, two surfaces": the Workbench reference pane renders this tree
 * directly, and a future Monaco completion provider will be a *projection* of
 * the same tree (that is what the `insertText` / `detail` fields below feed).
 *
 * GROUND TRUTH: this tree is synced to the actual worlds-cpp sol2 bindings, not
 * to any editor's doc. The engine registers its Lua surface in
 * `LuaLoader.cpp` (14 `ScriptLibrary*`/GUI libs) plus two Lua preludes,
 * `Scripts/__globals.lua` and `Scripts/__libcombat.lua`. Where an older doc
 * disagreed with the bindings, the bindings win (e.g. there is no DLC API,
 * `GetParty` returns a `Party` not a `Creature[]`, `Ability.shape` is an
 * `AbilityShape` enum not a geometry `Shape`, `Inventory.swapItems` takes two
 * indices, `Creature.abilities` is `AbilityAttack[]`). Symbols that come from
 * the Lua preludes rather than a C++ binding are flagged in their docs.
 *
 * Authoring rules, so the tree does not drift:
 *  - Every item has a `name` and a `type`.
 *  - Top-level names are unique. Nested member names may repeat only where the
 *    game genuinely overloads them (e.g. `Creature.removeEffect`).
 *  - `documentation` is prose for the reference pane. `insertText` (a Monaco
 *    snippet) and `detail` (a short type hint) are completion-provider hints.
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

  // --- Completion-provider projection hints. Optional. ---

  /** Monaco snippet string (may contain `${1:...}` tab stops). */
  insertText?: string;
  /** Short type hint shown to the right of a completion (e.g. "BattleCreature"). */
  detail?: string;
};

/** The closed set of node kinds. */
export type ApiItemType =
  // structural
  | "namespace" // a grouping with members but no value of its own
  | "library" // a stdlib/game table you call functions on (string, math, Battle)
  | "object" // a game type with fields and methods
  | "enum" // a set of named constants
  | "function" // a global or constructor function
  | "method" // a function called on a receiver (obj:fn / obj.fn)
  | "property" // a readable/writable field on an object
  | "constant" // a named constant value (enum member, ArenaEffects entry)
  | "callback" // an overridable hook the modder implements
  | "keyword" // a Lua reserved word
  // primitive value types
  | "string"
  | "int"
  | "double"
  | "bool";

/** A function/method parameter. */
export type ApiArg = { name: string; type: string };

/** A worked example for the reference pane. */
export type ApiExample = { title: string; code: string };

// ---------------------------------------------------------------------------
// Lua language surface (Lua 5.4). Not engine bindings — the standard library
// available to every script.
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
        name: "format",
        type: "function",
        documentation: 'Formats a string, printf-style (e.g. string.format("%3.0f", n)).',
        insertText: "string.format(${1:fmt}, ${2:...})",
        args: [{ name: "fmt", type: "string" }],
        returns: { type: "string" },
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
        documentation: "Random number. math.random() → [0,1); math.random(max) → [1,max].",
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
// Enums — `lua.new_enum(...)` across the ScriptLibrary* set, plus the two
// prelude "enum-like" tables (CombatAction, ArenaEffects). Ground truth:
// ScriptLibraryDataTypes.h, ScriptLibraryBattleManager.h, ScriptLibraryInput.h,
// ScriptLibraryGameManager.h, ScriptLibraryDirector.h, LGUI.h, __globals.lua.
// ---------------------------------------------------------------------------

const enums = (): ApiItem[] => [
  {
    name: "Biome",
    type: "enum",
    documentation: "The biome of an area. (C++ enum.)",
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
    tags: ["items"],
    documentation: "The rarity of an item. (C++ enum.)",
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
    name: "DamageType",
    type: "enum",
    tags: ["battle"],
    documentation: "The type of damage dealt by an action. (C++ enum.)",
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
    name: "AbilityShape",
    type: "enum",
    tags: ["battle"],
    documentation:
      "The targeting shape of an ability (this is what `Ability.shape` holds). (C++ enum.)",
    members: [
      { name: "CONE", type: "constant", documentation: "Cone-shaped area." },
      { name: "POINT", type: "constant", documentation: "A single point / tile." },
      { name: "SELF", type: "constant", documentation: "The caster itself." },
      { name: "SPHERE", type: "constant", documentation: "A spherical (radial) area." },
      { name: "SQUARE", type: "constant", documentation: "A square area." },
    ],
  },
  {
    name: "AbilityTag",
    type: "enum",
    tags: ["battle"],
    documentation: "Well-known ability/biogram tags. (C++ enum.)",
    members: [
      { name: "AREA", type: "constant", documentation: "Affects an area." },
      { name: "CONJURE", type: "constant", documentation: "Conjures something." },
      { name: "CONTACT", type: "constant", documentation: "Requires contact." },
      { name: "SET_LOCATION", type: "constant", documentation: "Targets a location." },
      { name: "PROJECTILE", type: "constant", documentation: "A projectile." },
      {
        name: "AUTO_TARGET",
        type: "constant",
        documentation:
          'Auto-targets. NOTE: the engine\'s underlying string value is misspelled "ATUO_TARGET" — compare with AbilityTag.AUTO_TARGET rather than the literal.',
      },
      { name: "HELPFUL", type: "constant", documentation: "A helpful (friendly) ability." },
      { name: "HARMFUL", type: "constant", documentation: "A harmful ability." },
    ],
  },
  {
    name: "CreatureEntryStatus",
    type: "enum",
    documentation: "A creature's status in the Journal (Kittydex). (C++ enum.)",
    members: [
      { name: "NOT_SEEN", type: "constant", documentation: "Never encountered." },
      { name: "DISCOVERED", type: "constant", documentation: "Seen but not caught." },
      { name: "CAUGHT", type: "constant", documentation: "Caught by the player." },
      { name: "DEFEATED", type: "constant", documentation: "Defeated in battle." },
    ],
  },
  {
    name: "GameMode",
    type: "enum",
    documentation: "Top-level game mode, for SetGameMode. (C++ enum.)",
    members: [
      { name: "BATTLE_SCENE", type: "constant", documentation: "The battle scene." },
      { name: "SAVE_SELECTOR_SCENE", type: "constant", documentation: "The save-selector scene." },
      { name: "TITLE_SCENE", type: "constant", documentation: "The title scene." },
    ],
  },
  {
    name: "Key",
    type: "enum",
    tags: ["input"],
    documentation: "Named input bindings, used with Input:isPressed / isDown / isUp. (C++ enum.)",
    members: [
      { name: "UP", type: "constant", documentation: "UI up." },
      { name: "DOWN", type: "constant", documentation: "UI down." },
      { name: "RIGHT", type: "constant", documentation: "UI right." },
      { name: "LEFT", type: "constant", documentation: "UI left." },
      { name: "TAB_RIGHT", type: "constant", documentation: "Tab right." },
      { name: "TAB_LEFT", type: "constant", documentation: "Tab left." },
      { name: "SELECT", type: "constant", documentation: "UI select / confirm." },
      { name: "BACK", type: "constant", documentation: "UI back / cancel." },
      { name: "LOOK", type: "constant", documentation: "Look." },
      { name: "OPEN_HELP", type: "constant", documentation: "Open help." },
      { name: "OPEN_MAP", type: "constant", documentation: "Open the map." },
      { name: "OPEN_BAG", type: "constant", documentation: "Open the bag." },
      { name: "OPEN_PARTY", type: "constant", documentation: "Open the party." },
      { name: "OPEN_PROFILE", type: "constant", documentation: "Open the profile." },
      { name: "RELEASE_CREATURE", type: "constant", documentation: "Release a creature." },
      { name: "ABILITY1", type: "constant", documentation: "Battle ability 1." },
      { name: "ABILITY2", type: "constant", documentation: "Battle ability 2." },
      { name: "ABILITY3", type: "constant", documentation: "Battle ability 3." },
      { name: "ABILITY4", type: "constant", documentation: "Battle ability 4." },
    ],
  },
  {
    name: "KeyBinding",
    type: "enum",
    tags: ["input"],
    documentation:
      "DEPRECATED (engine comment) — the older UI-only binding enum. Prefer `Key`. (C++ enum.)",
    members: [
      { name: "UI_UP", type: "constant", documentation: "UI up." },
      { name: "UI_DOWN", type: "constant", documentation: "UI down." },
      { name: "UI_RIGHT", type: "constant", documentation: "UI right." },
      { name: "UI_LEFT", type: "constant", documentation: "UI left." },
      { name: "UI_TAB_RIGHT", type: "constant", documentation: "Tab right." },
      { name: "UI_TAB_LEFT", type: "constant", documentation: "Tab left." },
      { name: "UI_SELECT", type: "constant", documentation: "Select." },
      { name: "UI_BACK", type: "constant", documentation: "Back." },
    ],
  },
  {
    name: "Button",
    type: "enum",
    tags: ["input"],
    documentation: "Mouse buttons (matches SDL button constants). (C++ enum.)",
    members: [
      { name: "LEFT", type: "constant", documentation: "Left mouse button." },
      { name: "RIGHT", type: "constant", documentation: "Right mouse button." },
      { name: "MIDDLE", type: "constant", documentation: "Middle mouse button." },
    ],
  },
  {
    name: "TextAlignment",
    type: "enum",
    tags: ["gui"],
    documentation: "Text alignment for GUI Text widgets (LGUI). (C++ enum.)",
    members: [
      { name: "LEFT", type: "constant", documentation: "Left-aligned." },
      { name: "CENTER", type: "constant", documentation: "Centered." },
      { name: "RIGHT", type: "constant", documentation: "Right-aligned." },
    ],
  },
  {
    name: "ThoughtType",
    type: "enum",
    tags: ["battle"],
    documentation: "DEPRECATED (engine comment) — legacy AI thought kinds. (C++ enum.)",
    members: [
      { name: "NOTHING", type: "constant", documentation: "Do nothing." },
      { name: "MOVE", type: "constant", documentation: "Move." },
      { name: "ATTACK", type: "constant", documentation: "Attack." },
    ],
  },
  {
    name: "CombatAction",
    type: "enum",
    tags: ["battle"],
    documentation:
      "Kinds of combat action. Defined as a plain Lua TABLE of string constants in __globals.lua (not a C++ enum); the values are the strings below. Also the conceptual shape of an action object you build and push via Combat:addAction — the fields are documented here for reference.",
    members: [
      {
        name: "DAMAGE",
        type: "constant",
        documentation: "Applies damage to a creature.",
        insertText: "CombatAction.DAMAGE",
        detail: "CombatAction",
      },
      {
        name: "MOVE",
        type: "constant",
        documentation: "Relocates a creature.",
        insertText: "CombatAction.MOVE",
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
        name: "SET_ARENA_EFFECT",
        type: "constant",
        documentation: "Places an arena effect over an area.",
        insertText: "CombatAction.SET_ARENA_EFFECT",
        detail: "CombatAction",
      },
      {
        name: "SPRITE_ANIMATION",
        type: "constant",
        documentation: "Plays a sprite animation.",
        insertText: "CombatAction.SPRITE_ANIMATION",
        detail: "CombatAction",
      },
      {
        name: "CREATE_ENTITY",
        type: "constant",
        documentation: "Creates a battle entity.",
        insertText: "CombatAction.CREATE_ENTITY",
        detail: "CombatAction",
      },
      // action-object fields (the shape of a table you build for addAction)
      {
        name: "action",
        type: "property",
        documentation: "The action kind (a CombatAction value).",
        detail: "CombatAction",
      },
      {
        name: "target",
        type: "property",
        documentation: "The target creature.",
        detail: "BattleCreature",
      },
      {
        name: "amount",
        type: "property",
        documentation: "The amount (damage/healing).",
        detail: "double",
      },
      {
        name: "damageType",
        type: "property",
        documentation: "The damage type of a DAMAGE action.",
        detail: "DamageType",
      },
      {
        name: "effect",
        type: "property",
        documentation:
          "The effect (name or object) for APPLY_EFFECT / REMOVE_EFFECT / SET_ARENA_EFFECT.",
        detail: "string | CreatureEffect | ArenaEffect",
      },
      {
        name: "duration",
        type: "property",
        documentation: "The effect duration, in turns.",
        detail: "int",
      },
      {
        name: "position",
        type: "property",
        documentation: "The position for MOVE / CREATE_ENTITY / SPRITE_ANIMATION.",
        detail: "Point",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite for a SPRITE_ANIMATION / CREATE_ENTITY action.",
        detail: "string",
      },
      {
        name: "shape",
        type: "property",
        documentation: "The shape for a SET_ARENA_EFFECT action.",
        detail: "Shape",
      },
      {
        name: "radius",
        type: "property",
        documentation: "The radius for a SET_ARENA_EFFECT action.",
        detail: "int",
      },
      {
        name: "script",
        type: "property",
        documentation: "The script for a CREATE_ENTITY action.",
        detail: "string",
      },
      {
        name: "name",
        type: "property",
        documentation: "The name for a CREATE_ENTITY action.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description for a CREATE_ENTITY action.",
        detail: "string",
      },
    ],
  },
  {
    name: "ArenaEffects",
    type: "namespace",
    tags: ["battle"],
    documentation:
      "The built-in arena effects, as a table of ready-made ArenaEffect instances. Defined in the Lua prelude (__globals.lua), not a C++ binding — use e.g. ArenaEffects.burning with Combat:addArenaEffect / BattleState:setArenaEffect.",
    members: [
      {
        name: "burning",
        type: "constant",
        documentation: "Burning — causes fire damage.",
        detail: "ArenaEffect",
      },
      { name: "wet", type: "constant", documentation: "Wet.", detail: "ArenaEffect" },
      {
        name: "electrified",
        type: "constant",
        documentation: "Electrified — +physical damage, chance to stun.",
        detail: "ArenaEffect",
      },
      { name: "poisoned", type: "constant", documentation: "Poisoned.", detail: "ArenaEffect" },
      {
        name: "frozen",
        type: "constant",
        documentation: "Frozen — chance to stun on step.",
        detail: "ArenaEffect",
      },
      { name: "steam", type: "constant", documentation: "Steam — blinds.", detail: "ArenaEffect" },
      {
        name: "blizzard",
        type: "constant",
        documentation: "Blizzard — chills.",
        detail: "ArenaEffect",
      },
      { name: "ice", type: "constant", documentation: "Ice.", detail: "ArenaEffect" },
      {
        name: "lightningStrike",
        type: "constant",
        documentation: "Lightning strike — electric damage on placement.",
        detail: "ArenaEffect",
      },
      {
        name: "powerSurge",
        type: "constant",
        documentation: "Power surge.",
        detail: "ArenaEffect",
      },
      { name: "smoke", type: "constant", documentation: "Smoke — blinds.", detail: "ArenaEffect" },
      {
        name: "thunderstorm",
        type: "constant",
        documentation: "Thunderstorm.",
        detail: "ArenaEffect",
      },
      {
        name: "explosion",
        type: "constant",
        documentation: "Explosion — fire damage on placement.",
        detail: "ArenaEffect",
      },
      { name: "sludge", type: "constant", documentation: "Sludge.", detail: "ArenaEffect" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Core value types — geometry, colors, stats, and the small structs.
// Ground truth: ScriptLibraryDataTypes.h, Shape.h, ScriptLibraryInput.h.
// ---------------------------------------------------------------------------

const coreTypes = (): ApiItem[] => [
  {
    name: "Point",
    type: "object",
    documentation: "A 2D integer coordinate. Construct with Point.new(x, y).",
    members: [
      { name: "x", type: "property", documentation: "X coordinate.", detail: "int" },
      { name: "y", type: "property", documentation: "Y coordinate.", detail: "int" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs a Point.",
        args: [
          { name: "x", type: "int" },
          { name: "y", type: "int" },
        ],
        returns: { type: "Point" },
      },
      {
        name: "toScreenPosition",
        type: "method",
        documentation:
          "Converts a battle world coordinate to a screen coordinate. Defined in the Lua prelude (__globals.lua), not a C++ binding.",
        returns: { type: "Point" },
      },
    ],
  },
  {
    name: "Color",
    type: "object",
    tags: ["gui"],
    documentation: "An RGBA color (SDL_Color). Construct with Color.new(r, g, b, a).",
    members: [
      { name: "r", type: "property", documentation: "Red (0-255).", detail: "int" },
      { name: "g", type: "property", documentation: "Green (0-255).", detail: "int" },
      { name: "b", type: "property", documentation: "Blue (0-255).", detail: "int" },
      { name: "a", type: "property", documentation: "Alpha (0-255).", detail: "int" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs a Color.",
        args: [
          { name: "r", type: "int" },
          { name: "g", type: "int" },
          { name: "b", type: "int" },
          { name: "a", type: "int" },
        ],
        returns: { type: "Color" },
      },
    ],
  },
  {
    name: "Shape",
    type: "object",
    tags: ["battle"],
    documentation: "Base geometric shape (Sphere / Square). Used for area queries.",
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
    tags: ["battle"],
    documentation: "A spherical (radial) shape. Construct with Sphere.new(radius, center).",
    members: [
      { name: "radius", type: "property", documentation: "The radius.", detail: "int" },
      { name: "center", type: "property", documentation: "The center point.", detail: "Point" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs a Sphere.",
        args: [
          { name: "radius", type: "int" },
          { name: "center", type: "Point" },
        ],
        returns: { type: "Sphere" },
      },
      {
        name: "contains",
        type: "method",
        documentation: "Whether the sphere contains a point.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Square",
    type: "object",
    tags: ["battle"],
    documentation:
      "A square shape. Construct with Square.new(length, center) — the length is the side and center is the middle tile.",
    members: [
      { name: "x", type: "property", documentation: "Left edge (tile).", detail: "int" },
      { name: "y", type: "property", documentation: "Top edge (tile).", detail: "int" },
      { name: "width", type: "property", documentation: "Width in tiles.", detail: "int" },
      { name: "height", type: "property", documentation: "Height in tiles.", detail: "int" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs a Square from a side length and center.",
        args: [
          { name: "length", type: "int" },
          { name: "center", type: "Point" },
        ],
        returns: { type: "Square" },
      },
      {
        name: "contains",
        type: "method",
        documentation: "Whether the square contains a point.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "TickArgs",
    type: "object",
    documentation: "Passed to per-frame update hooks. Carries frame timing.",
    members: [
      {
        name: "deltaTime",
        type: "property",
        documentation: "Seconds since the previous tick.",
        detail: "double",
      },
    ],
  },
  {
    name: "Mouse",
    type: "object",
    tags: ["input"],
    documentation: "A mouse event/state passed to input handlers.",
    members: [
      { name: "x", type: "property", documentation: "Cursor x.", detail: "int" },
      { name: "y", type: "property", documentation: "Cursor y.", detail: "int" },
      {
        name: "button",
        type: "property",
        documentation: "The button involved (see Button).",
        detail: "Button",
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
];

// ---------------------------------------------------------------------------
// Game object types. Ground truth: ScriptLibraryDataTypes.h,
// ScriptLibraryBattleManager.h, ScriptLibraryGameManager.h, ScriptLibraryArea.h,
// Inventory.h, PlayerParty.h, __globals.lua.
// ---------------------------------------------------------------------------

const gameTypes = (): ApiItem[] => [
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
        documentation: "The current XP of the creature (read-only).",
        detail: "int",
      },
      {
        name: "nextXP",
        type: "property",
        documentation: "The XP required for the next level (read-only).",
        detail: "int",
      },
      {
        name: "levelUpExp",
        type: "property",
        documentation: "The XP required for the next level (read-only; same as nextXP).",
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
        documentation: "The creature's ability attacks.",
        detail: "AbilityAttack[]",
      },
      {
        name: "attacks",
        type: "property",
        documentation: "DEPRECATED alias for `abilities`.",
        detail: "AbilityAttack[]",
      },
      {
        name: "charms",
        type: "property",
        documentation: "The creature's equipped charms (read-only).",
        detail: "Charm[]",
      },
      {
        name: "applyEffect",
        type: "method",
        documentation:
          "Applies an effect to the creature by id. Duration defaults to -1 (indefinite).",
        args: [
          { name: "effect", type: "string" },
          { name: "duration", type: "int" },
        ],
      },
      {
        name: "removeEffect",
        type: "method",
        documentation: "Removes an effect from the creature by id.",
        args: [{ name: "effectId", type: "string" }],
      },
      {
        name: "removeEffect",
        type: "method",
        documentation: "Removes a specific effect instance from the creature.",
        args: [{ name: "effect", type: "CreatureEffect" }],
      },
      {
        name: "takeDamage",
        type: "method",
        documentation:
          "Reduces health by amount (clamped at 0). Lua-prelude extension (__globals.lua) — does not run the combat pipeline.",
        args: [
          { name: "amount", type: "double" },
          { name: "damageType", type: "DamageType" },
        ],
      },
      {
        name: "takeHealing",
        type: "method",
        documentation:
          "Increases health by amount (clamped at maxHealth). Lua-prelude extension (__globals.lua).",
        args: [{ name: "amount", type: "double" }],
      },
    ],
  },
  {
    name: "BattleCreature",
    type: "object",
    tags: ["battle"],
    documentation:
      "A creature in combat (BattleCreatureV2 — wraps a Creature with combat state). The `explicitly*` variants bypass the combat action pipeline (no notifications/effects); the plain variants run it.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the creature (read-only).",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the creature (read-only).",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the creature (read-only).",
        detail: "string",
      },
      {
        name: "level",
        type: "property",
        documentation: "The level of the creature (read-only).",
        detail: "int",
      },
      {
        name: "stats",
        type: "property",
        documentation: "The stats of the creature (read-only).",
        detail: "CreatureStats",
      },
      {
        name: "effects",
        type: "property",
        documentation: "The effects on the creature (read-only).",
        detail: "CreatureEffect[]",
      },
      {
        name: "currentXP",
        type: "property",
        documentation: "The current XP (read-only).",
        detail: "int",
      },
      {
        name: "nextXP",
        type: "property",
        documentation: "The XP required for the next level (read-only).",
        detail: "int",
      },
      {
        name: "attacks",
        type: "property",
        documentation: "The creature's ability attacks (read-only).",
        detail: "AbilityAttack[]",
      },
      {
        name: "position",
        type: "property",
        documentation: "The tile position (read/write).",
        detail: "Point",
      },
      {
        name: "actionPoints",
        type: "property",
        documentation: "The current action points.",
        detail: "double",
      },
      {
        name: "maxActionPoints",
        type: "property",
        documentation: "The maximum action points.",
        detail: "double",
      },
      {
        name: "explicitlySetPosition",
        type: "method",
        documentation: "Sets the position without triggering movement side effects.",
        args: [{ name: "position", type: "Point" }],
      },
      {
        name: "applyEffect",
        type: "method",
        documentation: "Applies an effect by id for a duration; returns the created effect.",
        args: [
          { name: "effect", type: "string" },
          { name: "duration", type: "int" },
        ],
        returns: { type: "CreatureEffect" },
      },
      {
        name: "explicitlyApplyEffect",
        type: "method",
        documentation: "Applies an effect instance directly (no pipeline); returns it.",
        args: [{ name: "effect", type: "CreatureEffect" }],
        returns: { type: "CreatureEffect" },
      },
      {
        name: "removeEffect",
        type: "method",
        documentation: "Removes an effect instance from the creature.",
        args: [{ name: "effect", type: "CreatureEffect" }],
      },
      {
        name: "explicitlyRemoveEffect",
        type: "method",
        documentation: "Removes an effect instance directly (no pipeline).",
        args: [{ name: "effect", type: "CreatureEffect" }],
      },
      {
        name: "takeDamage",
        type: "method",
        documentation: "Takes damage of a type (runs the combat pipeline; handles death).",
        args: [
          { name: "amount", type: "double" },
          { name: "type", type: "DamageType" },
        ],
      },
      {
        name: "explicitlyTakeDamage",
        type: "method",
        documentation: "Takes damage directly (no pipeline).",
        args: [
          { name: "amount", type: "double" },
          { name: "type", type: "DamageType" },
        ],
      },
      {
        name: "takeHealing",
        type: "method",
        documentation: "Takes healing (runs the pipeline; handles over-heal).",
        args: [{ name: "amount", type: "double" }],
      },
      {
        name: "explicitlyTakeHealing",
        type: "method",
        documentation: "Takes healing directly (no pipeline).",
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
    name: "Item",
    type: "object",
    tags: ["items"],
    documentation:
      "An item. Supports dynamic extra properties (metatable index/newindex), so scripts may read/write custom fields beyond those below.",
    members: [
      { name: "id", type: "property", documentation: "The item id.", detail: "string" },
      { name: "name", type: "property", documentation: "The name of the item.", detail: "string" },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the item.",
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
      {
        name: "stackSize",
        type: "property",
        documentation: "The stack size of the item.",
        detail: "int",
      },
      { name: "value", type: "property", documentation: "The value of the item.", detail: "int" },
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
        documentation: "Overridable. Called when the item is used, with the target creature.",
        args: [{ name: "target", type: "BattleCreature" }],
      },
    ],
  },
  {
    name: "Charm",
    type: "object",
    documentation: "A charm that can be equipped on a creature to modify its stats.",
    members: [
      { name: "id", type: "property", documentation: "The charm id.", detail: "string" },
      { name: "name", type: "property", documentation: "The name of the charm.", detail: "string" },
      {
        name: "description",
        type: "property",
        documentation: "The description of the charm.",
        detail: "string",
      },
      {
        name: "stats",
        type: "property",
        documentation: "The stat modifiers of the charm.",
        detail: "CreatureStats",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite of the charm (read-only).",
        detail: "string",
      },
    ],
  },
  {
    name: "CreatureEffect",
    type: "object",
    tags: ["battle"],
    documentation:
      "An effect applied to a creature. Supports dynamic extra properties (metatable index/newindex). The engine invokes the overridable callbacks below at the matching moments.",
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
        documentation: "The remaining duration, in turns.",
        detail: "int",
      },
      {
        name: "caster",
        type: "property",
        documentation: "The creature that applied the effect.",
        detail: "BattleCreature",
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
    name: "ArenaEffect",
    type: "object",
    tags: ["battle"],
    documentation:
      "An effect placed on a tile of the battle arena. Construct with ArenaEffect.new(name, description, sprite, buff, duration). Supports dynamic extra properties.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The name of the effect.",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description of the effect.",
        detail: "string",
      },
      {
        name: "buff",
        type: "property",
        documentation: "The creature-effect id this tile applies (its 'buff').",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The tile sprite of the effect.",
        detail: "string",
      },
      {
        name: "duration",
        type: "property",
        documentation: "The duration, in turns.",
        detail: "int",
      },
      {
        name: "onSteppedOn",
        type: "callback",
        documentation:
          "Overridable. Called when a creature steps on the effect (receives the creature).",
      },
      {
        name: "onEffectApplied",
        type: "callback",
        documentation:
          "Overridable. Called when the effect is placed on a tile (receives the position).",
      },
      {
        name: "new",
        type: "function",
        documentation: "Constructs an ArenaEffect.",
        args: [
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "sprite", type: "string" },
          { name: "buff", type: "string" },
          { name: "duration", type: "int" },
        ],
        returns: { type: "ArenaEffect" },
      },
    ],
  },
  {
    name: "Ability",
    type: "object",
    tags: ["battle"],
    documentation: "A creature's ability definition.",
    members: [
      {
        name: "id",
        type: "property",
        documentation: "The ability id (read-only).",
        detail: "string",
      },
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
        documentation: "The targeting shape (an AbilityShape enum).",
        detail: "AbilityShape",
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
        documentation: "The max number of targets.",
        detail: "int",
      },
      { name: "range", type: "property", documentation: "The range.", detail: "int" },
      { name: "radius", type: "property", documentation: "The area radius.", detail: "int" },
      { name: "cost", type: "property", documentation: "The action-point cost.", detail: "int" },
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
        documentation:
          "Overridable convention. The engine calls this to produce the combat actions when the ability is cast.",
        args: [{ name: "combat", type: "Combat" }],
        returns: { type: "CombatAction[]" },
      },
    ],
  },
  {
    name: "AbilityData",
    type: "object",
    tags: ["battle"],
    documentation:
      "A read-only ability definition from the ability library (what GetAbilityLibrary returns). Same fields as Ability, all read-only.",
    members: [
      { name: "id", type: "property", documentation: "The ability id.", detail: "string" },
      { name: "name", type: "property", documentation: "The name.", detail: "string" },
      { name: "sprite", type: "property", documentation: "The sprite.", detail: "string" },
      {
        name: "description",
        type: "property",
        documentation: "The description.",
        detail: "string",
      },
      {
        name: "shape",
        type: "property",
        documentation: "The targeting shape (AbilityShape).",
        detail: "AbilityShape",
      },
      { name: "tags", type: "property", documentation: "The tags.", detail: "string[]" },
      { name: "maxTargets", type: "property", documentation: "The max targets.", detail: "int" },
      { name: "range", type: "property", documentation: "The range.", detail: "int" },
      { name: "radius", type: "property", documentation: "The area radius.", detail: "int" },
      { name: "cost", type: "property", documentation: "The cost.", detail: "int" },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether it has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Biogram",
    type: "object",
    documentation: "A biogram that can be socketed into an ability.",
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
        documentation:
          "Overridable convention. Transforms the combat actions produced by the ability it is socketed into.",
        args: [
          { name: "combat", type: "Combat" },
          { name: "actions", type: "CombatAction[]" },
        ],
        returns: { type: "CombatAction[]" },
      },
    ],
  },
  {
    name: "StoredBiogram",
    type: "object",
    documentation: "A biogram as stored/socketed on a creature.",
    members: [
      { name: "name", type: "property", documentation: "The name (read-only).", detail: "string" },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite (read-only).",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description (read-only).",
        detail: "string",
      },
      {
        name: "tags",
        type: "property",
        documentation: "The tags (read-only).",
        detail: "string[]",
      },
      {
        name: "owner",
        type: "property",
        documentation: "The owning creature (read-only).",
        detail: "Creature",
      },
      {
        name: "ability",
        type: "property",
        documentation: "The ability attack it is socketed into.",
        detail: "AbilityAttack",
      },
      {
        name: "biogram",
        type: "property",
        documentation: "The underlying biogram (read-only).",
        detail: "Biogram",
      },
      {
        name: "hasTag",
        type: "method",
        documentation: "Whether it has a certain tag.",
        args: [{ name: "tagName", type: "string" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "AbilityAttack",
    type: "object",
    tags: ["battle"],
    documentation: "An ability paired with its socketed biogram, as cast in combat.",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The ability name (read-only).",
        detail: "string",
      },
      {
        name: "fullName",
        type: "property",
        documentation: "The full name including the biogram (read-only).",
        detail: "string",
      },
      {
        name: "description",
        type: "property",
        documentation: "The description (read-only).",
        detail: "string",
      },
      {
        name: "sprite",
        type: "property",
        documentation: "The sprite (read-only).",
        detail: "string",
      },
      {
        name: "cost",
        type: "property",
        documentation: "The action-point cost (read-only).",
        detail: "double",
      },
      {
        name: "maxTargets",
        type: "property",
        documentation: "The max targets (read-only).",
        detail: "int",
      },
      { name: "range", type: "property", documentation: "The range (read-only).", detail: "int" },
      {
        name: "radius",
        type: "property",
        documentation: "The area radius (read-only).",
        detail: "int",
      },
      {
        name: "tags",
        type: "property",
        documentation: "The tags (read-only).",
        detail: "string[]",
      },
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
        documentation: "Whether the attack accepts the given biogram (StoredBiogram or Biogram).",
        args: [{ name: "biogram", type: "Biogram" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Inventory",
    type: "object",
    tags: ["items"],
    documentation: "The player's items and money. Obtained via GetBag().",
    members: [
      { name: "money", type: "property", documentation: "The player's money.", detail: "int" },
      {
        name: "premiumMoney",
        type: "property",
        documentation: "The player's premium currency.",
        detail: "int",
      },
      {
        name: "items",
        type: "property",
        documentation: "The items in the inventory (read-only).",
        detail: "Item[]",
      },
      {
        name: "swapItems",
        type: "method",
        documentation: "Swaps the items at two inventory indices.",
        args: [
          { name: "from", type: "int" },
          { name: "to", type: "int" },
        ],
      },
      {
        name: "addItem",
        type: "method",
        documentation: "Adds an item to the inventory. Returns false if full.",
        args: [{ name: "item", type: "Item" }],
        returns: { type: "bool" },
      },
      {
        name: "getItem",
        type: "method",
        documentation: "Retrieves the item at the given index.",
        args: [{ name: "index", type: "int" }],
        returns: { type: "Item" },
      },
    ],
  },
  {
    name: "Party",
    type: "object",
    documentation: "The player's active party of creatures. Obtained via GetParty().",
    members: [
      {
        name: "creatures",
        type: "property",
        documentation: "The creatures in the party.",
        detail: "Creature[]",
      },
      {
        name: "addCreature",
        type: "method",
        documentation: "Adds a creature to the party. Returns false if the party is full.",
        args: [{ name: "creature", type: "Creature" }],
        returns: { type: "bool" },
      },
      {
        name: "releaseCreature",
        type: "method",
        documentation: "Releases a creature from the party.",
        args: [{ name: "creature", type: "Creature" }],
        returns: { type: "bool" },
      },
      {
        name: "isFull",
        type: "method",
        documentation: "Whether the party is full.",
        returns: { type: "bool" },
      },
      {
        name: "swapCreatures",
        type: "method",
        documentation: "Swaps the creatures at two party indices.",
        args: [
          { name: "from", type: "int" },
          { name: "to", type: "int" },
        ],
      },
    ],
  },
  {
    name: "Player",
    type: "object",
    documentation: "The player. Obtained via GetPlayer().",
    members: [
      {
        name: "name",
        type: "property",
        documentation: "The player's name (read-only).",
        detail: "string",
      },
      { name: "x", type: "property", documentation: "The player's x position.", detail: "int" },
      { name: "y", type: "property", documentation: "The player's y position.", detail: "int" },
    ],
  },
  {
    name: "Area",
    type: "object",
    documentation: "A world or battle area. Obtained via GetArea() or BattleState.battlemap.",
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
        documentation: "Sets whether a tile is lit (also marks it explored).",
        args: [
          { name: "point", type: "Point" },
          { name: "isLit", type: "bool" },
        ],
      },
      {
        name: "isTileBlocked",
        type: "method",
        documentation: "Whether the tile at a location has collision (or is out of bounds).",
        args: [
          { name: "x", type: "int" },
          { name: "y", type: "int" },
        ],
        returns: { type: "bool" },
      },
      {
        name: "isTileBlocked",
        type: "method",
        documentation: "Whether the tile at a point has collision (or is out of bounds).",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Tile",
    type: "object",
    documentation: "A tile within an area (AreaTile).",
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
    name: "GlobalStore",
    type: "object",
    tags: ["utility"],
    documentation:
      "A persistent, save-backed key-value store, keyed by name. Read/write arbitrary fields directly (metatable index/newindex). Obtained via GetStore(name).",
    members: [],
  },
  {
    name: "LocalState",
    type: "object",
    tags: ["utility"],
    documentation:
      "A dynamic key-value bag for transient local state (metatable index/newindex) — read/write arbitrary fields directly.",
    members: [],
  },
  {
    name: "GameManager",
    type: "object",
    tags: ["utility"],
    documentation:
      "The game manager — creature/biogram/charm storage and party operations. Obtained via GetGameManager().",
    members: [
      {
        name: "creatureStorage",
        type: "property",
        documentation: "Boxed creatures (read-only).",
        detail: "Creature[]",
      },
      {
        name: "biogramStorage",
        type: "property",
        documentation: "Stored biograms (read-only).",
        detail: "Biogram[]",
      },
      {
        name: "charmStorage",
        type: "property",
        documentation: "Stored charms (read-only).",
        detail: "Charm[]",
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
        name: "swapPartyWithBoxed",
        type: "method",
        documentation: "Swaps a party creature with a boxed (storage) creature.",
        args: [
          { name: "partyIndex", type: "int" },
          { name: "boxIndex", type: "int" },
        ],
      },
      {
        name: "swapCreatures",
        type: "method",
        documentation:
          "Reorders two creatures in storage; bInsertBefore inserts A before B instead of swapping.",
        args: [
          { name: "a", type: "Creature" },
          { name: "b", type: "Creature" },
          { name: "insertBefore", type: "bool" },
        ],
      },
      {
        name: "swapCreatures",
        type: "method",
        documentation: "Swaps the creatures at two storage indices.",
        args: [
          { name: "a", type: "int" },
          { name: "b", type: "int" },
        ],
      },
      {
        name: "sendToStorage",
        type: "method",
        documentation: "Moves a creature to storage (accepts a Creature or a BattleCreature).",
        args: [{ name: "creature", type: "BattleCreature" }],
      },
      {
        name: "releaseCreature",
        type: "method",
        documentation: "Releases a creature (from party or storage).",
        args: [{ name: "creature", type: "Creature" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Journal",
    type: "object",
    documentation:
      "The player's Kittydex / journal of encountered creatures. Obtained via GetJournal().",
    members: [
      {
        name: "creatures",
        type: "property",
        documentation: "The creature entries.",
        detail: "CreatureEntry[]",
      },
      {
        name: "hasEntry",
        type: "method",
        documentation:
          'Whether the journal has an entry for a creature at a status ("DISCOVERED" | "CAUGHT" | "DEFEATED").',
        args: [
          { name: "creature", type: "Creature" },
          { name: "status", type: "string" },
        ],
        returns: { type: "bool" },
      },
      {
        name: "updateCreatureEntry",
        type: "method",
        documentation: "Records a creature in the journal at the given status.",
        args: [
          { name: "creature", type: "Creature" },
          { name: "status", type: "CreatureEntryStatus" },
        ],
      },
    ],
  },
  {
    name: "CreatureEntry",
    type: "object",
    documentation: "A single Journal entry for a creature species (all fields read-only).",
    members: [
      { name: "name", type: "property", documentation: "The species name.", detail: "string" },
      { name: "sprite", type: "property", documentation: "The species sprite.", detail: "string" },
      {
        name: "description",
        type: "property",
        documentation: "The species description.",
        detail: "string",
      },
      { name: "numSeen", type: "property", documentation: "Times seen.", detail: "int" },
      { name: "numCaught", type: "property", documentation: "Times caught.", detail: "int" },
      { name: "numDefeated", type: "property", documentation: "Times defeated.", detail: "int" },
      {
        name: "highestLevelSeen",
        type: "property",
        documentation: "Highest level seen.",
        detail: "int",
      },
      {
        name: "highestLevelCaught",
        type: "property",
        documentation: "Highest level caught.",
        detail: "int",
      },
      {
        name: "highestLevelDefeated",
        type: "property",
        documentation: "Highest level defeated.",
        detail: "int",
      },
      {
        name: "stats",
        type: "property",
        documentation: "The species base stats.",
        detail: "CreatureStats",
      },
      {
        name: "baseAbilities",
        type: "property",
        documentation: "The species base abilities.",
        detail: "Ability[]",
      },
      {
        name: "minLevel",
        type: "property",
        documentation: "The species minimum spawn level.",
        detail: "int",
      },
      {
        name: "maxLevel",
        type: "property",
        documentation: "The species maximum spawn level.",
        detail: "int",
      },
      {
        name: "rarity",
        type: "property",
        documentation: "The species rarity name.",
        detail: "string",
      },
      {
        name: "biomes",
        type: "property",
        documentation: "The biomes the species spawns in.",
        detail: "string[]",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Battle state & combat. Ground truth: ScriptLibraryBattleManager.h,
// BattleState.h, CombatTypes.h.
// ---------------------------------------------------------------------------

const battleTypes = (): ApiItem[] => [
  {
    name: "BattleState",
    type: "object",
    tags: ["battle"],
    documentation: "The current battle. Obtained via GetBattleState() (nil outside battle).",
    members: [
      { name: "battlemap", type: "property", documentation: "The battle arena.", detail: "Area" },
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
        documentation: "The player-selected targets (read-only).",
        detail: "BattleCreature[]",
      },
      {
        name: "highlightedPath",
        type: "property",
        documentation: "The currently highlighted movement path.",
        detail: "Point[]",
      },
      {
        name: "heldAttack",
        type: "property",
        documentation: "The attack the player is currently holding.",
        detail: "AbilityAttack",
      },
      {
        name: "heldItem",
        type: "property",
        documentation: "The item the player is currently holding (read/write).",
        detail: "Item",
      },
      {
        name: "getBattleOrder",
        type: "method",
        documentation: "The turn order of the battle.",
        returns: { type: "BattleCreature[]" },
      },
      {
        name: "isFriendly",
        type: "method",
        documentation: "Whether the creature is friendly to the active creature.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
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
        name: "isCreatureVisible",
        type: "method",
        documentation: "Whether the creature is visible.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
      },
      {
        name: "findCreatures",
        type: "method",
        documentation: "Search for creatures within a sphere.",
        args: [{ name: "shape", type: "Sphere" }],
        returns: { type: "BattleCreature[]" },
      },
      {
        name: "getCatchGuardRating",
        type: "method",
        documentation: "The catch guard rating of a creature.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "int" },
      },
      {
        name: "resolveCombat",
        type: "method",
        documentation: "Resolves a full combat engagement for a cast.",
        args: [
          { name: "caster", type: "BattleCreature" },
          { name: "castingLocation", type: "Point" },
          { name: "targets", type: "BattleCreature[]" },
          { name: "attack", type: "AbilityAttack" },
        ],
      },
      {
        name: "isSelected",
        type: "method",
        documentation: "Whether the creature is currently a selected target.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
      },
      {
        name: "toggleTargetSelected",
        type: "method",
        documentation:
          "Adds/removes a creature from the selected targets. Returns the new selected state.",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "bool" },
      },
      {
        name: "popLastTarget",
        type: "method",
        documentation: "Removes the most recently selected target.",
      },
      { name: "clearTargets", type: "method", documentation: "Clears all selected targets." },
      {
        name: "setHighlightedPath",
        type: "method",
        documentation: "Sets the highlighted movement path (only while in the move state).",
        args: [{ name: "path", type: "Point[]" }],
      },
      {
        name: "setCreatureCaught",
        type: "method",
        documentation:
          "Marks a creature as caught: removes it from battle and records it in the Journal.",
        args: [{ name: "creature", type: "BattleCreature" }],
      },
      {
        name: "getCreaturesByDistance",
        type: "method",
        documentation: "Creatures ordered by distance from a position, filtered by friendly/enemy.",
        args: [
          { name: "position", type: "Point" },
          { name: "includeFriendly", type: "bool" },
          { name: "includeEnemy", type: "bool" },
        ],
        returns: { type: "BattleCreature[]" },
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
      },
      {
        name: "getCreatureAt",
        type: "method",
        documentation: "The creature at a specific point, if any.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "BattleCreature" },
      },
      {
        name: "isCreaturePresent",
        type: "method",
        documentation: "Whether a creature exists at a point.",
        args: [{ name: "point", type: "Point" }],
        returns: { type: "bool" },
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
      },
      {
        name: "createEntity",
        type: "method",
        documentation:
          "Creates a battle entity from a props table. Recognized keys: name, sprite, description, position (Point), caster (BattleCreature — the owner), script (string).",
        args: [{ name: "props", type: "table" }],
      },
      {
        name: "getRewards",
        type: "method",
        documentation: "The battle rewards (only once the battle is won; otherwise nil).",
        returns: { type: "BattleRewards" },
      },
    ],
  },
  {
    name: "Combat",
    type: "object",
    tags: ["battle"],
    documentation:
      "A combat engagement — the context passed to an ability's enact. Construct with Combat.new(caster, castingLocation, targets, attack).",
    members: [
      {
        name: "caster",
        type: "property",
        documentation: "The creature casting in this engagement.",
        detail: "BattleCreature",
      },
      {
        name: "castingLocation",
        type: "property",
        documentation: "The location the caster is casting at.",
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
        name: "new",
        type: "function",
        documentation: "Constructs a Combat engagement.",
        args: [
          { name: "caster", type: "BattleCreature" },
          { name: "castingLocation", type: "Point" },
          { name: "targets", type: "BattleCreature[]" },
          { name: "attack", type: "AbilityAttack" },
        ],
        returns: { type: "Combat" },
      },
      {
        name: "addAction",
        type: "method",
        documentation: "Adds a combat action (a CombatAction-shaped table) to the engagement.",
        args: [{ name: "action", type: "CombatAction" }],
      },
      {
        name: "addSpriteAnimation",
        type: "method",
        documentation: "Adds a sprite animation at a position.",
        args: [
          { name: "position", type: "Point" },
          { name: "sprite", type: "string" },
        ],
      },
      {
        name: "addArenaEffect",
        type: "method",
        documentation: "Adds an arena effect over a shape.",
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
        documentation:
          "Adds a battle entity from a props table (same keys as BattleState:createEntity).",
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
    name: "LevelUpDetails",
    type: "object",
    tags: ["battle"],
    documentation: "Details of a creature leveling up (part of BattleRewards).",
    members: [
      { name: "creature", type: "property", documentation: "The creature.", detail: "Creature" },
      {
        name: "leveledUp",
        type: "property",
        documentation: "Whether it actually leveled up.",
        detail: "bool",
      },
      { name: "xpGained", type: "property", documentation: "The XP gained.", detail: "double" },
      {
        name: "statChanges",
        type: "property",
        documentation: "The per-stat changes.",
        detail: "CreatureStats",
      },
      {
        name: "learnedAttacks",
        type: "property",
        documentation: "Attacks learned on level up.",
        detail: "AbilityAttack[]",
      },
      {
        name: "pendingAttacks",
        type: "property",
        documentation: "Attacks pending selection.",
        detail: "AbilityAttack[]",
      },
    ],
  },
  {
    name: "BattleRewards",
    type: "object",
    tags: ["battle"],
    documentation: "The rewards from a won battle. Obtained via BattleState:getRewards().",
    members: [
      { name: "money", type: "property", documentation: "Money awarded.", detail: "int" },
      { name: "items", type: "property", documentation: "Items awarded.", detail: "Item[]" },
      {
        name: "levelUps",
        type: "property",
        documentation: "Per-creature level-up details.",
        detail: "LevelUpDetails[]",
      },
      {
        name: "getXPForCreature",
        type: "method",
        documentation: "The XP awarded to a specific creature (-1 if none).",
        args: [{ name: "creature", type: "BattleCreature" }],
        returns: { type: "double" },
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
        documentation: "Uses an item outside of combat on a creature.",
        args: [
          { name: "item", type: "Item" },
          { name: "creature", type: "Creature" },
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
        documentation: "Sockets a biogram into an ability (accepts a StoredBiogram or Biogram).",
        args: [
          { name: "creature", type: "Creature" },
          { name: "attack", type: "AbilityAttack" },
          { name: "biogram", type: "StoredBiogram" },
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
        documentation: "Buys an item from the shop at a cost.",
        args: [
          { name: "item", type: "Item" },
          { name: "cost", type: "int" },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// GUI runtime. Ground truth: LGUI.h (legacy imperative GUI: GUI/Widget/Text)
// and XGUI.cpp (the XGUI runtime: View/Element and CreateScreen/CloseScreen).
// ---------------------------------------------------------------------------

const guiTypes = (): ApiItem[] => [
  {
    name: "GUI",
    type: "object",
    tags: ["gui"],
    documentation: "The legacy (LGUI) imperative GUI root. Obtained via CreateGUI().",
    members: [
      {
        name: "createPanel",
        type: "method",
        documentation:
          "Creates a Panel widget from a props table (parent, name, position, size, texture, color, backgroundColor, borderColor, …).",
        args: [{ name: "props", type: "table" }],
        returns: { type: "Widget" },
      },
      {
        name: "createText",
        type: "method",
        documentation:
          "Creates a Text widget from a props table (parent, position, size, text, fontSize, textAlign, color, …).",
        args: [{ name: "props", type: "table" }],
        returns: { type: "Text" },
      },
      { name: "close", type: "method", documentation: "Closes the GUI." },
      {
        name: "setTimeout",
        type: "method",
        documentation: "Runs a callback after a delay (milliseconds).",
        args: [
          { name: "delayMillis", type: "int" },
          { name: "callback", type: "function" },
        ],
      },
    ],
  },
  {
    name: "Widget",
    type: "object",
    tags: ["gui"],
    documentation:
      "An LGUI panel widget. Supports dynamic extra properties (metatable index/newindex) so scripts can attach fields. Position/size use the 4-tuple {relX, relY, absX, absY} form.",
    members: [
      {
        name: "setParent",
        type: "method",
        documentation: "Reparents the widget (also adds it as a child of the parent).",
        args: [{ name: "parent", type: "Widget" }],
      },
      {
        name: "setPosition",
        type: "method",
        documentation: "Sets the position (relX, relY, absX, absY).",
        args: [
          { name: "relX", type: "double" },
          { name: "relY", type: "double" },
          { name: "absX", type: "int" },
          { name: "absY", type: "int" },
        ],
      },
      {
        name: "setSize",
        type: "method",
        documentation: "Sets the size (relW, relH, absW, absH).",
        args: [
          { name: "relW", type: "double" },
          { name: "relH", type: "double" },
          { name: "absW", type: "int" },
          { name: "absH", type: "int" },
        ],
      },
      {
        name: "setPadding",
        type: "method",
        documentation: "Sets padding.",
        args: [{ name: "padding", type: "int" }],
      },
      {
        name: "setTexture",
        type: "method",
        documentation: "Sets the background texture.",
        args: [{ name: "texture", type: "string" }],
      },
      {
        name: "setTrim",
        type: "method",
        documentation: "Sets the widget trim.",
        args: [{ name: "trim", type: "WidgetTrim" }],
      },
      {
        name: "setColor",
        type: "method",
        documentation: "Sets the foreground color.",
        args: [{ name: "color", type: "Color" }],
      },
      {
        name: "setBackgroundColor",
        type: "method",
        documentation: "Sets the background color.",
        args: [{ name: "color", type: "Color" }],
      },
      {
        name: "setBorderColor",
        type: "method",
        documentation: "Sets the border color.",
        args: [{ name: "color", type: "Color" }],
      },
      {
        name: "setBorderSize",
        type: "method",
        documentation: "Sets the border size.",
        args: [{ name: "size", type: "int" }],
      },
      {
        name: "registerEvent",
        type: "method",
        documentation:
          'Registers an event handler (e.g. "OnMouseClicked", "OnMouseEntered", "OnMouseExited").',
        args: [
          { name: "event", type: "string" },
          { name: "callback", type: "function" },
        ],
      },
      {
        name: "isVisible",
        type: "method",
        documentation: "Whether the widget is visible.",
        returns: { type: "bool" },
      },
      { name: "show", type: "method", documentation: "Shows the widget." },
      { name: "hide", type: "method", documentation: "Hides the widget." },
      { name: "toggle", type: "method", documentation: "Toggles visibility." },
    ],
  },
  {
    name: "Text",
    type: "object",
    tags: ["gui"],
    documentation: "An LGUI text widget. Has all Widget members plus the text-specific ones below.",
    members: [
      {
        name: "setText",
        type: "method",
        documentation: "Sets the text (accepts a string, int, or number).",
        args: [{ name: "text", type: "string" }],
      },
      {
        name: "setFontSize",
        type: "method",
        documentation: "Sets the font size.",
        args: [{ name: "size", type: "int" }],
      },
      {
        name: "setTextAlign",
        type: "method",
        documentation: "Sets the text alignment.",
        args: [{ name: "align", type: "TextAlignment" }],
      },
    ],
  },
  {
    name: "WidgetTrim",
    type: "object",
    tags: ["gui"],
    documentation:
      "A reusable widget trim. Construct with WidgetTrim.new(borderSize, color, backgroundColor, borderColor).",
    members: [
      { name: "borderSize", type: "property", documentation: "The border size.", detail: "int" },
      { name: "color", type: "property", documentation: "The foreground color.", detail: "Color" },
      {
        name: "backgroundColor",
        type: "property",
        documentation: "The background color.",
        detail: "Color",
      },
      {
        name: "borderColor",
        type: "property",
        documentation: "The border color.",
        detail: "Color",
      },
      {
        name: "new",
        type: "function",
        documentation: "Constructs a WidgetTrim.",
        args: [
          { name: "borderSize", type: "int" },
          { name: "color", type: "Color" },
          { name: "backgroundColor", type: "Color" },
          { name: "borderColor", type: "Color" },
        ],
        returns: { type: "WidgetTrim" },
      },
    ],
  },
  {
    name: "View",
    type: "object",
    tags: ["xgui", "gui"],
    documentation:
      "The XGUI runtime view handle passed to a component controller (the `view` argument). Drives the component's data model, scopes, and per-view state.",
    members: [
      {
        name: "setModel",
        type: "method",
        documentation: "Replaces the view's data model.",
        args: [{ name: "model", type: "table" }],
      },
      {
        name: "getModel",
        type: "method",
        documentation: "Returns the view's data model.",
        returns: { type: "table" },
      },
      {
        name: "getScope",
        type: "method",
        documentation: "Returns the model table published under a named scope (or nil).",
        args: [{ name: "scopeName", type: "string" }],
        returns: { type: "table" },
      },
      {
        name: "getState",
        type: "method",
        documentation: "Returns the view's mutable state table.",
        returns: { type: "table" },
      },
      {
        name: "setState",
        type: "method",
        documentation: "Shallow-merges the given overrides into the view state.",
        args: [{ name: "overrides", type: "table" }],
      },
      {
        name: "broadcast",
        type: "method",
        documentation: "Broadcasts an event on the view.",
        args: [{ name: "topic", type: "string" }],
      },
    ],
  },
  {
    name: "Element",
    type: "object",
    tags: ["xgui", "gui"],
    documentation:
      "A handle to a single element within an XGUI component, retrieved by the controller.",
    members: [
      {
        name: "data",
        type: "property",
        documentation: "The element's bound model slice (read-only).",
        detail: "table",
      },
      {
        name: "setVisible",
        type: "method",
        documentation: "Shows/hides the element.",
        args: [{ name: "visible", type: "bool" }],
      },
      {
        name: "setText",
        type: "method",
        documentation: "Sets the element's text.",
        args: [{ name: "text", type: "string" }],
      },
      {
        name: "setTexture",
        type: "method",
        documentation: "Sets the element's texture.",
        args: [{ name: "texture", type: "string" }],
      },
      {
        name: "setBackgroundColor",
        type: "method",
        documentation: "Sets the background color.",
        args: [{ name: "color", type: "Color" }],
      },
      {
        name: "setBorderColor",
        type: "method",
        documentation: "Sets the border color.",
        args: [{ name: "color", type: "Color" }],
      },
      {
        name: "setColor",
        type: "method",
        documentation: "Sets the foreground color.",
        args: [{ name: "color", type: "Color" }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Input, rendering, timers, and RNG props. Ground truth: ScriptLibraryInput.h,
// ScriptLibraryRenderer.h, ScriptLibraryDirector.h, ScriptLibraryRng.h.
// ---------------------------------------------------------------------------

const systemTypes = (): ApiItem[] => [
  {
    name: "Input",
    type: "object",
    tags: ["input"],
    documentation: "The input state, for polling key bindings.",
    members: [
      {
        name: "isPressed",
        type: "method",
        documentation: "Whether the binding was pressed this frame.",
        args: [{ name: "binding", type: "Key" }],
        returns: { type: "bool" },
      },
      {
        name: "isDown",
        type: "method",
        documentation: "Whether the binding is currently held down.",
        args: [{ name: "binding", type: "Key" }],
        returns: { type: "bool" },
      },
      {
        name: "isUp",
        type: "method",
        documentation: "Whether the binding was released this frame.",
        args: [{ name: "binding", type: "Key" }],
        returns: { type: "bool" },
      },
    ],
  },
  {
    name: "Renderer",
    type: "object",
    tags: ["gui"],
    documentation: "Low-level renderer passed to custom render hooks (scene scripts).",
    members: [
      {
        name: "width",
        type: "property",
        documentation: "The render target width (read-only).",
        detail: "int",
      },
      {
        name: "text",
        type: "method",
        documentation: "Draws text at (x, y), optionally with a color.",
        args: [
          { name: "text", type: "string" },
          { name: "x", type: "int" },
          { name: "y", type: "int" },
          { name: "color", type: "FColor" },
        ],
      },
      {
        name: "box",
        type: "method",
        documentation: "Draws a box (filled or outline).",
        args: [
          { name: "box", type: "Box" },
          { name: "color", type: "FColor" },
          { name: "fill", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "FColor",
    type: "object",
    tags: ["gui"],
    documentation: "An RGBA color for the Renderer. Construct with FColor.new(r, g, b, a).",
    members: [
      { name: "r", type: "property", documentation: "Red (0-255).", detail: "int" },
      { name: "g", type: "property", documentation: "Green (0-255).", detail: "int" },
      { name: "b", type: "property", documentation: "Blue (0-255).", detail: "int" },
      { name: "a", type: "property", documentation: "Alpha (0-255).", detail: "int" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs an FColor.",
        args: [
          { name: "r", type: "int" },
          { name: "g", type: "int" },
          { name: "b", type: "int" },
          { name: "a", type: "int" },
        ],
        returns: { type: "FColor" },
      },
    ],
  },
  {
    name: "Box",
    type: "object",
    tags: ["gui"],
    documentation: "A rectangle for the Renderer. Construct with Box.new(x, y, w, h).",
    members: [
      { name: "x", type: "property", documentation: "Left.", detail: "int" },
      { name: "y", type: "property", documentation: "Top.", detail: "int" },
      { name: "w", type: "property", documentation: "Width.", detail: "int" },
      { name: "h", type: "property", documentation: "Height.", detail: "int" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs a Box.",
        args: [
          { name: "x", type: "int" },
          { name: "y", type: "int" },
          { name: "w", type: "int" },
          { name: "h", type: "int" },
        ],
        returns: { type: "Box" },
      },
    ],
  },
  {
    name: "TimerHandle",
    type: "object",
    tags: ["utility"],
    documentation: "A handle to a running timer, returned by CreateTimer.",
    members: [{ name: "cancel", type: "method", documentation: "Cancels the timer." }],
  },
  {
    name: "RandomCreatureProps",
    type: "object",
    documentation:
      "Props for RNG.GetRandomCreature. Construct with RandomCreatureProps.new(minLevel, maxLevel, biome).",
    members: [
      { name: "minLevel", type: "property", documentation: "Minimum level.", detail: "int" },
      { name: "maxLevel", type: "property", documentation: "Maximum level.", detail: "int" },
      { name: "biome", type: "property", documentation: "The biome.", detail: "Biome" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs RandomCreatureProps.",
        args: [
          { name: "minLevel", type: "int" },
          { name: "maxLevel", type: "int" },
          { name: "biome", type: "Biome" },
        ],
        returns: { type: "RandomCreatureProps" },
      },
    ],
  },
  {
    name: "RandomItemProps",
    type: "object",
    tags: ["items"],
    documentation:
      "Props for RNG.GetRandomItem. Construct with RandomItemProps.new(minLevel, maxLevel, biome).",
    members: [
      { name: "minLevel", type: "property", documentation: "Minimum level.", detail: "int" },
      { name: "maxLevel", type: "property", documentation: "Maximum level.", detail: "int" },
      { name: "biome", type: "property", documentation: "The biome.", detail: "Biome" },
      {
        name: "new",
        type: "function",
        documentation: "Constructs RandomItemProps.",
        args: [
          { name: "minLevel", type: "int" },
          { name: "maxLevel", type: "int" },
          { name: "biome", type: "Biome" },
        ],
        returns: { type: "RandomItemProps" },
      },
    ],
  },
  {
    name: "BattleGameModeProps",
    type: "object",
    tags: ["battle"],
    documentation:
      "Props for SetGameMode(GameMode.BATTLE_SCENE, ...). Construct with BattleGameModeProps.new(opponents).",
    members: [
      {
        name: "new",
        type: "function",
        documentation: "Constructs BattleGameModeProps from a list of opponent creatures.",
        args: [{ name: "opponents", type: "Creature[]" }],
        returns: { type: "BattleGameModeProps" },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Global functions & library tables. Ground truth: the set_function / lua[...]
// registrations across ScriptLibraryGameManager.h, ScriptLibraryBattleManager.h,
// ScriptLibraryDirector.h, ScriptLibraryAlerts.h, ScriptLibraryAssets.h,
// ScriptLibraryAnim8.h, ScriptLibraryRng.h, ScriptLibraryAlgorithms.h,
// ScriptLibraryInput.h, LGUI.h, XGUI.cpp — plus the Lua preludes.
// ---------------------------------------------------------------------------

const globals = (): ApiItem[] => [
  // --- World / game manager ---
  {
    name: "GetBag",
    type: "function",
    tags: ["items"],
    documentation: "Returns the player's bag (inventory).",
    returns: { type: "Inventory" },
    insertText: "local ${1:bag} = GetBag()",
    detail: "Inventory",
  },
  {
    name: "GetParty",
    type: "function",
    documentation: "Returns the player's active party.",
    returns: { type: "Party" },
    insertText: "local ${1:party} = GetParty()",
    detail: "Party",
  },
  {
    name: "GetArea",
    type: "function",
    documentation: "Returns the current world area.",
    returns: { type: "Area" },
    insertText: "local ${1:area} = GetArea()",
    detail: "Area",
  },
  {
    name: "GetStore",
    type: "function",
    tags: ["utility"],
    documentation: "Returns a persistent, save-backed key-value store for the given name.",
    args: [{ name: "storeName", type: "string" }],
    returns: { type: "GlobalStore" },
    insertText: 'local ${1:store} = GetStore("${2:name}")',
    detail: "GlobalStore",
    examples: [
      {
        title: "Persist a flag",
        code: 'local playerStore = GetStore("player")\nplayerStore.hasUnlockedTorch = true\n',
      },
    ],
  },
  {
    name: "GetGameManager",
    type: "function",
    tags: ["utility"],
    documentation: "Returns the game manager (creature/biogram/charm storage and party ops).",
    returns: { type: "GameManager" },
    insertText: "local ${1:gm} = GetGameManager()",
    detail: "GameManager",
  },
  {
    name: "GetPlayer",
    type: "function",
    documentation: "Returns the player.",
    returns: { type: "Player" },
  },
  {
    name: "GetJournal",
    type: "function",
    documentation: "Returns the player's journal (Kittydex), which tracks encountered creatures.",
    returns: { type: "Journal" },
  },
  {
    name: "GetController",
    type: "function",
    documentation: "Returns the player controller (protected game interactions).",
    returns: { type: "PlayerController" },
  },
  {
    name: "GetAbilityLibrary",
    type: "function",
    documentation: "Returns the ability library the player can train new abilities from.",
    returns: { type: "AbilityData[]" },
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
    documentation: "Returns a fresh item instance for the given id.",
    args: [{ name: "id", type: "string" }],
    returns: { type: "Item" },
  },
  {
    name: "CreateItem",
    type: "function",
    tags: ["items"],
    documentation: "Creates a fresh item instance for the given id (same as GetItemById).",
    args: [{ name: "itemId", type: "string" }],
    returns: { type: "Item" },
  },
  {
    name: "SaveGame",
    type: "function",
    documentation: "Attempts to save the game. Throws during combat (you cannot save mid-battle).",
  },
  // --- Battle ---
  {
    name: "GetBattleState",
    type: "function",
    tags: ["battle"],
    documentation: "Returns the current battle state, or nil if not in a battle.",
    returns: { type: "BattleState" },
    insertText: "local ${1:battle} = GetBattleState()",
    detail: "BattleState",
  },
  {
    name: "IsPlayerOwned",
    type: "function",
    tags: ["battle"],
    documentation: "Whether the creature is owned by the player.",
    args: [{ name: "creature", type: "BattleCreature" }],
    returns: { type: "bool" },
  },
  {
    name: "GetNearestEnemy",
    type: "function",
    tags: ["battle"],
    documentation:
      "Returns the nearest enemy to the active creature and its distance (two return values). Lua-prelude helper (__libcombat.lua).",
    returns: { type: "BattleCreature" },
  },
  {
    name: "GetNearestFriendly",
    type: "function",
    tags: ["battle"],
    documentation:
      "Returns the nearest friendly to the active creature and its distance (two return values). Lua-prelude helper (__libcombat.lua).",
    returns: { type: "BattleCreature" },
  },
  {
    name: "AnimateAbilitySprite",
    type: "function",
    tags: ["battle"],
    documentation: "Plays a floating ability sprite animation at a battle position.",
    args: [
      { name: "sprite", type: "string" },
      { name: "position", type: "Point" },
    ],
  },
  {
    name: "ExitBattle",
    type: "function",
    tags: ["battle"],
    documentation: "Tears down the battle scene (only valid once the battle is won).",
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
        documentation: "Writes a battle log / combat notification.",
        args: [{ name: "message", type: "string" }],
      },
    ],
  },
  // --- Messaging / director ---
  {
    name: "Broadcast",
    type: "function",
    tags: ["utility"],
    documentation:
      "Broadcasts a message on a topic with up to 6 arguments (global form of MessageBroker.Broadcast).",
    args: [{ name: "topic", type: "string" }],
  },
  {
    name: "MessageBroker",
    type: "library",
    tags: ["utility"],
    documentation: "The pub/sub message bus.",
    members: [
      {
        name: "Subscribe",
        type: "function",
        documentation:
          "Subscribes a callback to a topic. Returns a Subscription (keep a reference to stay subscribed).",
        args: [
          { name: "topic", type: "string" },
          { name: "callback", type: "function" },
        ],
        returns: { type: "Subscription" },
      },
      {
        name: "Broadcast",
        type: "function",
        documentation: "Broadcasts a message on a topic with up to 6 arguments.",
        args: [{ name: "topic", type: "string" }],
      },
    ],
  },
  {
    name: "CreateTimer",
    type: "function",
    tags: ["utility"],
    documentation: "Runs a callback after a delay (seconds). Returns a handle you can cancel.",
    args: [
      { name: "delay", type: "float" },
      { name: "callback", type: "function" },
    ],
    returns: { type: "TimerHandle" },
  },
  {
    name: "OpenWindow",
    type: "function",
    tags: ["gui"],
    documentation: "Opens a scene/window from a script, optionally passing a props table.",
    args: [
      { name: "scriptName", type: "string" },
      { name: "props", type: "table" },
    ],
  },
  {
    name: "SetGameMode",
    type: "function",
    documentation:
      "Switches the top-level game mode. For BATTLE_SCENE, pass BattleGameModeProps; for TITLE_SCENE / SAVE_SELECTOR_SCENE, pass the mode alone.",
    args: [
      { name: "mode", type: "GameMode" },
      { name: "props", type: "BattleGameModeProps" },
    ],
  },
  {
    name: "Npc",
    type: "library",
    documentation: "NPC / world interaction helpers (dialog and shops).",
    members: [
      {
        name: "CloseDialog",
        type: "function",
        documentation: "Closes the current dialog and returns to movement.",
      },
      {
        name: "StartDialog",
        type: "function",
        documentation: "Starts a dialog from a dialog-tree table.",
        args: [{ name: "dialogTree", type: "table" }],
      },
      {
        name: "OpenShopWindow",
        type: "function",
        documentation:
          "Opens a shop window from a stock file, with a shopkeeper name and optional greeting.",
        args: [
          { name: "stockfile", type: "string" },
          { name: "shopkeeperName", type: "string" },
          { name: "greeting", type: "string" },
        ],
      },
    ],
  },
  // --- RNG ---
  {
    name: "RNG",
    type: "library",
    documentation: "Random content generation.",
    members: [
      {
        name: "GetRandomCreature",
        type: "function",
        documentation: "Returns a random creature for the given props.",
        args: [{ name: "props", type: "RandomCreatureProps" }],
        returns: { type: "Creature" },
      },
      {
        name: "GetRandomItem",
        type: "function",
        tags: ["items"],
        documentation: "Returns a random item for the given props.",
        args: [{ name: "props", type: "RandomItemProps" }],
        returns: { type: "Item" },
      },
    ],
  },
  // --- Pathfinding ---
  {
    name: "FindPathAStar",
    type: "function",
    tags: ["battle"],
    documentation: "A* pathfinding across an area between two points (empty if unreachable).",
    args: [
      { name: "area", type: "Area" },
      { name: "start", type: "Point" },
      { name: "end", type: "Point" },
    ],
    returns: { type: "Point[]" },
  },
  {
    name: "FindPathLinear",
    type: "function",
    tags: ["battle"],
    documentation: "Straight-line (Bresenham) path between two points.",
    args: [
      { name: "area", type: "Area" },
      { name: "start", type: "Point" },
      { name: "end", type: "Point" },
    ],
    returns: { type: "Point[]" },
  },
  // --- Alerts / toasts ---
  {
    name: "Alert",
    type: "library",
    documentation: "In-game toasts and info dialogs.",
    members: [
      {
        name: "ToastInfo",
        type: "function",
        documentation: "Shows an info toast.",
        args: [{ name: "message", type: "string" }],
      },
      {
        name: "ToastSuccess",
        type: "function",
        documentation: "Shows a success toast.",
        args: [{ name: "message", type: "string" }],
      },
      {
        name: "ToastError",
        type: "function",
        documentation: "Shows an error toast.",
        args: [{ name: "message", type: "string" }],
      },
      {
        name: "DisplayInfo",
        type: "function",
        documentation: "Shows a titled info dialog.",
        args: [
          { name: "title", type: "string" },
          { name: "message", type: "string" },
        ],
      },
    ],
  },
  // --- Assets / scripts / cursor ---
  {
    name: "GetAssetFilepath",
    type: "function",
    tags: ["utility"],
    documentation: "Resolves a logical asset name to its on-disk filepath.",
    args: [{ name: "assetName", type: "string" }],
    returns: { type: "string" },
  },
  {
    name: "LoadScript",
    type: "function",
    tags: ["utility"],
    documentation: "Loads and runs another script by name, returning its result.",
    args: [{ name: "scriptName", type: "string" }],
  },
  {
    name: "SetCursor",
    type: "function",
    tags: ["gui"],
    documentation: "Sets the mouse cursor from an image asset.",
    args: [{ name: "assetName", type: "string" }],
  },
  // --- Animation ---
  {
    name: "Anim8",
    type: "library",
    documentation: "Animation helpers.",
    members: [
      {
        name: "OneShot",
        type: "function",
        documentation:
          'Plays a one-shot animation from a props table (e.g. {animation="sprite_linear_up", sprite=..., startPosition=Point, size=Point, duration=...}).',
        args: [{ name: "props", type: "table" }],
      },
      { name: "Loop", type: "function", documentation: "Plays a looping animation (reserved)." },
    ],
  },
  // --- Input ---
  {
    name: "IsGamepadConnected",
    type: "function",
    tags: ["input"],
    documentation: "Whether a gamepad is connected.",
    returns: { type: "bool" },
  },
  // --- GUI construction ---
  {
    name: "CreateGUI",
    type: "function",
    tags: ["gui"],
    documentation: "Creates a new legacy (LGUI) imperative GUI.",
    returns: { type: "GUI" },
  },
  {
    name: "CreateScreen",
    type: "function",
    tags: ["xgui", "gui"],
    documentation:
      "Opens an XGUI component as a screen, optionally passing a props table to its root model.",
    args: [
      { name: "scriptName", type: "string" },
      { name: "props", type: "table" },
    ],
  },
  {
    name: "CloseScreen",
    type: "function",
    tags: ["xgui", "gui"],
    documentation: "Tears down the current screen/scene.",
  },
];

// ---------------------------------------------------------------------------
// `self` — the script's own object
//
// Inside a creature/ability/item/effect/biogram script, `self` is the object
// being scripted (a LuaObject whose fields are the bound type's members). The
// members vary by entity kind; each is tagged with the kind(s) it applies to.
// ---------------------------------------------------------------------------

const selfApi = (): ApiItem => ({
  name: "self",
  type: "namespace",
  documentation:
    "The object this script belongs to. Available members depend on the entity kind (ability, item, effect, biogram). See the matching type (Ability / Item / CreatureEffect / Biogram) for the full member list.",
  members: [
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
      detail: "string",
      tags: ["ability", "item", "effect", "biogram"],
    },
    {
      name: "description",
      type: "property",
      documentation: "The description.",
      detail: "string",
      tags: ["ability", "item", "effect", "biogram"],
    },
    {
      name: "shape",
      type: "property",
      documentation: "The targeting shape (ability scripts).",
      detail: "AbilityShape",
      tags: ["ability"],
    },
    {
      name: "cost",
      type: "property",
      documentation: "The action-point cost (ability scripts).",
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
      documentation: "The area radius (ability scripts).",
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
    {
      name: "tags",
      type: "property",
      documentation: "The tags.",
      detail: "string[]",
      tags: ["ability", "biogram", "effect"],
    },
    {
      name: "hasTag",
      type: "method",
      documentation: "Whether the tag is present.",
      args: [{ name: "tag", type: "string" }],
      returns: { type: "bool" },
      insertText: "local ${1:hasTag} = self:hasTag(${2:tag})",
      detail: "bool",
      tags: ["ability", "biogram", "effect", "item"],
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
// the engine (see src/lib/guiInteraction.ts, which cites the engine file:line).
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
            "A tooltip component's root must be PIXEL-SIZED (absolute size, relative width/height zero) — a relative root size won't lay out predictably.",
        },
        {
          name: "no controller",
          type: "property",
          documentation:
            "v1 tooltip components are presentation-only — no controller runs. A tooltip that declares a controller is flagged by the editor's lints.",
        },
        {
          name: "preview peek (hold Alt)",
          type: "property",
          documentation:
            "In the GUI editor preview, tooltips are hidden while you author. Hold Alt (Option on macOS) and hover a widget with a tooltip to peek its card; release Alt to hide it. Pressing Alt while already resting on a widget shows the card without moving the mouse.",
        },
      ],
    },
  ],
});

/**
 * The merged Lua API tree — the single source of truth.
 *
 * Order is reference-pane-friendly: language first, then enums and types, then
 * the globals you actually call, the contextual `self` object, and finally the
 * XGUI interaction reference (GUI editor knowledge, not a Lua global).
 */
export const GAME_API: ApiItem[] = [
  luaKeywords(),
  ...luaStdlib(),
  ...enums(),
  ...coreTypes(),
  ...gameTypes(),
  ...battleTypes(),
  ...guiTypes(),
  ...systemTypes(),
  ...globals(),
  selfApi(),
  xguiInteraction(),
];
