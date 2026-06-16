import { describe, expect, it } from "vitest";
import {
  collectFolderOptions,
  collisionMessage,
  flattenTree,
  type GuiFolder,
  indexComponentsByName,
  isValidBasename,
  toComponentBasename,
} from "./guiTree";

/** A small fixture tree:
 *   gui/
 *     bag            (view, at root)
 *     screens/
 *       battle       (view)
 *     widgets/
 *       button       (widget)
 *       cards/
 *         slot       (widget)
 *     empty/         (no children)
 */
function fixture(): GuiFolder {
  return {
    name: "",
    path: "",
    folders: [
      {
        name: "screens",
        path: "screens",
        folders: [],
        components: [
          {
            name: "battle",
            fileName: "battle.xml",
            path: "screens/battle.xml",
            kind: "view",
            controllerFileName: "battle_controller.lua",
          },
        ],
      },
      {
        name: "widgets",
        path: "widgets",
        folders: [
          {
            name: "cards",
            path: "widgets/cards",
            folders: [],
            components: [
              {
                name: "slot",
                fileName: "slot.xml",
                path: "widgets/cards/slot.xml",
                kind: "widget",
                controllerFileName: null,
              },
            ],
          },
        ],
        components: [
          {
            name: "button",
            fileName: "button.xml",
            path: "widgets/button.xml",
            kind: "widget",
            controllerFileName: null,
          },
        ],
      },
      { name: "empty", path: "empty", folders: [], components: [] },
    ],
    components: [
      {
        name: "bag",
        fileName: "bag.xml",
        path: "bag.xml",
        kind: "view",
        controllerFileName: null,
      },
    ],
  };
}

describe("flattenTree", () => {
  it("emits folders before components, depth-first, with correct depths", () => {
    const rows = flattenTree(fixture(), new Set());
    // The root itself is not a row; its folders (screens, widgets, empty) come
    // before its component (bag), each subtree fully expanded first.
    expect(
      rows.map((r) => (r.kind === "folder" ? `F:${r.path}` : `C:${r.component.name}`)),
    ).toEqual([
      "F:screens",
      "C:battle",
      "F:widgets",
      "F:widgets/cards",
      "C:slot",
      "C:button",
      "F:empty",
      "C:bag",
    ]);
    // Depths: top-level folders at 0, their components at the same depth, nested
    // folder at 1, its component at 1.
    const byKey = new Map(
      rows.map((r) => [r.kind === "folder" ? `F:${r.path}` : `C:${r.component.name}`, r.depth]),
    );
    // A folder's components sit ONE level deeper than the folder row (the walk
    // recurses with depth+1), so a component directly inside `screens` is depth 1.
    expect(byKey.get("F:screens")).toBe(0);
    expect(byKey.get("C:battle")).toBe(1);
    expect(byKey.get("F:widgets/cards")).toBe(1);
    expect(byKey.get("C:slot")).toBe(2);
    // Root-level components are depth 0 (the root is walked at depth 0).
    expect(byKey.get("C:bag")).toBe(0);
  });

  it("hides descendants of a collapsed folder but still emits the folder row", () => {
    const rows = flattenTree(fixture(), new Set(["widgets"]));
    const keys = rows.map((r) => (r.kind === "folder" ? `F:${r.path}` : `C:${r.component.name}`));
    // widgets is present but collapsed; its descendants (cards, slot, button) are gone.
    expect(keys).toContain("F:widgets");
    expect(keys).not.toContain("F:widgets/cards");
    expect(keys).not.toContain("C:slot");
    expect(keys).not.toContain("C:button");
    // Sibling subtrees are unaffected.
    expect(keys).toContain("C:battle");
    expect(keys).toContain("C:bag");
    const widgets = rows.find((r) => r.kind === "folder" && r.path === "widgets");
    expect(widgets?.kind === "folder" && widgets.collapsed).toBe(true);
  });

  it("marks an empty folder as having no children", () => {
    const rows = flattenTree(fixture(), new Set());
    const empty = rows.find((r) => r.kind === "folder" && r.path === "empty");
    expect(empty?.kind === "folder" && empty.hasChildren).toBe(false);
  });
});

describe("collectFolderOptions", () => {
  it("always leads with the gui/ root, then every folder depth-first", () => {
    const options = collectFolderOptions(fixture());
    expect(options[0]).toEqual({ path: "", label: "gui/ (root)" });
    expect(options.map((o) => o.path)).toEqual([
      "",
      "screens",
      "widgets",
      "widgets/cards",
      "empty",
    ]);
  });
});

describe("indexComponentsByName", () => {
  it("maps every component basename to its folder path", () => {
    const index = indexComponentsByName(fixture());
    expect(index.get("bag")).toBe("");
    expect(index.get("battle")).toBe("screens");
    expect(index.get("button")).toBe("widgets");
    expect(index.get("slot")).toBe("widgets/cards");
    expect(index.has("missing")).toBe(false);
  });
});

describe("collisionMessage", () => {
  it("returns null when the name is free anywhere in the tree", () => {
    expect(collisionMessage(fixture(), "brand_new")).toBeNull();
  });

  it("names the existing location for a collision in a subfolder", () => {
    expect(collisionMessage(fixture(), "button")).toBe(
      'A component named "button" already exists in widgets/.',
    );
    expect(collisionMessage(fixture(), "slot")).toBe(
      'A component named "slot" already exists in widgets/cards/.',
    );
  });

  it("names the gui/ root for a collision at the root", () => {
    expect(collisionMessage(fixture(), "bag")).toBe(
      'A component named "bag" already exists in the gui/ root.',
    );
  });

  it("is tree-wide: a same-basename in a DIFFERENT folder still collides", () => {
    // Creating "button" in screens/ must still be reported — uniqueness is global.
    expect(collisionMessage(fixture(), "button")).not.toBeNull();
  });
});

describe("toComponentBasename", () => {
  it("lowercases, collapses non-alphanumerics to underscores, and trims them", () => {
    expect(toComponentBasename("Bag Slot")).toBe("bag_slot");
    expect(toComponentBasename("  Health Bar!  ")).toBe("health_bar");
    expect(toComponentBasename("Profile-Card")).toBe("profile_card");
    expect(toComponentBasename("__weird__name__")).toBe("weird_name");
    expect(toComponentBasename("ALLCAPS")).toBe("allcaps");
  });
});

describe("isValidBasename", () => {
  it("accepts lower_snake_case identifiers starting with a letter", () => {
    expect(isValidBasename("bag")).toBe(true);
    expect(isValidBasename("bag_slot")).toBe(true);
    expect(isValidBasename("a1_b2")).toBe(true);
  });

  it("rejects empty, leading-digit, leading-underscore, and uppercase", () => {
    expect(isValidBasename("")).toBe(false);
    expect(isValidBasename("1bag")).toBe(false);
    expect(isValidBasename("_bag")).toBe(false);
    expect(isValidBasename("Bag")).toBe(false);
    expect(isValidBasename("bag slot")).toBe(false);
  });
});
