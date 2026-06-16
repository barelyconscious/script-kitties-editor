/**
 * saveFlow — integration of the save sequencing the F11 Save action performs:
 * persist via save_component, then dispatch `markSaved` ONLY on success, leaving
 * the component dirty (markSaved NOT dispatched) on failure (design risk #5).
 *
 * This mirrors {@link useComponentSave}'s logic without React (the test env is
 * `node`, no DOM): it composes the same pieces — `saveOpenComponent` (mocked
 * invoke) and the real `editorReducer` — so the dirty-clears-on-success /
 * dirty-stays-on-error contract is proven end to end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type GuiNode, parseGui } from "../../lib/guiNode";
import { type EditorState, editorReducer, type OpenComponent } from "./editorState";
import { saveOpenComponent } from "./saveComponent";

function openComponent(): OpenComponent {
  const root: GuiNode = parseGui('<View controller="bag_controller.lua"><Panel id="root"/></View>');
  return {
    name: "bag",
    path: "bag.xml",
    controllerFileName: "bag_controller.lua",
    root,
    modelText: "{}",
    controllerText: "x = 1",
  };
}

function dirtyState(): EditorState {
  return {
    open: openComponent(),
    selectedNodeId: null,
    activeTab: "view",
    dirty: true,
    past: [],
    future: [],
    lastCoalesceKey: null,
  };
}

/**
 * Replicate the hook's save logic: persist, then markSaved only on success.
 * Returns the next state and whether the save landed.
 */
async function runSave(state: EditorState): Promise<{ state: EditorState; ok: boolean }> {
  if (!state.open) return { state, ok: true };
  try {
    await saveOpenComponent(state.open);
    return { state: editorReducer(state, { type: "markSaved" }), ok: true };
  } catch {
    // Deliberately do NOT dispatch markSaved — keep dirty set.
    return { state, ok: false };
  }
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("save flow dirty discipline", () => {
  it("clears dirty on a successful save", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { state, ok } = await runSave(dirtyState());
    expect(ok).toBe(true);
    expect(state.dirty).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith(
      "save_component",
      expect.objectContaining({ name: "bag" }),
    );
  });

  it("KEEPS dirty set when the save errors (design risk #5)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("controller write failed"));
    const { state, ok } = await runSave(dirtyState());
    expect(ok).toBe(false);
    // The half/failed save must keep looking unsaved.
    expect(state.dirty).toBe(true);
  });

  it("does not touch disk when nothing is open", async () => {
    const clean: EditorState = {
      open: null,
      selectedNodeId: null,
      activeTab: "view",
      dirty: false,
      past: [],
      future: [],
      lastCoalesceKey: null,
    };
    const { ok } = await runSave(clean);
    expect(ok).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
