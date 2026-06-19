/**
 * elementLockStore — EDITOR-LOCAL persistence for each component's locked elements
 * (element-lock feature).
 *
 * A locked element can't be selected from the preview and its properties are
 * read-only. Lock is purely editor convenience — it is NEVER written to game data.
 * The runtime store keys locks by the session-only {@link GuiNode.nodeId}, which is
 * re-minted on every (re)parse, so a naive persist-by-nodeId would not survive a
 * live-reload or app restart. Instead we persist a STABLE STRUCTURAL KEY per locked
 * node — its dotted child-index path from the root (e.g. `"2.0.1"`; the root is the
 * empty string) — and resolve those paths back to nodeIds against the freshly-parsed
 * tree on open/reload. The same file parses to the same structure, so the same
 * elements come back locked.
 *
 * Shape on disk: a SINGLE JSON object under one key (`xgui.elementLocks`) mapping
 * `componentPath → string[]` (the locked index-path keys). One key keeps storage tidy
 * and lets one parse load the whole map; per-path writes rewrite that one object, and
 * a component with NOTHING locked drops its entry entirely.
 *
 * Defensive by design (mirrors {@link import("./dataModelStore")}): every read/parse
 * and write is wrapped so a corrupt/oversized/unavailable store degrades to "no
 * persisted locks" rather than throwing into the React tree. The pure index-path
 * helpers and the map<->storage logic are unit-tested off the browser with an
 * in-memory stand-in.
 */

import type { GuiNode } from "../../lib/guiNode";

/** The single localStorage key holding the whole `path → lockedKeys` map. */
export const ELEMENT_LOCKS_KEY = "xgui.elementLocks";

/**
 * The minimal `Storage` surface this module uses — `getItem`/`setItem`. Both the
 * real `window.localStorage` and the test stand-in satisfy it.
 */
export type LockStorage = Pick<Storage, "getItem" | "setItem">;

// ---------------------------------------------------------------------------
// Stable structural keys (pure)
// ---------------------------------------------------------------------------

/**
 * The dotted child-index path from `root` to the node with `nodeId`, or `null` if
 * the node isn't in the tree. The root itself is the EMPTY string; a child is its
 * index, a grandchild `"i.j"`, and so on. This is the stable key a lock persists
 * under — it depends only on tree structure, so it survives a re-parse (nodeIds do
 * not).
 */
export function nodeIndexPath(root: GuiNode, nodeId: string): string | null {
  if (root.nodeId === nodeId) return "";
  const walk = (node: GuiNode, prefix: string): string | null => {
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      const key = prefix === "" ? String(i) : `${prefix}.${i}`;
      if (child.nodeId === nodeId) return key;
      const found = walk(child, key);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, "");
}

/** Navigate to the node addressed by a dotted index path (`""` = root), or `null`. */
function nodeAtIndexPath(root: GuiNode, key: string): GuiNode | null {
  if (key === "") return root;
  let node = root;
  for (const seg of key.split(".")) {
    const i = Number(seg);
    if (!Number.isInteger(i) || i < 0 || i >= node.children.length) return null;
    node = node.children[i];
  }
  return node;
}

/**
 * Map a runtime locked-nodeId set to its stable structural keys, in document order.
 * A nodeId no longer in the tree (a locked node that was deleted) is skipped, so the
 * persisted set self-prunes.
 */
export function lockedKeysFor(root: GuiNode, lockedNodeIds: ReadonlySet<string>): string[] {
  const keys: string[] = [];
  const walk = (node: GuiNode, key: string): void => {
    if (lockedNodeIds.has(node.nodeId)) keys.push(key);
    node.children.forEach((child, i) => {
      walk(child, key === "" ? String(i) : `${key}.${i}`);
    });
  };
  walk(root, "");
  return keys;
}

/**
 * Resolve persisted structural keys back to the CURRENT tree's nodeIds. Keys that
 * don't address a node anymore (structure changed since they were saved) are
 * dropped, so a stale persisted lock simply doesn't apply rather than erroring.
 */
export function nodeIdsForKeys(root: GuiNode, keys: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const key of keys) {
    const node = nodeAtIndexPath(root, key);
    if (node) ids.add(node.nodeId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Persistence (storage-injected)
// ---------------------------------------------------------------------------

/**
 * Resolve the storage to use: the injected one, else `globalThis.localStorage` when
 * present, else `null` (node/test without a DOM, or storage disabled). Accessing
 * `localStorage` can itself throw in locked-down environments, so even the lookup is
 * guarded.
 */
function resolveStorage(storage?: LockStorage): LockStorage | null {
  if (storage) return storage;
  try {
    const ls = (globalThis as { localStorage?: LockStorage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

/**
 * Read and parse the whole `path → lockedKeys` map. Returns an empty map when the
 * store is absent, empty, unreadable, malformed, or not a plain object — never
 * throws. Each entry is validated to be an array of strings; a malformed value is
 * dropped defensively so one bad entry can't poison the rest.
 */
function readMap(storage?: LockStorage): Record<string, string[]> {
  const store = resolveStorage(storage);
  if (!store) return {};
  let raw: string | null;
  try {
    raw = store.getItem(ELEMENT_LOCKS_KEY);
  } catch {
    return {};
  }
  if (raw == null || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      out[key] = value as string[];
    }
  }
  return out;
}

/**
 * The persisted locked structural keys for one component path, or `[]` when none is
 * stored (or the store is unreadable).
 */
export function getPersistedLocks(path: string, storage?: LockStorage): string[] {
  return readMap(storage)[path] ?? [];
}

/**
 * Persist one component's locked keys under its path, preserving every other path's
 * entry. An EMPTY list removes the entry entirely (nothing locked → no row). A write
 * failure (quota, disabled storage) is swallowed — persistence is best-effort.
 */
export function setPersistedLocks(path: string, keys: readonly string[], storage?: LockStorage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  const map = readMap(store);
  if (keys.length === 0) delete map[path];
  else map[path] = [...keys];
  try {
    store.setItem(ELEMENT_LOCKS_KEY, JSON.stringify(map));
  } catch {
    // Best-effort: a full/disabled store just means this edit isn't persisted.
  }
}
