/**
 * componentRegistry — a frontend snapshot of EVERY gui component's parsed tree,
 * keyed by bare basename. It backs the two cross-component features that need to
 * see a component OTHER than the open one:
 *
 *   - the Data Model auto-scaffold's `<Component … data="k">` injection, which
 *     folds a referenced child's own token shape into the parent model (the
 *     {@link ComponentResolver} this hook returns is handed to `scaffoldModelText`);
 *   - the save-time CASCADE, which re-reconciles every component's persisted model
 *     against the freshly-saved shapes (it iterates {@link ComponentRegistry.components}).
 *
 * It loads each component through the SAME module cache the preview's `useComponent`
 * uses ({@link loadComponentTree}), so a child the preview already pulled is not
 * re-fetched, and it reloads when that cache is invalidated — which the live-reload
 * glue triggers on every `gui-changed` (a save or an external edit) — so the
 * registry tracks disk. The list of components comes from the shared gui tree.
 */

import { useCallback, useEffect, useState } from "react";
import { componentsVersion, loadComponentTree, subscribeComponents } from "../../lib/guiComponentCache";
import type { GuiNode } from "../../lib/guiNode";
import type { ComponentResolver } from "./guiModelScaffold";
import type { GuiFolder } from "./guiTree";
import { useGuiTreeStore } from "./guiTreeStore";

/** One loaded component: its bare name, gui-relative path, and parsed tree. */
export type LoadedComponent = { name: string; path: string; root: GuiNode };

export type ComponentRegistry = {
  /** Resolve a (possibly `.xml`-suffixed) basename to its parsed tree, or undefined. */
  resolve: ComponentResolver;
  /** Every loaded component (for the save-time cascade over persisted models). */
  components: readonly LoadedComponent[];
};

/** Collect every component's bare name + path across the gui tree, depth-first. */
export function allComponentRefs(folder: GuiFolder): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const walk = (f: GuiFolder) => {
    for (const c of f.components) out.push({ name: c.name, path: c.path });
    for (const sub of f.folders) walk(sub);
  };
  walk(folder);
  return out;
}

const EMPTY: readonly LoadedComponent[] = [];

/**
 * Load + parse every component in the gui tree into a snapshot, reloading when the
 * tree changes or the component cache is invalidated (a save / external edit). The
 * returned {@link ComponentRegistry.resolve} normalizes a `.xml` suffix so it keys
 * on the bare name the picker writes and the backend resolves.
 */
export function useComponentRegistry(): ComponentRegistry {
  const { tree } = useGuiTreeStore();
  const [components, setComponents] = useState<readonly LoadedComponent[]>(EMPTY);

  // Re-run on cache invalidation (gui-changed bumps the version after clearing the
  // cache, so the reload below reads fresh) as well as on a tree change.
  const [cacheVersion, setCacheVersion] = useState(() => componentsVersion());
  useEffect(() => subscribeComponents(() => setCacheVersion(componentsVersion())), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `cacheVersion` is the re-fetch trigger — when the component cache is invalidated the effect must re-run against the cleared cache, even though the body doesn't read it (mirrors useComponent in guiComponentCache)
  useEffect(() => {
    let cancelled = false;
    const refs = allComponentRefs(tree);
    Promise.all(
      refs.map(async (r): Promise<LoadedComponent | null> => {
        const root = await loadComponentTree(r.name);
        return root ? { name: r.name, path: r.path, root } : null;
      }),
    ).then((loaded) => {
      if (!cancelled) setComponents(loaded.filter((c): c is LoadedComponent => c !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [tree, cacheVersion]);

  const resolve = useCallback<ComponentResolver>(
    (basename) => {
      const bare = basename.replace(/\.xml$/i, "");
      return components.find((c) => c.name === bare)?.root;
    },
    [components],
  );

  return { resolve, components };
}
