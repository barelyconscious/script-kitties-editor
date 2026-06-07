import { createContext, useContext, useRef } from "react";

/**
 * CROSS-TAB SHARED-SCRIPT SYNC.
 *
 * Two open Workbench tabs can point at the SAME shared `.lua` file (e.g. two
 * creatures both backed by `ai_default.lua`). When one tab saves that script,
 * every OTHER open tab showing the same file must refresh to the new contents —
 * and if a sibling holds UNSAVED edits, it must WARN before clobbering.
 *
 * This is FRONTEND-ORCHESTRATED off `save_script` SUCCESS. The Rust watcher
 * invalidates the cache but emits no Tauri event, and v1 adds no event bridge,
 * so there is no disk-watch auto-refresh — only the in-app save path fans out.
 * The refreshed contents come from the just-saved draft (the publish payload),
 * NOT a re-fetch via `get_script`.
 *
 * The registry below is a tiny name-keyed pub/sub. A {@link ScriptSyncProvider}
 * holds ONE registry for the whole Workbench (created once via useRef), so every
 * tab's script pane subscribes to the same bus.
 */

/**
 * A subscriber to saves of one script name. Receives the just-saved `contents`
 * and the `originId` of the pane that saved it (so a subscriber can skip its own
 * save and avoid reacting to itself).
 */
export type ScriptSyncListener = (contents: string, originId: string) => void;

/** Unsubscribe handle returned by {@link ScriptSyncRegistry.subscribe}. */
export type Unsubscribe = () => void;

/** The pure pub/sub core: name-keyed fan-out of script saves. */
export type ScriptSyncRegistry = {
  /**
   * Subscribe `listener` to saves of `name`. Returns an unsubscribe fn.
   * Subscriptions are keyed by exact script name; a listener only hears saves of
   * the name it subscribed to.
   */
  subscribe: (name: string, listener: ScriptSyncListener) => Unsubscribe;
  /**
   * Announce that `name` was saved with `contents` by the pane `originId`.
   * Delivers to every CURRENT subscriber of `name` (including the origin's own
   * pane — listeners skip themselves by comparing `originId`). A name with no
   * subscribers is a safe no-op.
   */
  publish: (name: string, contents: string, originId: string) => void;
};

/**
 * Build a fresh pub/sub registry. Pure — no React — so the fan-out semantics are
 * unit-testable in isolation.
 *
 * Listeners are stored per name in a Set so the same listener can't double-fire
 * and unsubscribe is exact. Publishing iterates a SNAPSHOT of the listener set
 * so a listener that (un)subscribes during delivery doesn't perturb the in-flight
 * fan-out.
 */
export function createScriptSyncRegistry(): ScriptSyncRegistry {
  const byName = new Map<string, Set<ScriptSyncListener>>();

  return {
    subscribe(name, listener) {
      let listeners = byName.get(name);
      if (!listeners) {
        listeners = new Set();
        byName.set(name, listeners);
      }
      listeners.add(listener);

      return () => {
        const set = byName.get(name);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) byName.delete(name);
      };
    },

    publish(name, contents, originId) {
      const listeners = byName.get(name);
      if (!listeners) return; // no subscribers — safe no-op
      // Snapshot so (un)subscribes during delivery don't mutate the live set.
      for (const listener of [...listeners]) {
        listener(contents, originId);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// React binding: one registry per Workbench, shared by all tabs.
// ---------------------------------------------------------------------------

const ScriptSyncContext = createContext<ScriptSyncRegistry | null>(null);

export const ScriptSyncProvider = ScriptSyncContext.Provider;

/**
 * Pane-side hook returning the Workbench-wide script-sync registry. Must be used
 * inside a {@link ScriptSyncProvider}.
 */
export function useScriptSync(): ScriptSyncRegistry {
  const registry = useContext(ScriptSyncContext);
  if (!registry) {
    throw new Error("useScriptSync must be used within a ScriptSyncProvider");
  }
  return registry;
}

/**
 * Convenience hook for the Workbench shell: create exactly ONE registry for the
 * lifetime of the component (via useRef) to feed into {@link ScriptSyncProvider}.
 */
export function useScriptSyncRegistry(): ScriptSyncRegistry {
  const ref = useRef<ScriptSyncRegistry>(undefined as never);
  if (!ref.current) {
    ref.current = createScriptSyncRegistry();
  }
  return ref.current;
}

// ---------------------------------------------------------------------------
// "Also open in another tab" derivation (pure).
// ---------------------------------------------------------------------------

/**
 * Count how many OPEN tabs reference each non-empty script name. Distinct from
 * `scriptReach` (the static count of GAME OBJECTS pointing at a file): this is
 * the DYNAMIC count of currently-open tabs showing the same script.
 *
 * Empty/whitespace script names are excluded — a script-less tab is never "open
 * elsewhere". Pure so the derivation is unit-testable.
 */
export function openScriptCounts(tabs: readonly { scriptName: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    const name = tab.scriptName;
    if (name.trim().length === 0) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Whether the script shown by `scriptName` is ALSO open in some OTHER tab —
 * i.e. at least two open tabs reference the same non-empty script. Returns false
 * for empty names and for a script open in only one tab.
 */
export function scriptOpenInOtherTab(
  tabs: readonly { scriptName: string }[],
  scriptName: string,
): boolean {
  if (scriptName.trim().length === 0) return false;
  return (openScriptCounts(tabs).get(scriptName) ?? 0) > 1;
}
