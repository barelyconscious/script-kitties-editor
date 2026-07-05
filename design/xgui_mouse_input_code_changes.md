# XGUI Mouse Input & Tooltips — Code Changes

Companion to [xgui_mouse_input.md](xgui_mouse_input.md) (stages, rationale, definitions of done). Paths are relative to `worlds-cpp/worlds-cpp/`. This document is crisp, not exhaustive — but every assumption an implementer would otherwise have to make is validated in the first section, against the code as of branch `xgui` (2026-07-04).

## Validated assumptions (checked against source — do not re-derive)

1. **Frame order is Input → HandleInput → Update → Render** (`Game.cpp:277–286`). Hit-testing therefore consumes *last frame's* bounds — acceptable one-frame staleness, but bounds are zero until the first `Update`. Guard: compute bounds once at mount (see GUILoader changes) or skip input until first update.
2. **Mouse coordinates are already in UI space.** The renderer sets `SDL_RenderSetLogicalSize(_renderer, 1280, 768)` (`Renderer.cpp:80`, sizes from `Game.cpp:5–6`), and SDL2 scales *mouse event* coordinates to logical space automatically. `Input` reads event coords (`Event.button.x`), so no window→UI transform is needed anywhere. Do not add one.
3. **`Input::Update` corrupts the mouse position**: `MouseEvent.X = Event.button.x; MouseEvent.Y = Event.button.y;` runs for **every** polled event including keyboard (`Input.cpp:162–163`) — a union misread. Must be fixed (Stage 0). Related pre-existing hazard, out of scope but known: the shift-Q quit check reads `Event.key.keysym.sym` on non-key events (`Input.cpp:157`).
4. **`FMouse` has `{X, Y, Button}`** (`Mouse.h`), but `Button` is assigned only on `SDL_MOUSEBUTTONUP` (`Input.cpp:173`); `MouseDownAt` (`Input.cpp:165–168`) snapshots `MouseEvent` *before* `Button` is set, so the press record carries a stale button. `MouseDownAt` is never cleared (holds forever after first press). `FMouse::operator==` ignores `Button` (fine — `MouseMoved()` depends on it).
5. **XGUI bounds math is wrong** (`XGUI.cpp:41–46`): position uses `Parent.x * rel + abs`. The proven-correct reference is LGUI's `Widget::Resize` (`LGUITypes.cpp:543–546`): `X = Parent.x + rel * Parent.w + abs`. XGUI's size math (`Parent.w * rel + abs`) already matches.
6. **`RenderNode` ignores `Layer`, `TextAlign`, `bWrap`, `BorderSize` thickness** (`XGUI.cpp:55–99`): plain pre-order recursion; text drawn via `Renderer::DrawText(text, x, y, fontSize, color)` only. `FWidget` parses and binds all of these already (`GUILoader.cpp:411–456`).
7. **`Element` structure** (`XGUI.h`): `Id` (local, not hierarchical), `FWidget`, cached `SDL_Rect Bounds`, raw `Element* Parent`, `vector<shared_ptr<Element>> Children`, `shared_ptr<ViewHandle> View`, `vector<unique_ptr<IRuntimeBinding>> RuntimeBindings`. `GUI` and `GUILoader` are friends. No interaction state exists.
8. **The declaring-view trap is real**: for `<Panel>`/`<Text>`, `Element::View` is shared from the parent (`GUILoader.cpp:314, 329`) — the element's view IS the scope its attributes were authored in. For `<Component>` elements, `LoadView` overwrites the element's `View` with the mounted child's fresh ViewHandle (`GUILoader.cpp:211`), and child scope keys can shadow parent keys in the merged `ScopeContext` (both commonly use the anonymous `"$"`). So anything authored ON the `<Component>` tag (handlers, position/size) must resolve against the **parent's** view, which the element no longer points to.
9. **`<Component>` elements currently ignore their own `position`/`size`/`visible`/`layer` attributes**: `LoadComponent` (`GUILoader.cpp:222–248`) builds a bare default `FWidget` (size `1,1,0,0` = fill parent) and attaches no bindings. Only `id`, `src`, `data` are read (`GUILoader.cpp:268–287`).
10. **`GridLayout` stamping**: `AddGridLayout` (`GUILoader.cpp:334–374`) stamps the single template child rows×columns times with ids `{id}#{i}` and per-instance scope paths built from `ScopePrefix` + `dataCollection` + index (e.g. `packs.3`). Attribute expressions get the instance scope injected via `WithScopePrefix` (`GUILoader.cpp:467–493`), which prefixes **inside every `{...}`**. Consequence: handler-name attributes must NOT pass through `WithScopePrefix` (they're literal function names); `tooltipData` MUST (it's a scope path). The per-instance scope path is currently not stored on the `Element` — dispatch needs it (see below).
11. **Hot reload** re-mounts subtrees by clearing `Children` and re-running `LoadView` (`GUILoader.cpp:74–99`); `FileWatchers` tracks every loaded filepath including controllers. Anything holding `Element`/`ViewHandle` references across frames must hold `weak_ptr`. Controller tables are re-created on reload → handler dispatch must resolve function names at dispatch time, never cache `sol::function`s at load.
12. **`ViewHandle` capabilities** (`XGUITypes.h:192–246`): `GetScopeContext()`, `FindInModel<T>(scopedPath)` (path form `$scope.a.b`), `SetModel`, `GetController()` → `FController{Filepath, sol::table}`. `DynamicBindingResolver` resolves per-`Update` against the live scope context (`XGUIRuntimeBinding.h:158–242`) — this is what makes tooltip re-seed-by-`SetModel` and live tooltip updates free.
13. **Renderer**: `DrawTextWrapped(text, SDL_Rect, fontSize, color)` **already exists** (`Renderer.h:61`); fonts cached by size (`Renderer.h:22`); SDL_ttf linked. No text-measurement API exposed. `DrawBox`, `DrawSpriteTexture` are what `RenderNode` uses.
14. **LGUI precedents to keep/drop**: `Contains` is a simple rect test (`LGUITypes.cpp:51–55`) — keep. Click = `Contains(MouseDownAt) && IsMouseClicked()` (`LGUI.cpp:212`) — keep, upgraded with capture. `OnMouseClicked` returns bool = consume (`LGUI.cpp:214–218`) — keep as the Lua `return true` convention. LGUI's `onKeyPressed` fires every frame passing `Input` (`LGUITypes.cpp:383–405`) — **drop**; XGUI fires on key-press edges only.
15. **Sol plumbing**: `sol_lua_push` exists for `Dim`/`Color` (`XGUITypes.h:258+`); building the `mouse` table and key table follows the same pattern. `RegisterLib` (`XGUI.cpp:142`) is where any new Lua surface goes.

---

## Changes by file

### `Input.h` / `Input.cpp` — Stage 0

- Guard the per-event reads in `Update()` by event type: `SDL_MOUSEMOTION` → `Event.motion.x/y`; `SDL_MOUSEBUTTONDOWN`/`UP` → `Event.button.x/y`. Nothing else touches `MouseEvent`.
- On `SDL_MOUSEBUTTONDOWN`: set `MouseEvent.Button = Event.button.button` **before** snapshotting `MouseDownAt`; add a `bPressed` edge flag (true only on frames a button-down was polled), exposed as `IsMousePressed()`.
- Add `IsMouseDown()` (current held state; track on down/up) — needed by capture release logic.
- Keep `IsMouseClicked()` semantics (release-edge) as is.

### `XGUI.h` — Element & GUI structure (Stages 2, 4–7)

`Element` additions (keep `FWidget` pure render data):

- `struct FInteraction` member (or inline fields): fixed array/map of handler names keyed by event kind (`enum class EHandler { MouseClicked, MouseEntered, MouseExited, MouseMoved, KeyPressed }`); `optional<bool> MouseEnabledOverride`; derived `bool bInteractive` (any handler or tooltip present, unless overridden); `string TooltipSrc; string TooltipExpr; string TooltipDataPath` (post-`WithScopePrefix`).
- `weak_ptr<ViewHandle> DeclaringView` — the view whose controller owns this element's handler names and whose scopes its own attributes resolve in. For panels/texts: same as `View`. For `<Component>` elements: the **parent's** view (assumption 8). Handler dispatch and Component-attr bindings use `DeclaringView`, never `View`.
- `string ScopePath` — the instance scope prefix this element was stamped with (`""` outside collections, `"packs.3"` inside). Set in `GetElement`/`LoadComponent` from `ScopePrefix`. Used at dispatch to resolve `targetItemData` via `DeclaringView->FindInModel<sol::table>(...)`.
- Cached sibling paint order: `vector<Element*> SortedChildren; bool bSortDirty; int LastLayer;` — `UpdateNode` compares `Widget.Layer` before/after `ApplyRuntimeBindings` and dirties the **parent's** sort when it changed.

`GUI` additions:

- `vector<weak_ptr<Element>> HoverPath;` (root→leaf order), `weak_ptr<Element> Captured;`, `weak_ptr<Element> PressedOn;` (click pairing), flat `vector<weak_ptr<Element>> Interactive;` + `bool bInteractiveDirty;` (rebuilt by walking the tree; dirtied by `GUILoader::Reload` — expose a `MarkTreeDirty()` for the loader, they're already friends).
- `shared_ptr<Element> OverlayRoot;` — sibling of `Root`, same 1280×768 bounds. Rendered after `Root` in `Render`; hit-tested first in `HandleInput`. Overlay entries carry `bInteractive`/`bModal` flags (a tiny `FOverlayMeta` alongside each overlay child, or fields on `Element` defaulted inert).
- Tooltip controller state: `struct FTooltip { weak_ptr<Element> Provider; enum State { Idle, Arming, Shown } State; uint64 ArmAtTicks; uint64 WarmUntilTicks; unordered_map<string, shared_ptr<Element>> Pool; }` (pool keyed by src basename; pooled entries live under `OverlayRoot`, hidden).

### `XGUI.cpp` — Stages 1, 3–7, 9

- **`UpdateNode`**: fix position math to `Parent.x + rel * Parent.w + abs` (assumption 5). After `ApplyRuntimeBindings`, layer-change check → dirty parent sort. Also update `OverlayRoot` subtree (called from `Update`).
- **`RenderNode`**: iterate `SortedChildren` (recompute on `bSortDirty`: stable sort by `(Widget.Layer, original index)`). Render `Root`, then `OverlayRoot`. Honor `bWrap` via `DrawTextWrapped` and `TextAlign` when Stage 8 lands.
- **`HandleInput`** — the core. Order per frame:
  1. If `Captured` alive: route move/click to it directly (no hit test), release capture on mouse-up. Else:
  2. Hit test on `MouseMoved() || IsMousePressed() || IsMouseClicked()`: overlays first (interactive ones only; a modal overlay that isn't hit swallows the event), then the tree — walk `SortedChildren` in reverse, depth-first children-before-self, skipping `!bVisible` subtrees; an element hits if `bInteractive` (post-override) and point-in-`Bounds` (LGUI's `Contains` logic). **No parent-rect pruning** (no clipping — children overflow).
  3. Build new hover path = ancestor chain of the hit; diff vs `HoverPath`: exits bottom-up on removed, enters top-down on added; `onMouseMoved` to the target. Feed the path to the tooltip controller.
  4. On `IsMousePressed()`: `PressedOn = hit; Captured = hit` (if interactive).
  5. On `IsMouseClicked()`: if release-hit element == `PressedOn` → **bubble dispatch** (below). Clear `PressedOn`.
- **Bubble dispatch** (one function): walk target → root; for each element with a handler name for the kind: `Controller[name]` looked up **by name now** on `DeclaringView->GetController()` (assumption 11); call as `protected_function(mouseTbl, targetId, targetItemData, currentId)`; truthy return → stop. `mouseTbl = {x=, y=, button=}` built via `lua.create_table_with`. `targetItemData`: if target's `ScopePath` non-empty, `DeclaringView->FindInModel<sol::table>(scope + "." + path)` resolved once per dispatch, else nil. Log-and-continue on invalid handler results (LGUI's error pattern, `Notif::ToastError` included).
- **`Update`**: existing binding/bounds pass (+ overlay), then tooltip state machine tick (uses `TickArgs`/`SDL_GetTicks64`): Arming→Shown at `ArmAtTicks` (bypass delay if within `WarmUntilTicks`); hide on provider death/invisibility; placement pass on show (below).
- **Tooltip controller** (recommend a separate `XGUITooltip.h/.cpp`, owned by `GUI`):
  - Provider resolution: nearest element in the hover path (leaf-ward) with `TooltipSrc` or `TooltipExpr`.
  - Show: pool lookup by src basename; on miss, mount via the loader's component path into `OverlayRoot` (needs a `GUILoader*` back-reference or a mount callback — `XScene` owns both, simplest is `GUI` holding a non-owning `GUILoader*` set at `CreateGUI`). On hit, `View->SetModel(resolvedTooltipData)`. Resolve `tooltipData` via provider's `DeclaringView->FindInModel<sol::table>` (same mechanics as `LoadComponent`'s `data=`, `GUILoader.cpp:228–244`).
  - Text sugar: `TooltipExpr` routes to an engine-default card (checked-in `gui/engine/tooltip.text.xml` or built in code); its text binding is created with `ScalarRuntimeBinding<string>::FromExpression(TooltipExpr, &FWidget::Text)` — the expression was already scope-prefixed at parse, and `Apply` runs against the provider's scope context.
  - Placement: after seed, run one `UpdateNode` on the card subtree to realize bounds; anchor below-right of provider `Bounds`; flip above if bottom edge > 768; clamp X to [0, 1280 − w]. Root absolute-size validation happens at mount (warn if `rel1/rel2 != 0`).
  - Hide triggers: provider leaves hover path; `IsMousePressed()`; provider `weak_ptr` dead; pool entry invalidated by reload. Set `WarmUntilTicks` on hide.
- **`onKeyPressed` (Stage 9)**: in `HandleInput`, if `Input.GetKeyPressed()` has a value, dispatch to every visible element with a `KeyPressed` handler (iterate the flat interactive list; no hit test, no bubbling), passing `{char=, scancode=}`.

### `GUILoader.h` / `GUILoader.cpp` — Stage 2 (+ tooltip/reload hooks)

- **`XWidget`**: add getters for the five handler attrs + `mouseEnabled` (raw, **no** `WithScopePrefix`) and `tooltip`/`tooltipData` (**with** `WithScopePrefix`), `tooltipSrc` (raw). `GetElement` populates the `Element` interaction fields, sets `ScopePath = ScopePrefix`, and sets `DeclaringView` (pass the parent's view in — `GetElement` currently doesn't receive the parent; extend the signature or set it in `GetPanel`/`GetText` where `Parent->View` is at hand, alongside the existing `WNode->View = Parent->View`).
- **`LoadComponent` / `AddChildElement` (Component branch)**: read the Component node's own `position`/`size`/`visible`/`layer` (+ handler/tooltip attrs) and attach the same runtime bindings `GetElement` builds — but these bindings and handlers belong to the **parent's** scope, so: set `DeclaringView = Parent->View` *before* `LoadView` overwrites `Element::View`, and make `ApplyRuntimeBindings` use `DeclaringView` (for panels they're identical, so this is a safe global switch — see `XGUI.cpp:129–140` where it currently uses `GetView()`).
- **Parse-time handler validation**: optionally verify the named function exists on the declaring controller at load (the `<Event>` loader already does exactly this, `GUILoader.cpp:183–198`) — warn, don't throw, since hot reload may add it later.
- **`Reload`**: after re-mounting, call `GUI::MarkTreeDirty()` (interactive list + sorted orders) and notify the tooltip pool: any pooled src whose file reloaded → drop the pooled instance, hide if showing. Pooled tooltip files enter `FileWatchers` automatically by being loaded through `LoadView` — verify the tracker's `Root` weak_ptr points at the pooled overlay element so reload re-mounts it in place (then "drop from pool" simplifies to "hide if showing").
- **First-frame bounds** (assumption 1): after `CreateGUI` builds the tree, run one bounds pass (call `Update`-equivalent once) so `HandleInput` never sees zeroed rects.

### `Renderer.h` / `Renderer.cpp` — Stage 8

- `Vector2<int> MeasureText(const string&, int fontSize) const` → `TTF_SizeUTF8(GetFont(fontSize), ...)`.
- `int MeasureTextWrappedHeight(const string&, int width, int fontSize) const` → `TTF_RenderUTF8_Blended_Wrapped`-consistent line math (or render-to-surface once and take `h`; it's cached-per-string anyway via `TextureByString` if extended).

### `XGUITypes.h` / `XGUIRuntimeBinding.h`

- No structural changes required. Reused as-is: `FScopeLookup`/`FindInModel` (item-data + tooltipData resolution), `ScalarRuntimeBinding<string>::FromExpression` (text-tooltip sugar), `DynamicBindingResolver` (live tooltip updates via `SetModel`).
- Optional: `sol_lua_push` helper for `FMouse` if the mouse table gets built in more than one place.

### `XScene.cpp`

- No changes expected: `HandleInput`/`Update`/`Render` forwarding already in place (`XScene.cpp:19–47`). Only touch if the `GUILoader*` back-reference for tooltip mounting is wired here rather than in `CreateGUI`.

### Test/demo assets — `gui/kittypacks/` (worlds-cpp repo)

- `gui.kittypacks.xml`: add `onMouseClicked` (+ a right-click case) and `tooltipSrc`/`tooltipData` to the `GridLayout` template panel; add `onMouseClicked` on the `<Component id="btn">` to exercise declaring-view dispatch and bubbling out of `gui.button.xml`.
- New `gui/kittypacks/tooltip.pack-card.xml`: root panel with absolute size (e.g. `size="0,0,280,140"`), bound name/description/sprite — the rich-tooltip acceptance asset.
- `controller.kittypacks.lua`: implement handlers against the full signature `(mouse, targetId, targetItemData, currentId)`; return `true` from one to demonstrate consume.
- Register new XML in `assets.json` (components resolve through the manifest — `LoadAsset`, `GUILoader.cpp:278–283`).

---

## Contracts (freeze before implementation)

1. `handler(mouse, targetId, targetItemData, currentId)`; truthy return consumes. `mouse = {x, y, button}` with SDL button numbering (1=left, 3=right).
2. `tooltipData` = value-boundary semantics of `<Component data=...>`: resolved in the provider's scope at show time, seated as the card's fresh model root.
3. Tooltip component roots declare absolute pixel size; no controller on tooltip components (v1).
4. Handler names and `tooltipSrc` are literal-only attributes (never scope-prefixed, never bindable); `tooltip` and `tooltipData` are scope-prefixed like every bindable attribute.
5. Enter/exit do not bubble; they fire from hover-path diffing. Move/click bubble target→root.

## Known hazards for the implementer (each validated above)

- Never cache `sol::function` handlers across frames (reload swaps controller tables) — assumption 11.
- Never resolve Component-tag attributes or handlers via `Element::View` — assumption 8 (`DeclaringView` exists for this).
- Never prune hit-test recursion by parent rect — no clipping; children overflow.
- Tooltip overlay entries must be hit-transparent or hover flickers (the tooltip steals the hover that shows it).
- `WithScopePrefix` rewrites every `{...}` — routing a handler-name attribute through it corrupts the name; routing `tooltipData` around it breaks per-instance tooltips in `GridLayout`.
- `MouseDownAt` never clears; click pairing must use `PressedOn`/capture, not `MouseDownAt.has_value()`.
