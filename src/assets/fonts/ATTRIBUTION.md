# Preview font

`BaconSans.ttf` is the **game's own GUI font** — authored for `worlds-cpp` and
rendered by its engine through SDL_ttf (`TTF_OpenFont("BaconSans.ttf")`). It is
bundled here **unmodified**, copied straight from the `worlds-cpp` repo.

## Why it's here

The `worlds-cpp` engine draws all GUI text with `BaconSans.ttf` at the authored
pixel size. The XGUI preview loads that exact `.ttf` so glyph shapes, character
widths, and word-wrap in the preview match the engine's own TTF metrics 1:1 (see
`src/pages/xgui/GuiPreview.tsx` and `App.css`). Keep this file in sync with the
copy in `worlds-cpp` if the game font is updated.
