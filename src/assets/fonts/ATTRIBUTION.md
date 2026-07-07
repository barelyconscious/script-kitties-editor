# Preview font attribution

`Web437_IBM_VGA_9x16.woff` is the **Web437 "IBM VGA 9x16"** webfont from
**The Ultimate Oldschool PC Font Pack** by **VileR**.

- Source: <https://int10h.org/oldschool-pc-fonts/>
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
  — full text in `Web437-LICENSE.txt`.
- © 2016–2020 VileR.

## Why it's here

The `worlds-cpp` game engine renders all GUI text with `vgaoem.fon` — the classic
VGA OEM / DOS raster font (code page 437). Browsers can't load `.fon` files, so the
XGUI preview uses this pixel-accurate open reproduction of the same font to match
how text looks in-game. The preview also applies a horizontal stretch to the glyphs
(in `GuiPreview.tsx`) because the game renders the font with noticeably wider cells
than the base 9×16 proportions; the 9×16 variant (vs 8×16) provides the correct
inter-glyph spacing so that stretch reads cleanly.

## License notes

The font file is bundled **unmodified**. Under CC BY-SA 4.0, ShareAlike applies only
to adaptations of the font itself, not to software that merely displays text with it,
so bundling it here imposes no license obligation on the editor beyond this
attribution. Do not re-subset or re-convert the `.woff` in-tree; ship it as-is to keep
that boundary clean.
