import type { GameObject, GameObjectType } from "./gameObjects";

/**
 * Tab model for the Workbench: TABS ARE OBJECTS, not scripts. A tab is opened by
 * clicking a game object; opening an already-open object focuses its existing
 * tab rather than duplicating.
 */
export type WorkbenchTab = {
  objectType: GameObjectType;
  id: string;
  name: string;
  /** The object's `script` field — "" when the object has no script. */
  scriptName: string;
};

/** Stable identity for a tab: `objectType + ":" + id`. */
export function tabKey(t: { objectType: GameObjectType; id: string }): string {
  return `${t.objectType}:${t.id}`;
}

/** Build a tab from a game object. */
export function tabFromObject(obj: GameObject): WorkbenchTab {
  return {
    objectType: obj.objectType,
    id: obj.id,
    name: obj.name,
    scriptName: obj.script,
  };
}

/**
 * Open `obj` in the tab set. If a tab with the same identity is already open the
 * set is returned UNCHANGED (the caller focuses it separately); otherwise the
 * new tab is appended. Returns both the (possibly unchanged) tab list and the
 * key that should become active.
 */
export function openTab(
  tabs: readonly WorkbenchTab[],
  obj: GameObject,
): { tabs: WorkbenchTab[]; activeKey: string } {
  const tab = tabFromObject(obj);
  const key = tabKey(tab);
  const existing = tabs.some((t) => tabKey(t) === key);
  if (existing) {
    return { tabs: [...tabs], activeKey: key };
  }
  return { tabs: [...tabs, tab], activeKey: key };
}

/**
 * Close the tab identified by `key`. Returns the remaining tabs and the key that
 * should become active afterward (null when none remain).
 *
 * Neighbor focus: when the CLOSED tab was active, focus shifts to the tab that
 * now occupies its slot (the former right neighbor), or the new last tab if it
 * was the rightmost. When a non-active tab is closed, the active tab is
 * preserved.
 */
export function closeTab(
  tabs: readonly WorkbenchTab[],
  key: string,
  activeKey: string | null,
): { tabs: WorkbenchTab[]; activeKey: string | null } {
  const idx = tabs.findIndex((t) => tabKey(t) === key);
  if (idx === -1) {
    return { tabs: [...tabs], activeKey };
  }

  const next = tabs.filter((_, i) => i !== idx);
  if (next.length === 0) {
    return { tabs: next, activeKey: null };
  }

  // Closing a non-active tab leaves focus where it was.
  if (activeKey !== key) {
    return { tabs: next, activeKey };
  }

  // Closed the active tab: prefer the tab that slid into this index (right
  // neighbor), else the new last tab.
  const neighbor = next[Math.min(idx, next.length - 1)];
  return { tabs: next, activeKey: tabKey(neighbor) };
}
