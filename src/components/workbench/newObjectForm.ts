/**
 * PURE field-derivation + validation glue for the "New X" modal.
 *
 * The modal ({@link NewObjectModal}) owns React state and side effects; this
 * module owns the testable logic between them:
 *  - the name → id → script DERIVATION CHAIN with manual-edit freeze flags, and
 *  - the {@link validateNewObject} check that blocks Create (empty name, bad/
 *    colliding id, bad/colliding script).
 *
 * Keeping this separate mirrors the codebase's preference for unit-testable pure
 * modules (see gameObjects.ts, dataRegistry.ts, saveBus.ts, newObject.ts) so the
 * manual-edit-freeze and uniqueness rules are covered without a full DOM.
 */

import type { GameObject, GameObjectType } from "./gameObjects";
import { creationDescriptorFor, deriveId, isOptionalScript } from "./newObject";

/** Lower_snake_case id shape the backend expects (matches deriveId's output). */
export const ID_PATTERN = /^[a-z0-9_]+$/;

/**
 * The mutable form fields the modal tracks, plus the manual-edit flags that
 * freeze a field from auto-derivation once the user has typed into it.
 */
export type NewObjectFormState = {
  type: GameObjectType;
  name: string;
  id: string;
  /** The script name. Meaningless (and hidden) for a "none" policy type. */
  script: string;
  /**
   * Whether a script will be ATTACHED. Always true for script-intrinsic types
   * (ability/biogram/effect); a user-toggled default-OFF flag for the optional
   * types (item/charm/creature). When false, the script field is hidden and no
   * script is created.
   */
  attachScript: boolean;
  /** Once true, `id` no longer auto-syncs from `name`. */
  idEdited: boolean;
  /** Once true, `script` no longer auto-derives from `id`/`type` (create policy only). */
  scriptEdited: boolean;
};

/**
 * The fresh form state for a (re)opened modal: a preselected type, empty fields,
 * and cleared manual-edit flags. The script seeds to its policy default so a
 * shared-policy type (Creature) shows "ai_default.lua" immediately; a "create"
 * type derives from the (empty) id, and a "none" type leaves it blank.
 */
export function initialFormState(type: GameObjectType): NewObjectFormState {
  return {
    type,
    name: "",
    id: "",
    // Seed the name regardless of `attachScript` so toggling a script ON reveals
    // a sensible default immediately; the field stays hidden until then.
    script: deriveScript(type, ""),
    // Optional-script types default OFF (the user opts in); intrinsic types are
    // always on.
    attachScript: !isScriptOptional(type),
    idEdited: false,
    scriptEdited: false,
  };
}

/**
 * The script name a "create"/"shared" policy would derive for a given type+id.
 * "none" (Charm) has no script → "". Mirrors createObject's own resolution so
 * the field the user sees agrees with what would actually be written.
 */
export function deriveScript(type: GameObjectType, id: string): string {
  const policy = creationDescriptorFor(type).scriptPolicy;
  switch (policy.kind) {
    case "create":
      return policy.deriveName(id);
    case "shared":
      return policy.defaultName;
    case "none":
      return "";
  }
}

/** Whether the type can have a script at all (false only for the "none" policy). */
export function hasScriptField(type: GameObjectType): boolean {
  return creationDescriptorFor(type).scriptPolicy.kind !== "none";
}

/**
 * Whether the type's script is USER-OPTIONAL (item/charm/creature) — the modal
 * shows an "attach a script" toggle for these. Script-intrinsic types
 * (ability/biogram/effect) return false: their script is mandatory.
 */
export function isScriptOptional(type: GameObjectType): boolean {
  return isOptionalScript(creationDescriptorFor(type).scriptPolicy);
}

/**
 * Whether the modal should show the script-NAME input for the given state: the
 * type must support a script AND (be intrinsic OR have its optional toggle on).
 */
export function showScriptName(state: NewObjectFormState): boolean {
  return hasScriptField(state.type) && (!isScriptOptional(state.type) || state.attachScript);
}

/** Whether the Script field auto-derives from id/type (only the "create" policy). */
function scriptAutoDerives(type: GameObjectType): boolean {
  return creationDescriptorFor(type).scriptPolicy.kind === "create";
}

// ---------------------------------------------------------------------------
// Derivation reducer — the name → id → script cascade with freeze flags.
// ---------------------------------------------------------------------------

/** A field-level edit the modal hands to {@link reduceForm}. */
export type FormAction =
  | { kind: "name"; value: string }
  | { kind: "id"; value: string }
  | { kind: "script"; value: string }
  | { kind: "attachScript"; value: boolean }
  | { kind: "type"; value: GameObjectType };

/**
 * Apply a field edit, cascading derivations downstream while honoring the
 * manual-edit freeze flags:
 *  - editing NAME re-derives id (unless id was hand-edited), which in turn
 *    re-derives the script (unless script was hand-edited / not auto-deriving);
 *  - editing ID sets `idEdited` and re-derives the script (subject to the same);
 *  - editing SCRIPT sets `scriptEdited` and freezes it;
 *  - changing TYPE re-derives the script under the NEW type's policy (unless the
 *    script was hand-edited) — id/name are preserved.
 *
 * Pure: returns a new state, never mutates.
 */
export function reduceForm(state: NewObjectFormState, action: FormAction): NewObjectFormState {
  switch (action.kind) {
    case "name": {
      const name = action.value;
      const id = state.idEdited ? state.id : deriveId(name);
      const script = nextScript(state, state.type, id);
      return { ...state, name, id, script };
    }
    case "id": {
      const id = action.value;
      const script = nextScript(state, state.type, id);
      return { ...state, id, idEdited: true, script };
    }
    case "script":
      return { ...state, script: action.value, scriptEdited: true };
    case "attachScript": {
      const attachScript = action.value;
      // Turning a script ON seeds the name from the current id/type (unless the
      // user already hand-edited it); turning OFF leaves the (now-hidden) name
      // untouched so re-enabling restores it.
      const script =
        attachScript && !state.scriptEdited ? deriveScript(state.type, state.id) : state.script;
      return { ...state, attachScript, script };
    }
    case "type": {
      const type = action.value;
      const script = nextScript(state, type, state.id);
      // Each type carries its own attach default (optional ⇒ OFF, intrinsic ⇒
      // ON). Re-seed it on a type change so switching INTO an optional type
      // doesn't silently inherit the previous type's "on".
      const attachScript = !isScriptOptional(type);
      return { ...state, type, script, attachScript };
    }
  }
}

/**
 * The script value after an id/type change: the freshly derived name when the
 * field still auto-derives (create policy AND not hand-edited), otherwise the
 * unchanged current value. A "shared"/"none" type never auto-rederives here, so
 * a Creature's edited "ai_*.lua" survives an id change.
 */
function nextScript(state: NewObjectFormState, type: GameObjectType, id: string): string {
  if (state.scriptEdited || !scriptAutoDerives(type)) {
    // Switching INTO a type whose script doesn't auto-derive: if the user hasn't
    // touched the field, seed it from the new policy's default rather than
    // leaving a stale value from the previous type.
    if (!state.scriptEdited && type !== state.type) return deriveScript(type, id);
    return state.script;
  }
  return deriveScript(type, id);
}

// ---------------------------------------------------------------------------
// Validation — what blocks Create, with per-field messages.
// ---------------------------------------------------------------------------

/** Per-field validation messages; an absent key means that field is valid. */
export type ValidationErrors = {
  name?: string;
  id?: string;
  script?: string;
};

/**
 * Validate the (trimmed) form against the existing object list. Blocks Create on:
 *  - empty name;
 *  - empty / non-lower_snake_case id;
 *  - id COLLISION within the chosen type (save_<entity> upserts by id, so a
 *    collision would SILENTLY OVERWRITE an existing object — the critical check);
 *  - for a "create" policy: empty script, a script not ending in ".lua", or a
 *    script name already used by an existing object (the backend also refuses a
 *    manifest collision, but pre-warning is friendlier).
 *
 * A "shared" (Creature) script is intentionally NOT collision-checked — sharing
 * is the point — but it must still end in ".lua". A "none" type skips script
 * validation entirely.
 */
export function validateNewObject(
  state: NewObjectFormState,
  objects: readonly GameObject[],
): ValidationErrors {
  const errors: ValidationErrors = {};
  const { type } = state;
  const name = state.name.trim();
  const id = state.id.trim();
  const script = state.script.trim();

  if (name.length === 0) {
    errors.name = "Name is required.";
  }

  if (id.length === 0) {
    errors.id = "ID is required.";
  } else if (!ID_PATTERN.test(id)) {
    errors.id = "ID must be lower_snake_case (a–z, 0–9, underscore).";
  } else if (objects.some((o) => o.objectType === type && o.id === id)) {
    errors.id = `A ${type.toLowerCase()} with id "${id}" already exists.`;
  }

  // Validate the script only when one will actually be attached: an optional
  // type with the toggle OFF carries no script, so its (hidden) name is moot.
  const policy = creationDescriptorFor(type).scriptPolicy;
  const attaching = isScriptOptional(type) ? state.attachScript : policy.kind !== "none";
  if (policy.kind !== "none" && attaching) {
    if (script.length === 0) {
      errors.script = "Script name is required.";
    } else if (!script.toLowerCase().endsWith(".lua")) {
      errors.script = 'Script name must end in ".lua".';
    } else if (policy.kind === "create" && objects.some((o) => o.script === script)) {
      // Only "create" mints a NEW file — a collision would overwrite/clash. A
      // "shared" pointer is allowed (and expected) to reuse an existing script.
      errors.script = `Script "${script}" is already used by another object.`;
    }
  }

  return errors;
}

/** Whether a validation result has no errors (Create may proceed). */
export function isValid(errors: ValidationErrors): boolean {
  return !errors.name && !errors.id && !errors.script;
}
