import { invoke } from "@tauri-apps/api/core";
import { loadCreatures, saveCreature } from "@/lib/creature";
import { dataDescriptorFor, selectById } from "./dataRegistry";
import type { GameObjectType } from "./gameObjects";
import { creationDescriptorFor } from "./newObject";

/**
 * Attach a script to an EXISTING game object that has none — the inverse of the
 * "attach a script" toggle in the New-object modal, applied after the fact.
 *
 * It reuses the SAME per-type script policy as {@link createObject} (so the
 * derived name + starter template never diverge between creating-with-a-script
 * and adding-one-later) and the SAME entity save functions (so normalization is
 * identical). Two writes, ordered like createObject: for a per-object ("create")
 * script, write the fresh `.lua` FIRST, then point the record at it — so a failed
 * file write never leaves the record referencing a missing script. Creatures use
 * a SHARED ai script, so nothing is written to disk; the record is just pointed
 * at the shared default.
 *
 * The record load→set→save reads the CURRENT on-disk record (data panes auto-save,
 * so it is normally fresh) and writes back only the script pointer changed. The
 * save bumps the entity version, so the object list + the tab's data pane refresh
 * through the usual live-reload path.
 */

/** A legible result — never throws (mirrors {@link createObject}'s CreateResult). */
export type AttachScriptResult = { ok: true; script: string } | { ok: false; message: string };

/** Whether a type can take a script at all (everything but the script-less Season/Pack). */
export function canAttachScript(objectType: GameObjectType): boolean {
  return creationDescriptorFor(objectType).scriptPolicy.kind !== "none";
}

export async function attachScript(
  objectType: GameObjectType,
  id: string,
): Promise<AttachScriptResult> {
  const policy = creationDescriptorFor(objectType).scriptPolicy;
  if (policy.kind === "none") {
    return { ok: false, message: `${objectType} objects don't use a script.` };
  }

  // The script name: a fresh per-object file ("create") or the shared default.
  const script = policy.kind === "create" ? policy.deriveName(id) : policy.defaultName;

  // 1) Write the fresh file FIRST (only for per-object scripts). A "shared" script
  //    already exists on disk, so it is only pointed at, never re-created.
  if (policy.kind === "create") {
    try {
      await invoke("create_script", { name: script, contents: policy.template });
    } catch (err) {
      return { ok: false, message: `Could not create script "${script}": ${errorMessage(err)}` };
    }
  }

  // 2) Point the object's record at the script and persist it. Creatures store the
  //    pointer as `aiController` and live outside the schema-driven data registry;
  //    every other type stores `script` and goes through its data descriptor.
  try {
    if (objectType === "Creature") {
      const record = selectById(await loadCreatures(), id);
      if (!record) return { ok: false, message: `Creature "${id}" not found.` };
      await saveCreature({ ...record, aiController: script });
    } else {
      const descriptor = dataDescriptorFor(objectType);
      if (!descriptor) return { ok: false, message: `Can't attach a script to ${objectType}.` };
      const record = selectById(await descriptor.load(), id);
      if (!record) return { ok: false, message: `${objectType} "${id}" not found.` };
      // `record` is erased to `{ id }`; it carries a runtime `script` field that the
      // spread updates. Bind to a var so it isn't excess-property-checked as a literal.
      const updated = { ...record, script };
      await descriptor.save(updated);
    }
  } catch (err) {
    return {
      ok: false,
      message: `Could not update ${objectType.toLowerCase()} "${id}": ${errorMessage(err)}`,
    };
  }

  return { ok: true, script };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
