import { describe, expect, it } from "vitest";
import { parseDataModel } from "./guiDataModel";

describe("parseDataModel", () => {
  it("parses a JSON object into a model", () => {
    const result = parseDataModel('{"health": 15, "maxHealth": 25}');
    expect(result).toEqual({ ok: true, model: { health: 15, maxHealth: 25 } });
  });

  it("treats empty / whitespace-only text as a valid empty model", () => {
    expect(parseDataModel("")).toEqual({ ok: true, model: {} });
    expect(parseDataModel("   \n  ")).toEqual({ ok: true, model: {} });
  });

  it("reports invalid JSON as an error (not a throw)", () => {
    const result = parseDataModel("{ not json ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/./);
  });

  it("accepts arrays and scalars (no top-level binding keys, but valid)", () => {
    expect(parseDataModel("[1,2,3]")).toEqual({ ok: true, model: [1, 2, 3] });
    expect(parseDataModel("42")).toEqual({ ok: true, model: 42 });
  });
});
