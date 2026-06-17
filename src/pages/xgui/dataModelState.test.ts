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
import { applyModelEdit, type DataModelState, initDataModelState } from "./dataModelState";

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
