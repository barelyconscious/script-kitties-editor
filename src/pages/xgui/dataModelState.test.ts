/**
 * Tests the Data Model state that feeds BOTH the preview and the panel (task 476).
 *
 * The panel and the preview are NOT two independent copies — they are two views of
 * one `DataModelState`: `text` is what the panel shows, `model` is what the preview
 * resolves bindings against. These tests pin the two rules that keep them
 * consistent: a valid edit advances both, and an INVALID keystroke advances the
 * panel's text (so the user sees their input + the error) while preserving the
 * preview's last-good model (so it never blanks).
 */

import { describe, expect, it } from "vitest";
import { parseGui } from "../../lib/guiNode";
import {
  applyModelEdit,
  type DataModelState,
  initDataModelState,
  seedDataModel,
} from "./dataModelState";

describe("initDataModelState", () => {
  it("seeds text and a parsed model from valid stored JSON", () => {
    const s = initDataModelState('{"health":15}');
    expect(s.text).toBe('{"health":15}');
    expect(s.model).toEqual({ health: 15 });
  });

  it("defaults empty/missing seed to an empty object", () => {
    expect(initDataModelState(undefined)).toEqual({ text: "{}", model: {} });
    expect(initDataModelState("")).toEqual({ text: "{}", model: {} });
  });

  it("keeps unparseable seed text but resolves against an empty model", () => {
    const s = initDataModelState("{ not json");
    expect(s.text).toBe("{ not json");
    expect(s.model).toEqual({});
  });
});

describe("applyModelEdit — one source feeds panel + preview", () => {
  it("advances BOTH text and model on a valid edit", () => {
    const prev: DataModelState = { text: "{}", model: {} };
    const next = applyModelEdit(prev, '{"x":1}');
    // Panel sees the new text...
    expect(next.text).toBe('{"x":1}');
    // ...and the preview sees the matching parsed model — same source, no drift.
    expect(next.model).toEqual({ x: 1 });
  });

  it("preserves the LAST GOOD model when the edit is invalid JSON", () => {
    const good: DataModelState = applyModelEdit({ text: "{}", model: {} }, '{"x":1}');
    // A stray keystroke that breaks the JSON: the panel shows it (so the error is
    // visible), but the preview must keep resolving against the last valid model.
    const broken = applyModelEdit(good, '{"x":1');
    expect(broken.text).toBe('{"x":1');
    expect(broken.model).toEqual({ x: 1 });
  });

  it("recovers the model once the JSON is valid again", () => {
    const broken = applyModelEdit({ text: "{}", model: { x: 1 } }, "{ broken");
    const fixed = applyModelEdit(broken, '{"y":2}');
    expect(fixed.text).toBe('{"y":2}');
    expect(fixed.model).toEqual({ y: 2 });
  });
});

describe("seedDataModel — restore persisted base, then scaffold on top (tasks 482 + 484)", () => {
  // The component references {$.health} and {$.mana} in its tree (View scope).
  const root = parseGui('<View><Text text="{$.health}" texture="{$.mana}"/></View>');

  it("with NO persisted model, scaffolds fresh from the component's modelText", () => {
    // No persisted base, empty modelText → the scaffold fills it from the tree.
    const seeded = seedDataModel(undefined, "", root);
    expect(JSON.parse(seeded.text)).toEqual({ health: "health", mana: "mana" });
    expect(seeded.model).toEqual({ health: "health", mana: "mana" });
  });

  it("RESTORES a persisted model as the base, preferring it over modelText", () => {
    // The persisted model carries the user's edits (a real value for health and an
    // extra key the tree never referenced). Restoring it as the base wins over the
    // component's own modelText.
    const persisted = '{"health":42,"custom":"keep"}';
    const seeded = seedDataModel(persisted, '{"ignored":true}', root);
    const parsed = JSON.parse(seeded.text);
    // The user's edits survive intact...
    expect(parsed.health).toBe(42);
    expect(parsed.custom).toBe("keep");
    // ...the component's own modelText was NOT used as the base.
    expect(parsed.ignored).toBeUndefined();
  });

  it("runs the ADDITIVE scaffold on top of the restored base (new tokens appear)", () => {
    // The persisted model predates the {mana} token — restoring it then scaffolding
    // adds the new token without disturbing the user's existing edits.
    const persisted = '{"health":42}';
    const seeded = seedDataModel(persisted, "", root);
    const parsed = JSON.parse(seeded.text);
    expect(parsed.health).toBe(42); // preserved
    expect(parsed.mana).toBe("mana"); // newly added by the scaffold
  });

  it("keeps the restored base verbatim when the scaffold adds nothing new", () => {
    // The persisted model already covers every referenced token → scaffold is a
    // no-op and the exact persisted text is preserved (no reformat churn).
    const persisted = '{"health":1,"mana":2}';
    const seeded = seedDataModel(persisted, "", root);
    expect(seeded.text).toBe(persisted);
    expect(seeded.model).toEqual({ health: 1, mana: 2 });
  });
});
