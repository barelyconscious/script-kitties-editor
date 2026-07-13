/**
 * elementVisibilityStore — EDITOR-LOCAL persistence for each component's HIDDEN
 * elements (visibility toggle), the exact sibling of {@link import("./elementLockStore")}.
 *
 * A hidden element and its whole subtree are not rendered in the preview. Visibility
 * is purely editor convenience (like a design tool's layer eye toggle) — it is the
 * editor's own view state, NOT the authored `visible` attribute, so it is NEVER
 * written to game data.
 *
 * Like locks, hides are keyed at runtime by the session-only {@link GuiNode.nodeId},
 * which is re-minted on every (re)parse. Persisting by nodeId would not survive a
 * live-reload or app restart, so — exactly as the lock store does — we persist the
 * STABLE STRUCTURAL KEY per hidden node (its dotted child-index path from the root)
 * and resolve those back to nodeIds against the freshly-parsed tree on open/reload.
 *
 * Shape on disk: a SINGLE JSON object under {@link ELEMENT_HIDDEN_KEY} mapping
 * `componentPath → string[]` (the hidden structural keys), independent of the lock
 * map. All the map read/write and structural-key machinery is shared with the lock
 * store (only the storage key differs), so this module is a thin, well-tested-by-
 * reuse wrapper.
 */

import type { GuiNode } from "../../lib/guiNode";
import {
  getPersistedKeys,
  type LockStorage,
  setPersistedKeys,
  structuralKeysForNodeIds,
} from "./elementLockStore";

/** The single localStorage key holding the whole `path → hiddenKeys` map. */
export const ELEMENT_HIDDEN_KEY = "xgui.elementHidden";

/**
 * The persisted hidden structural keys for one component path, or `[]` when none is
 * stored (or the store is unreadable).
 */
export function getPersistedHidden(path: string, storage?: LockStorage): string[] {
  return getPersistedKeys(ELEMENT_HIDDEN_KEY, path, storage);
}

/**
 * Persist one component's hidden keys under its path, preserving every other path's
 * entry. An EMPTY list removes the entry entirely (nothing hidden → no row). A write
 * failure is swallowed — persistence is best-effort.
 */
export function setPersistedHidden(
  path: string,
  keys: readonly string[],
  storage?: LockStorage,
): void {
  setPersistedKeys(ELEMENT_HIDDEN_KEY, path, keys, storage);
}

/**
 * Map a runtime hidden-nodeId set to its stable structural keys, in document order —
 * the value to hand {@link setPersistedHidden}. A nodeId no longer in the tree is
 * skipped, so the persisted set self-prunes. (Thin re-export of the shared structural
 * mapping so callers stay within the visibility vocabulary.)
 */
export function hiddenKeysFor(root: GuiNode, hiddenNodeIds: ReadonlySet<string>): string[] {
  return structuralKeysForNodeIds(root, hiddenNodeIds);
}
