/**
 * dataModelState — the pure logic behind the always-visible Data Model panel
 * (task 476). The Data Model JSON is ONE source that feeds BOTH the preview's
 * `{token}` resolution AND the panel itself; this module holds the rule for how a
 * keystroke advances that source so it can be unit-tested off the React tree.
 *
 * The model the PREVIEW resolves against is the LAST GOOD parsed JSON: a valid
 * edit advances it, an invalid keystroke leaves it untouched (so a stray character
 * surfaces an error in the panel without blanking the preview). The panel always
 * shows the raw text verbatim (errors included); the preview only ever sees a
 * valid model. Keeping both derived from one `applyModelEdit` is what guarantees
 * the panel and the preview never drift apart.
 */

import { parseDataModel } from "../../lib/guiDataModel";
import type { GuiNode } from "../../lib/guiNode";
import { scaffoldModelText } from "./guiModelScaffold";

/** The Data Model panel's state: the raw text (panel) + the last-good model (preview). */
export type DataModelState = {
  /** The raw JSON text the panel displays — exactly what the user typed. */
  text: string;
  /** The last successfully-parsed model the preview resolves bindings against. */
  model: unknown;
};

/**
 * Seed the Data Model state from a component's stored model text. An empty/missing
 * seed starts from an empty object; an unparseable seed still shows its text but
 * resolves against an empty model until corrected.
 */
export function initDataModelState(seedText: string | undefined): DataModelState {
  const text = seedText && seedText.length > 0 ? seedText : "{}";
  const parse = parseDataModel(text);
  return { text, model: parse.ok ? parse.model : {} };
}

/**
 * Apply a panel edit. The text ALWAYS advances to what the user typed (so the
 * panel reflects their input, including invalid JSON); the model — the value the
 * preview resolves against — advances ONLY when the new text parses, so an invalid
 * keystroke preserves the last good model rather than blanking the preview.
 */
export function applyModelEdit(prev: DataModelState, nextText: string): DataModelState {
  const parse = parseDataModel(nextText);
  return {
    text: nextText,
    model: parse.ok ? parse.model : prev.model,
  };
}

/**
 * Seed the Data Model state when a component opens (tasks 482 + 484): RESTORE the
 * persisted model as the base, then run the additive scaffold/merge ON TOP so tokens
 * added while this component was away still appear.
 *
 *   - `persisted` is the model text saved per component path (task 484), or
 *     `undefined` when none is stored — in which case the component's own
 *     `modelText` is the base, scaffolding FRESH exactly as before persistence.
 *   - `scaffoldModelText` additively merges any tokens the tree references into the
 *     base and returns the rewritten text, or `null` when nothing new is added — in
 *     which case the restored base is kept verbatim (no reformat churn).
 *
 * Pure (no React, no storage): the caller resolves `persisted` from the store and
 * passes the tree, so the restore-then-merge rule is unit-tested off the React tree.
 */
export function seedDataModel(
  persisted: string | undefined,
  modelText: string,
  root: GuiNode,
): DataModelState {
  const seed = initDataModelState(persisted ?? modelText);
  const scaffolded = scaffoldModelText(seed.text, root);
  return scaffolded === null ? seed : applyModelEdit(seed, scaffolded);
}
