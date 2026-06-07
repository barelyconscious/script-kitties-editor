import { invoke } from "@tauri-apps/api/core";
import { type Creature, saveCreature } from "@/lib/creature";
import { type Ability, saveAbility } from "@/lib/entities/abilities";
import { type Biogram, saveBiogram } from "@/lib/entities/biograms";
import { type Charm, saveCharm } from "@/lib/entities/charms";
import { type Effect, saveEffect } from "@/lib/entities/effects";
import { DEFAULT_DROP, type ItemRow, saveItemRow } from "@/lib/items";
import type { GameObjectType } from "./gameObjects";

/**
 * THE HEADLESS OBJECT-CREATION CORE for the Workbench "New X" feature.
 *
 * This module owns everything needed to mint a brand-new game object of any of
 * the six {@link GameObjectType}s — naming derivation, the FULL default record
 * per type, the verbatim default script templates, and the {@link createObject}
 * orchestrator that writes the script (when a type has one) and then the record.
 *
 * It is deliberately a SIBLING of (not part of) `dataRegistry.ts`: that registry
 * powers the DATA pane and intentionally EXCLUDES Creature, whereas creation
 * covers all six types. The save functions here are the SAME ones the rest of
 * the app uses (so normalization never diverges) — this module adds NO new save
 * or normalization logic.
 *
 * There is NO UI here. The modal (a later task) branches on the per-type script
 * policy and renders the {@link CreateResult} this module returns.
 */

// ---------------------------------------------------------------------------
// Naming derivation (pure)
// ---------------------------------------------------------------------------

/**
 * Derive a lower_snake_case id from a display name: trim, lowercase, spaces (and
 * any run of whitespace) → underscore, strip anything outside [a-z0-9_], and
 * collapse repeated/edge underscores. "Fire Bite" → "fire_bite".
 */
export function deriveId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      // Drop everything that isn't an id-safe character.
      .replace(/[^a-z0-9_]/g, "")
      // Collapse runs of underscores left by stripping/spacing.
      .replace(/_+/g, "_")
      // Trim leading/trailing underscores so ids never start or end with one.
      .replace(/^_+|_+$/g, "")
  );
}

/**
 * The shared filename stem for a script-bearing flat type:
 * `<typeLowercase>_<id>`, used for both `<stem>.lua` and `<stem>.png`.
 * ("Ability", "bite") → "ability_bite".
 */
export function typeStem(type: GameObjectType, id: string): string {
  return `${type.toLowerCase()}_${id}`;
}

// ---------------------------------------------------------------------------
// Verbatim predecessor default script templates.
//
// Copied byte-for-byte (including indentation and the trailing CRLF) from the
// predecessor editor's DAL: worlds-cpp/editor/dal/src/{abilities,items}.ts. The
// game's runtime expects these exact shapes, so they are NOT reformatted.
// ---------------------------------------------------------------------------

export const ABILITY_SCRIPT_TEMPLATE = `return function(self, combat)
    combat.targets[1]:takeDamage(1, DamageType.PHYSICAL)
end\r\n`;

export const BIOGRAM_SCRIPT_TEMPLATE = `return function(self, combat, actions)
    local modifiedActions = actions
    -- combat code here
    return modifiedActions
end\r\n`;

// NOTE: the predecessor's Effect/Item templates have a WHITESPACE-ONLY line
// ("    ", four spaces) just before the final `return`. It is preserved here
// byte-for-byte via an explicit constant so an editor/formatter trailing-space
// trim can never silently alter the script the game runtime expects.
const WS_BEFORE_RETURN = "\n    \n";

export const EFFECT_SCRIPT_TEMPLATE = `local Effect = {}

function Effect:onApplied(target)
    -- target is the creature the effect is applied to
end

function Effect:onRemoved(target)
    -- target is the creature the effect is applied to
end

function Effect:tick(target)
    -- called on every game tick
    -- target is the creature the effect is applied to
end

function Effect:onIncomingAction(caster, action)
    -- called when the affected creature receives an action
end

function Effect:onOutgoingAction(caster, action)
    -- called when the affected creature casts an action
end${WS_BEFORE_RETURN}return Effect\r\n`;

export const ITEM_SCRIPT_TEMPLATE = `local Item = {}

function Item:onUse(creature)
    -- your code here
end${WS_BEFORE_RETURN}return Item\r\n`;

// Charms had no script in the predecessor editor (the field is new), so there is
// no byte-for-byte template to copy. This is a minimal, table-returning stub the
// game can extend — deliberately free of invented method names so it never
// implies a hook contract the runtime doesn't have. Only written when the user
// opts a charm INTO a script.
export const CHARM_SCRIPT_TEMPLATE = `local Charm = {}

-- Charm behavior hooks go here.

return Charm\r\n`;

// ---------------------------------------------------------------------------
// Script policy + creation descriptor.
// ---------------------------------------------------------------------------

/**
 * How a type's script is handled on creation. A discriminated union so the modal
 * can branch without special-casing each type:
 *  - "create": mint a fresh per-object `.lua` from `template`, named via
 *    `deriveName(id)`. The orchestrator writes it BEFORE the record.
 *  - "shared": the object points at an existing shared script (`defaultName`);
 *    no new file is created.
 *  - "none": the type has no script at all.
 *
 * The `optional` flag (on the script-bearing kinds) marks a type whose script is
 * USER-OPTIONAL — items, charms, and creatures. The modal shows an "attach a
 * script" toggle for these (defaulting OFF), and {@link createObject} skips the
 * script entirely (no file, empty pointer) unless the caller opts in. The
 * script-FIRST types (abilities, biograms, effects) omit it: their script is
 * intrinsic and always created.
 */
export type ScriptPolicy =
  | { kind: "create"; deriveName: (id: string) => string; template: string; optional?: boolean }
  | { kind: "shared"; defaultName: string; optional?: boolean }
  | { kind: "none" };

/** Whether a type's script is user-optional (an "attach a script" toggle). */
export function isOptionalScript(policy: ScriptPolicy): boolean {
  return policy.kind !== "none" && policy.optional === true;
}

/** The seed a caller supplies to mint a record: the resolved id + display name. */
export type CreationSeed = {
  id: string;
  name: string;
  /** The script name to stamp on the record (absent for the "none" policy). */
  script?: string;
};

/**
 * Everything needed to create one type: a factory for the full default record, a
 * script policy, and the (reused) entity save function.
 */
export type CreationDescriptor<T extends { id: string }> = {
  makeDefault: (seed: CreationSeed) => T;
  scriptPolicy: ScriptPolicy;
  save: (record: T) => Promise<void>;
};

// The shared script name for creatures. Verified against the live creatures.json
// (11 of 12 creatures use "ai_default.lua"; the lone outlier is "ai_stalker.lua"),
// so the WITH-extension form is the correct default.
const CREATURE_DEFAULT_SCRIPT = "ai_default.lua";

const ABILITY_DESCRIPTOR: CreationDescriptor<Ability> = {
  scriptPolicy: {
    kind: "create",
    deriveName: (id) => `${typeStem("Ability", id)}.lua`,
    template: ABILITY_SCRIPT_TEMPLATE,
  },
  makeDefault: ({ id, name, script }) => ({
    id,
    name,
    sprite: `${typeStem("Ability", id)}.png`,
    script: script ?? `${typeStem("Ability", id)}.lua`,
    description: "",
    shape: "POINT",
    tags: [],
    range: 0,
    radius: 0,
    maxNumTargets: 1,
    cost: 0,
  }),
  save: saveAbility,
};

const BIOGRAM_DESCRIPTOR: CreationDescriptor<Biogram> = {
  scriptPolicy: {
    kind: "create",
    deriveName: (id) => `${typeStem("Biogram", id)}.lua`,
    template: BIOGRAM_SCRIPT_TEMPLATE,
  },
  makeDefault: ({ id, name, script }) => ({
    id,
    name,
    sprite: `${typeStem("Biogram", id)}.png`,
    script: script ?? `${typeStem("Biogram", id)}.lua`,
    description: "",
    tags: [],
  }),
  save: saveBiogram,
};

const EFFECT_DESCRIPTOR: CreationDescriptor<Effect> = {
  scriptPolicy: {
    kind: "create",
    deriveName: (id) => `${typeStem("Effect", id)}.lua`,
    template: EFFECT_SCRIPT_TEMPLATE,
  },
  makeDefault: ({ id, name, script }) => ({
    id,
    name,
    sprite: `${typeStem("Effect", id)}.png`,
    script: script ?? `${typeStem("Effect", id)}.lua`,
    description: "",
    tags: [],
  }),
  save: saveEffect,
};

const ITEM_DESCRIPTOR: CreationDescriptor<ItemRow> = {
  scriptPolicy: {
    kind: "create",
    deriveName: (id) => `${typeStem("Item", id)}.lua`,
    template: ITEM_SCRIPT_TEMPLATE,
    optional: true,
  },
  makeDefault: ({ id, name, script }) => ({
    id,
    name,
    sprite: `${typeStem("Item", id)}.png`,
    // Empty when no script was attached; createObject resolves the name when one is.
    script: script ?? "",
    description: "",
    itemTags: [],
    // Seed the joined drop fields from the SAME defaults loadItemRows uses for an
    // item with no drop entry yet — saving the row creates that entry.
    ...DEFAULT_DROP,
  }),
  save: saveItemRow,
};

const CHARM_DESCRIPTOR: CreationDescriptor<Charm> = {
  // Charms are script-OPTIONAL: no script unless the user attaches one, in which
  // case a fresh per-charm `.lua` is minted from the stub template.
  scriptPolicy: {
    kind: "create",
    deriveName: (id) => `${typeStem("Charm", id)}.lua`,
    template: CHARM_SCRIPT_TEMPLATE,
    optional: true,
  },
  makeDefault: ({ id, name, script }) => ({
    id,
    name,
    sprite: `${typeStem("Charm", id)}.png`,
    description: "",
    stats: {},
    // Empty/absent for a script-less charm; set when a script is attached.
    script: script ?? "",
  }),
  save: saveCharm,
};

const CREATURE_DESCRIPTOR: CreationDescriptor<Creature> = {
  // Creatures are script-OPTIONAL: attaching a script points the new creature at
  // the shared AI default (creatures share AI scripts); skipping leaves it blank.
  scriptPolicy: { kind: "shared", defaultName: CREATURE_DEFAULT_SCRIPT, optional: true },
  makeDefault: ({ id, name, script }) => ({
    id,
    name,
    // Creatures store the BARE sprite stem (no extension), unlike the flat types.
    sprite: id,
    description: "",
    // Empty when no script was attached; createObject resolves the shared default when one is.
    aiController: script ?? "",
    baseStats: {},
    baseAbilities: [],
    statGainsPerLevel: {},
    abilitiesByLevel: [],
  }),
  save: saveCreature,
};

// Each entry is internally well-typed against its own T; the registry erases T
// to the common `{ id: string }` bound so callers dispatch without generics. The
// cast is sound because a descriptor's `save`/`makeDefault` are only ever paired
// with records that descriptor itself produced.
const REGISTRY: Record<GameObjectType, CreationDescriptor<{ id: string }>> = {
  Ability: erase(ABILITY_DESCRIPTOR),
  Biogram: erase(BIOGRAM_DESCRIPTOR),
  Effect: erase(EFFECT_DESCRIPTOR),
  Item: erase(ITEM_DESCRIPTOR),
  Charm: erase(CHARM_DESCRIPTOR),
  Creature: erase(CREATURE_DESCRIPTOR),
};

function erase<T extends { id: string }>(
  d: CreationDescriptor<T>,
): CreationDescriptor<{ id: string }> {
  return d as unknown as CreationDescriptor<{ id: string }>;
}

/** The creation descriptor for an objectType. Defined for ALL six types. */
export function creationDescriptorFor(
  objectType: GameObjectType,
): CreationDescriptor<{ id: string }> {
  return REGISTRY[objectType];
}

// ---------------------------------------------------------------------------
// createObject orchestrator.
// ---------------------------------------------------------------------------

/** Which step of creation failed, for a legible message. */
export type CreateStep = "script" | "record";

/**
 * A legible result of a creation attempt (never thrown — mirrors the spirit of
 * `summarizeOutcomes` in saveBus.ts). On success, carries the created id; on
 * failure, names the `step` that failed and the error message, so the modal can
 * show one clear line without re-deriving what happened.
 */
export type CreateResult =
  | { ok: true; type: GameObjectType; id: string; message: string }
  | { ok: false; type: GameObjectType; id: string; step: CreateStep; message: string };

/**
 * Mint a new object of `type` from `seed` ({ name, id, script?, attachScript? }).
 *
 * The optional `seed.script` is a user-supplied override (the modal lets the user
 * edit the script name / shared-script pointer). It is resolved ONCE here,
 * preferring a non-blank override over the policy default, and threaded through
 * BOTH `makeDefault` (so the record's `script` field reflects it) and the
 * `create_script` call (so the created file name agrees with the record).
 *
 * `seed.attachScript` gates the OPTIONAL-script types (items, charms, creatures):
 * it defaults to FALSE, so those are created SCRIPT-LESS (no file, empty pointer)
 * unless the caller opts in. Script-intrinsic types (abilities, biograms,
 * effects) ignore it — their script is always created.
 *
 * Ordering & partial failure (NOT a transaction — two files): for a "create"
 * policy with a script attached, write the fresh script FIRST, then the record;
 * if the script write fails, ABORT before saving so we never leave a record
 * pointing at a missing script. Otherwise just save the record. The created file
 * name and the record's `script` field always agree because both flow from the
 * same resolved name.
 */
export async function createObject(
  type: GameObjectType,
  seed: { name: string; id: string; script?: string; attachScript?: boolean },
): Promise<CreateResult> {
  const descriptor = creationDescriptorFor(type);
  const policy = descriptor.scriptPolicy;

  // Whether this creation gets a script: optional types follow the caller's
  // opt-in (default OFF); intrinsic-script types always do; "none" never does.
  const attach = isOptionalScript(policy) ? seed.attachScript === true : policy.kind !== "none";

  // Resolve the effective script name ONCE, preferring a non-blank user override
  // over the policy default. Skipped entirely when no script is attached.
  const override = seed.script?.trim();
  let resolvedScript: string | undefined;
  if (attach) {
    switch (policy.kind) {
      case "create":
        resolvedScript = override ? override : policy.deriveName(seed.id);
        break;
      case "shared":
        resolvedScript = override ? override : policy.defaultName;
        break;
      case "none":
        resolvedScript = undefined;
        break;
    }
  }

  // Build the record from the resolved script so its `script` field and (for the
  // "create" branch) the created file name share a single source of truth. An
  // un-attached script resolves to undefined → makeDefault leaves it empty.
  const record = descriptor.makeDefault({ id: seed.id, name: seed.name, script: resolvedScript });

  if (attach && policy.kind === "create") {
    // resolvedScript is always defined here (attached + create policy).
    const name = resolvedScript as string;
    try {
      await invoke("create_script", { name, contents: policy.template });
    } catch (err) {
      // Abort: do NOT save a record that would point at a missing script.
      return {
        ok: false,
        type,
        id: seed.id,
        step: "script",
        message: `Could not create script "${name}": ${errorMessage(err)}`,
      };
    }
  }

  try {
    await descriptor.save(record);
  } catch (err) {
    return {
      ok: false,
      type,
      id: seed.id,
      step: "record",
      message: `Could not save ${type.toLowerCase()} "${seed.id}": ${errorMessage(err)}`,
    };
  }

  return { ok: true, type, id: seed.id, message: `Created ${type.toLowerCase()} "${seed.id}"` };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
