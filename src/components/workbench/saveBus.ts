import { createContext, useContext, useEffect, useRef, useState } from "react";

/**
 * THE WORKBENCH SAVE BUS CONTRACT.
 *
 * A tab is a workspace over a single game object made of several panes (DATA,
 * SCRIPT, …). Each pane that can be edited owns a slice of save state and
 * REGISTERS a {@link SaveTarget} with its tab. The tab aggregates dirtiness
 * across targets and exposes a {@link saveAllTargets} router so a single ⌘S can
 * persist everything in the right order.
 *
 * Panes are placeholder slots today; the real DATA/SCRIPT/API panes plug into
 * this contract in later tasks. The contract is intentionally tiny and stable —
 * downstream tasks import these types and the {@link useSaveTarget} hook without
 * needing to understand the shell internals.
 */

/** A single saveable unit within a tab — typically one pane. */
export type SaveTarget = {
  /** Stable identifier within a tab, e.g. "data" | "script" | "itemDrop". */
  id: string;
  /**
   * Ascending save order. DATA / pointer writes use a LOWER order than the
   * script so they land first (a script save may depend on the record existing).
   */
  order: number;
  /** Whether this target has unsaved changes. */
  dirty: boolean;
  /** Persist this target. Individually atomic; throws on failure. */
  save: () => Promise<void>;
};

/** The result of attempting to save one target. */
export type SaveOutcome = {
  id: string;
  ok: boolean;
  error?: string;
};

/**
 * Run every DIRTY target in ascending `order`, collecting a per-target outcome.
 *
 * v1 semantics (kept deliberately simple): every dirty target runs, each save
 * is wrapped so one failure does not abort the rest, and ALL outcomes are
 * returned. Dependency-aware short-circuiting (skip the script save if the data
 * save it depends on failed) is a later refinement — see task 427.
 *
 * Extracted as a pure function so the ordering / outcome-collection logic is
 * testable without React.
 */
export async function saveAllTargets(targets: readonly SaveTarget[]): Promise<SaveOutcome[]> {
  const dirty = targets.filter((t) => t.dirty).sort((a, b) => a.order - b.order);

  const outcomes: SaveOutcome[] = [];
  for (const target of dirty) {
    try {
      await target.save();
      outcomes.push({ id: target.id, ok: true });
    } catch (err) {
      outcomes.push({ id: target.id, ok: false, error: errorMessage(err) });
    }
  }
  return outcomes;
}

/** Whether any target in the set is dirty. */
export function aggregateDirty(targets: readonly SaveTarget[]): boolean {
  return targets.some((t) => t.dirty);
}

/** A human summary of a save attempt, suitable for inline status UI. */
export type SaveSummary = {
  /** True only when EVERY attempted save succeeded (or nothing was attempted). */
  ok: boolean;
  /**
   * Status text. Empty string for the no-op case (nothing was dirty) so callers
   * can treat it as "show nothing". On full success this is "Saved"; on any
   * failure it NAMES which target(s) failed precisely.
   */
  message: string;
};

/** Friendly label for a known target id (falls back to the raw id). */
function targetLabel(id: string): string {
  switch (id) {
    case "data":
      return "Data";
    case "script":
      return "Script";
    default:
      return id;
  }
}

/**
 * Collapse per-target outcomes into a single ok/message summary for the toolbar.
 *
 * The TRUST-CRITICAL rule: a PARTIAL failure must never read as success. If any
 * target failed, `ok` is false and the message names what saved AND what failed
 * (e.g. "Data saved, but script failed: <error>") so the user is never told
 * "Saved" while a write is actually on the floor.
 *
 * Cases:
 *  - empty            → { ok: true,  message: "" }   (nothing was dirty; no-op)
 *  - all succeeded    → { ok: true,  message: "Saved" }
 *  - some succeeded   → { ok: false, message: "<X> saved, but <y> failed: …" }
 *  - none succeeded   → { ok: false, message: "Save failed: …" }
 *
 * Pure — unit-tested without React.
 */
export function summarizeOutcomes(outcomes: readonly SaveOutcome[]): SaveSummary {
  if (outcomes.length === 0) {
    return { ok: true, message: "" };
  }

  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length === 0) {
    return { ok: true, message: "Saved" };
  }

  const succeeded = outcomes.filter((o) => o.ok);
  const failedDetail = failed
    .map((o) => `${targetLabel(o.id).toLowerCase()}${o.error ? `: ${o.error}` : ""}`)
    .join("; ");

  // Total failure: nothing landed.
  if (succeeded.length === 0) {
    return { ok: false, message: `Save failed: ${failedDetail}` };
  }

  // Partial failure: name what saved so the user knows the split state exactly.
  const savedLabels = succeeded.map((o) => targetLabel(o.id)).join(", ");
  return {
    ok: false,
    message: `${savedLabels} saved, but ${failedDetail}`,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

// ---------------------------------------------------------------------------
// React binding: per-tab registry + registration hook.
// ---------------------------------------------------------------------------

/**
 * The registry handed to panes through context. Scoped to the ACTIVE TAB
 * INSTANCE — each open tab provides its own registry so targets never leak
 * across tabs.
 */
export type SaveBusRegistry = {
  /** Register (or, by re-registering the same id, replace) a target. */
  register: (target: SaveTarget) => void;
  /** Remove a target by id. */
  unregister: (id: string) => void;
};

const SaveBusContext = createContext<SaveBusRegistry | null>(null);

export const SaveBusProvider = SaveBusContext.Provider;

/**
 * A pane-facing handle to trigger the tab's UNIFIED save (all dirty targets, in
 * order) — used by Monaco's ⌘S inside the script pane so an in-editor save runs
 * the same path as the toolbar Save button. Provided by {@link TabWorkspace}.
 */
const RequestSaveContext = createContext<(() => void) | null>(null);

export const RequestSaveProvider = RequestSaveContext.Provider;

/**
 * Pane-side hook returning a callback that triggers the tab's unified save, or a
 * no-op when used outside a provider. Lets a pane (e.g. the script editor's ⌘S)
 * save EVERYTHING dirty in the tab, not just its own target.
 */
export function useRequestSave(): () => void {
  const requestSave = useContext(RequestSaveContext);
  return requestSave ?? noop;
}

function noop(): void {}

/**
 * Pane-side registration hook. Registers `target` on mount, keeps it current as
 * its `dirty`/`save`/`order` change, and unregisters on unmount. Call this from
 * any pane that participates in saving.
 *
 * Must be used inside a tab's {@link SaveBusProvider}.
 */
export function useSaveTarget(target: SaveTarget): void {
  const registry = useContext(SaveBusContext);
  if (!registry) {
    throw new Error("useSaveTarget must be used within a SaveBusProvider");
  }

  const { id, order, dirty, save } = target;
  // Re-register whenever any field changes; unregister on unmount or id change.
  useEffect(() => {
    registry.register({ id, order, dirty, save });
    return () => registry.unregister(id);
  }, [registry, id, order, dirty, save]);
}

/**
 * Tab-side hook that owns the live set of registered targets and derives the
 * aggregate dirty flag + the save router. Returns the registry to feed into a
 * {@link SaveBusProvider} plus the derived state.
 */
export function useSaveBus(): {
  registry: SaveBusRegistry;
  targets: SaveTarget[];
  dirty: boolean;
  saveAll: () => Promise<SaveOutcome[]>;
} {
  const [targets, setTargets] = useState<SaveTarget[]>([]);
  // Mirror the current targets in a ref so saveAll always sees the latest set
  // without being recreated on every change.
  const targetsRef = useRef<SaveTarget[]>(targets);
  targetsRef.current = targets;

  const registryRef = useRef<SaveBusRegistry>(undefined as never);
  if (!registryRef.current) {
    registryRef.current = {
      register(target) {
        setTargets((prev) => {
          const next = prev.filter((t) => t.id !== target.id);
          next.push(target);
          return next;
        });
      },
      unregister(id) {
        setTargets((prev) => prev.filter((t) => t.id !== id));
      },
    };
  }

  return {
    registry: registryRef.current,
    targets,
    dirty: aggregateDirty(targets),
    saveAll: () => saveAllTargets(targetsRef.current),
  };
}
