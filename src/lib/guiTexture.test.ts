/**
 * Texture-resolution path: the `texture` attribute flows through F3's
 * `resolveAttrs` (interpolation / token binding) and then `textureToLoad` decides
 * the sprite name the preview loads — a literal, a resolved interpolation, or a
 * resolved {token}-bound value loads; an empty or unresolved value loads nothing.
 *
 * This is the pure half of the GuiBox texture render (the React shell just feeds
 * the result to `useSprite`), so it is exercised here without rendering.
 */
import { describe, expect, it } from "vitest";
import { flatRootScope, resolveAttrs } from "./guiBinding";
import { textureToLoad } from "./guiGeometry";

/** Resolve a node's attrs, then run the texture-load decision the renderer makes. */
function textureNameFor(rawAttrs: Record<string, string>, model: unknown): string | null {
  const { attrs, unresolved } = resolveAttrs(rawAttrs, flatRootScope(model), {});
  return textureToLoad(attrs.texture, !unresolved.has("texture"));
}

describe("texture resolution → load decision", () => {
  it("loads a LITERAL texture filename (with extension)", () => {
    // Abilities/items/charms store the full filename WITH extension.
    expect(textureNameFor({ texture: "ability_bite.png" }, {})).toBe("ability_bite.png");
    expect(textureNameFor({ texture: "gui_kittycoin.png" }, {})).toBe("gui_kittycoin.png");
  });

  it("loads an INTERPOLATED texture once its embedded token resolves", () => {
    // texture="icon_{type}.png" with model {type:"bite"} → icon_bite.png.
    expect(textureNameFor({ texture: "icon_{type}.png" }, { type: "bite" })).toBe("icon_bite.png");
  });

  it("loads a whole-{token}-BOUND texture (resolved to a filename)", () => {
    expect(textureNameFor({ texture: "{spriteName}" }, { spriteName: "gui_kittycoin.png" })).toBe(
      "gui_kittycoin.png",
    );
  });

  it("loads NOTHING for an interpolated texture whose token is unbound", () => {
    // The unresolved value keeps its literal {token} — not a real filename — so the
    // box paints no texture (and its waiting-for-binding affordance fires instead).
    expect(textureNameFor({ texture: "icon_{type}.png" }, {})).toBeNull();
  });

  it("loads NOTHING for an unbound whole-{token} texture", () => {
    expect(textureNameFor({ texture: "{spriteName}" }, {})).toBeNull();
  });

  it("loads NOTHING when the texture attribute is absent", () => {
    expect(textureNameFor({ backgroundColor: "0,0,0,255" }, {})).toBeNull();
  });

  it("loads NOTHING for an empty / whitespace-only texture", () => {
    expect(textureNameFor({ texture: "" }, {})).toBeNull();
    expect(textureNameFor({ texture: "   " }, {})).toBeNull();
  });
});
