import { describe, expect, it } from "vitest";
import {
  defaultControllerFileName,
  exportedFunctionNames,
  normalizeControllerFileName,
} from "./controllerScript";

describe("defaultControllerFileName", () => {
  it("appends _controller.lua to the snake_case component name", () => {
    expect(defaultControllerFileName("bag")).toBe("bag_controller.lua");
  });

  it("snake_cases a mixed-case / spaced component name", () => {
    expect(defaultControllerFileName("Bag Slot")).toBe("bag_slot_controller.lua");
  });
});

describe("normalizeControllerFileName", () => {
  it("appends .lua when missing", () => {
    expect(normalizeControllerFileName("bag_controller")).toBe("bag_controller.lua");
  });

  it("keeps an existing .lua suffix without double-suffixing", () => {
    expect(normalizeControllerFileName("bag_controller.lua")).toBe("bag_controller.lua");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeControllerFileName("  custom.lua  ")).toBe("custom.lua");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeControllerFileName("   ")).toBe("");
  });
});

describe("exportedFunctionNames", () => {
  // The real controller shape: `return function(view) … return { … } end` — the
  // returned table's keys are the exported handler names. See
  // worlds-cpp/gui/kittypacks/controller.kittypacks.lua.
  const REAL_CONTROLLER = `return function(view)
    local model = {
        creature = {
            name = "CaliGO",
            sprite = "caligo.png",
            hovered = false
        }
    }
    view:setModel(model)

    return {
        onKeyPressed = function(self, input)
        end,

        handleFocus = function(self)
            view:getModel().creature.hovered = true
        end,
        handleBlur = function(self)
            view:getModel().creature.hovered = false
        end,

        handleOnEnter = function(self, mouse)
        end,
        handleOnExited = function(self, mouse)
        end,

        handleOnBattleStart = function(battle)
        end,

        handleSelectedCreatureChanged = function(selectedCreature)
        end,

        handleOnClick = function(mouse)
            print("Mouse clicky")
        end
    }
end
`;

  it("extracts every returned-table handler key in source order", () => {
    expect(exportedFunctionNames(REAL_CONTROLLER)).toEqual([
      "onKeyPressed",
      "handleFocus",
      "handleBlur",
      "handleOnEnter",
      "handleOnExited",
      "handleOnBattleStart",
      "handleSelectedCreatureChanged",
      "handleOnClick",
    ]);
  });

  it("does NOT match the outer `return function(view)` wrapper", () => {
    expect(exportedFunctionNames(REAL_CONTROLLER)).not.toContain("function");
    expect(exportedFunctionNames(REAL_CONTROLLER)).not.toContain("view");
  });

  it("does NOT match non-function table fields (string/table values)", () => {
    const names = exportedFunctionNames(REAL_CONTROLLER);
    expect(names).not.toContain("name");
    expect(names).not.toContain("sprite");
    expect(names).not.toContain("creature");
    expect(names).not.toContain("model");
  });

  it("captures a handler assigned to a named local", () => {
    const src = `local onClick = function(self) end
return function(view)
    return { onMouseClicked = onClick }
end`;
    expect(exportedFunctionNames(src)).toEqual(["onClick"]);
  });

  it("tolerates whitespace around the equals and function keyword", () => {
    const src = "return { a  =\n  function() end, b=function() end }";
    expect(exportedFunctionNames(src)).toEqual(["a", "b"]);
  });

  it("de-duplicates a name that appears more than once", () => {
    const src = "local f = function() end\nreturn { f = function() end }";
    expect(exportedFunctionNames(src)).toEqual(["f"]);
  });

  it("returns an empty list for a controller with no handlers", () => {
    expect(exportedFunctionNames("return function(view) return {} end")).toEqual([]);
    expect(exportedFunctionNames("")).toEqual([]);
  });
});
