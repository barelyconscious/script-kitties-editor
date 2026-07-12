/**
 * guiDataModel — the pure parse step behind the XGUI Data Model panel.
 *
 * The Data Model panel lets the user type raw JSON; that parsed object becomes the
 * flat root model the preview's `{token}` bindings resolve against (see
 * `guiBinding.ts`). Parsing is separated from the React panel so it is unit-testable
 * and so the panel stays a thin controlled `<textarea>`.
 *
 * SCOPE: the parsed value is handed to the preview as the single flat model.
 */

/** The outcome of parsing the Data Model panel's raw JSON text. */
export type DataModelParse = { ok: true; model: unknown } | { ok: false; error: string };

/**
 * Parse the Data Model panel's raw text into a model value.
 *
 * - Empty/whitespace-only text is a valid EMPTY model (`{}`) — a fresh panel with
 *   no bindings yet, not an error. Then every `{token}` renders styled-but-literal.
 * - Valid JSON parses to its value (an object is the common case; arrays/scalars
 *   are accepted but have no fields for a `{$.x}` binding to walk into).
 * - Invalid JSON returns the parser's message so the panel can surface it inline
 *   while keeping the LAST good model live (the caller decides retention policy).
 */
export function parseDataModel(text: string): DataModelParse {
  if (text.trim() === "") return { ok: true, model: {} };
  try {
    return { ok: true, model: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
