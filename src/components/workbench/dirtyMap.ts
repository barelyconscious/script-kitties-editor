/**
 * The Workbench shell tracks per-tab dirtiness in a map keyed by tabKey, fed by
 * each TabWorkspace reporting its aggregate dirty flag up. These pure helpers
 * derive the shell-level state from that map and are tested in isolation (no
 * React, no Monaco) so the guard logic stays trivially verifiable.
 */

/** Whether any tab in the map is dirty. Drives the leave-tool / unload guards. */
export function anyTabDirty(dirtyByTab: Record<string, boolean>): boolean {
  return Object.values(dirtyByTab).some(Boolean);
}

/**
 * Set `key`'s dirtiness in the map, returning the SAME reference when nothing
 * changed so callers can skip a redundant re-render.
 */
export function setTabDirty(
  dirtyByTab: Record<string, boolean>,
  key: string,
  dirty: boolean,
): Record<string, boolean> {
  if (dirtyByTab[key] === dirty) return dirtyByTab;
  return { ...dirtyByTab, [key]: dirty };
}

/**
 * Remove `key` from the map (e.g. when its tab closes) so a closed dirty tab
 * can't keep {@link anyTabDirty} pinned true. Returns the same reference when
 * the key was absent.
 */
export function removeTab(
  dirtyByTab: Record<string, boolean>,
  key: string,
): Record<string, boolean> {
  if (!(key in dirtyByTab)) return dirtyByTab;
  const next = { ...dirtyByTab };
  delete next[key];
  return next;
}
