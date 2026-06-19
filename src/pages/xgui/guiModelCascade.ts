/**
 * guiModelCascade — the pure core of the save-time DATA MODEL CASCADE.
 *
 * A nested `<Component … data="k">` mirrors a child component's token shape into
 * the parent's data model under `k`. When the CHILD's shape changes (a token added
 * or removed) and the component is saved, every component that references it must
 * have its persisted `k` object brought back in sync — even components that aren't
 * open. This module computes WHICH persisted models to rewrite; the React layer
 * supplies the read/write of localStorage and applies the result.
 *
 * The reconciliation is the SAME prune-aware scaffold the open editor runs
 * ({@link scaffoldModelText}): a component's own tokens merge additively, while its
 * `data=` objects are prune-synced to the (now-fresh) child shapes. So a
 * non-referencing component is a no-op (scaffold returns `null`), a referencing one
 * gets its data object updated, and a never-opened referencing parent is SEEDED
 * from an empty baseline (`{}`) — populating the binding the first time round.
 *
 * Pure: the component set, the resolver, and the model reader are all injected, so
 * the cascade decision is unit-tested without React or localStorage.
 */

import type { GuiNode } from "../../lib/guiNode";
import { type ComponentResolver, scaffoldModelText } from "./guiModelScaffold";

/** One component the cascade considers: bare name, persisted-model key, parsed tree. */
export type CascadeComponent = { name: string; path: string; root: GuiNode };

/** A persisted-model write the cascade wants applied: `text` for `path`. */
export type ModelWrite = { path: string; text: string };

/**
 * Compute the persisted-model rewrites a cascade should apply after a save.
 *
 * For every component (except `skipPath` — the live-edited open one, whose model is
 * owned by the editor), re-run the prune-aware scaffold over its CURRENT persisted
 * model (or an empty `{}` baseline when it has none, seeding never-opened parents)
 * using `resolve` to see the fresh child shapes. A component the scaffold leaves
 * unchanged contributes no write.
 */
export function cascadeModelWrites(
  components: readonly CascadeComponent[],
  resolve: ComponentResolver,
  readModel: (path: string) => string | undefined,
  skipPath?: string,
): ModelWrite[] {
  const writes: ModelWrite[] = [];
  for (const c of components) {
    if (c.path === skipPath) continue;
    const current = readModel(c.path) ?? "{}";
    const next = scaffoldModelText(current, c.root, resolve, c.name);
    if (next !== null) writes.push({ path: c.path, text: next });
  }
  return writes;
}
