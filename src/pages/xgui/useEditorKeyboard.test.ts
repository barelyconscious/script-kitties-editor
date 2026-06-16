import { describe, expect, it } from "vitest";
import { decideKeyCommand, type EditorKeyContext, type KeyChord } from "./useEditorKeyboard";

/** A key chord with no modifiers; override per case. */
function chord(over: Partial<KeyChord> = {}): KeyChord {
  return { key: "s", metaKey: false, ctrlKey: false, shiftKey: false, ...over };
}

/** An active editor with an open, dirty component and full undo/redo available. */
function ctx(over: Partial<EditorKeyContext> = {}): EditorKeyContext {
  return { active: true, hasOpen: true, dirty: true, canUndo: true, canRedo: true, ...over };
}

describe("decideKeyCommand (task 470)", () => {
  describe("gating", () => {
    it("passes through (null) when the editor is not the active tool", () => {
      expect(decideKeyCommand(chord({ metaKey: true }), ctx({ active: false }))).toBeNull();
      expect(
        decideKeyCommand(chord({ key: "z", metaKey: true }), ctx({ active: false })),
      ).toBeNull();
    });

    it("passes through (null) without the primary modifier", () => {
      expect(decideKeyCommand(chord({ key: "s" }), ctx())).toBeNull();
      expect(decideKeyCommand(chord({ key: "z" }), ctx())).toBeNull();
    });

    it("treats ⌘ (mac) and Ctrl (win/linux) as the primary modifier alike", () => {
      expect(decideKeyCommand(chord({ key: "s", metaKey: true }), ctx())).toBe("save");
      expect(decideKeyCommand(chord({ key: "s", ctrlKey: true }), ctx())).toBe("save");
    });

    it("is case-insensitive on the key (uppercase from a held Shift on letters)", () => {
      expect(decideKeyCommand(chord({ key: "S", metaKey: true }), ctx())).toBe("save");
      expect(decideKeyCommand(chord({ key: "Z", metaKey: true, shiftKey: true }), ctx())).toBe(
        "redo",
      );
    });
  });

  describe("save (Cmd/Ctrl+S)", () => {
    it("returns 'save' when a component is open and dirty", () => {
      expect(decideKeyCommand(chord({ key: "s", metaKey: true }), ctx())).toBe("save");
    });

    it("returns 'swallow' (no-op, but preventDefault) when nothing is open", () => {
      expect(decideKeyCommand(chord({ key: "s", metaKey: true }), ctx({ hasOpen: false }))).toBe(
        "swallow",
      );
    });

    it("returns 'swallow' when the component is open but NOT dirty", () => {
      expect(decideKeyCommand(chord({ key: "s", metaKey: true }), ctx({ dirty: false }))).toBe(
        "swallow",
      );
    });
  });

  describe("undo (Cmd/Ctrl+Z)", () => {
    it("returns 'undo' when undo is available", () => {
      expect(decideKeyCommand(chord({ key: "z", metaKey: true }), ctx())).toBe("undo");
    });

    it("returns 'swallow' when the undo stack is empty", () => {
      expect(decideKeyCommand(chord({ key: "z", metaKey: true }), ctx({ canUndo: false }))).toBe(
        "swallow",
      );
    });

    it("passes through (null) when no component is open", () => {
      expect(
        decideKeyCommand(chord({ key: "z", metaKey: true }), ctx({ hasOpen: false })),
      ).toBeNull();
    });
  });

  describe("redo (Cmd/Ctrl+Shift+Z and Ctrl/Cmd+Y)", () => {
    it("returns 'redo' for Cmd/Ctrl+Shift+Z", () => {
      expect(decideKeyCommand(chord({ key: "z", metaKey: true, shiftKey: true }), ctx())).toBe(
        "redo",
      );
    });

    it("returns 'redo' for Ctrl/Cmd+Y", () => {
      expect(decideKeyCommand(chord({ key: "y", ctrlKey: true }), ctx())).toBe("redo");
    });

    it("returns 'swallow' when the redo stack is empty", () => {
      expect(
        decideKeyCommand(
          chord({ key: "z", metaKey: true, shiftKey: true }),
          ctx({ canRedo: false }),
        ),
      ).toBe("swallow");
    });

    it("Shift+Z is redo, NOT undo (distinguishes the two on the same key)", () => {
      const redo = decideKeyCommand(chord({ key: "z", metaKey: true, shiftKey: true }), ctx());
      const undo = decideKeyCommand(chord({ key: "z", metaKey: true, shiftKey: false }), ctx());
      expect(redo).toBe("redo");
      expect(undo).toBe("undo");
    });
  });

  it("ignores unrelated modified keys (e.g. Cmd+A) — null pass-through", () => {
    expect(decideKeyCommand(chord({ key: "a", metaKey: true }), ctx())).toBeNull();
  });
});
