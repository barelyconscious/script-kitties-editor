# XGUI Mouse Input & Tooltips — Roadmap

Companion document: [xgui_mouse_input_code_changes.md](xgui_mouse_input_code_changes.md) (per-file change list with validated assumptions).

## Goal

Production-ready mouse support for the XGUI runtime in `worlds-cpp`: hit-testing, hover, clicks (left and right), event propagation (bubbling), and **rich component-based tooltips** rendered above everything else. "Production-ready" here means: correct under overlap and layering, correct across `<Component>` boundaries and `GridLayout`-stamped instances, correct under hot reload, no per-frame allocation in the input path, and a controller-facing contract we will not have to break later.

## Design decisions already made (locked)

These were worked through in review and are treated as settled by the stages below:

1. **Hit-targets are derived, not declared.** An element is hit-testable iff it carries at least one mouse handler attribute (`onMouseClicked`, `onMouseEntered`, `onMouseExited`, `onMouseMoved`) or a tooltip attribute (`tooltip`/`tooltipSrc`). An explicit `mouseEnabled="true|false"` attribute overrides in either direction (`true` = opaque blocker with no handlers, e.g. a modal scrim; `false` = hit-transparent decoration, e.g. a label over a button).
2. **Hit order is the exact reverse of paint order**, and both come from one shared sibling ordering: `(resolvedLayer asc, child index asc)` — the same nested per-sibling z-order model the editor ships (`guiZOrder.ts`). Render and hit-test may never use different orderings.
3. **Events bubble.** The topmost interactive element under the cursor is the *target*; dispatch walks the parent chain target → root, invoking each level's handler for that event kind, resolved against **that level's own controller**. A handler returning `true` consumes the event and stops propagation.
4. **Handler signature (the contract):** `handler(mouse, targetId, targetItemData, currentId)` where `mouse = {x, y, button}`, `targetId` is the hit element's id, `targetItemData` is the hit element's item-scope data (the `GridLayout`/`forEach` instance's item, nil outside a collection), and `currentId` is the id of the element whose handler is running (differs from `targetId` during bubbling). This is controller-facing API; it ships complete on day one because retrofitting it breaks every written controller.
5. **Hover is a path, not an element.** The hovered state is the ancestor chain of the topmost hit. On mouse move the old and new paths are diffed: `onMouseExited` fires bottom-up on elements leaving the path, `onMouseEntered` top-down on elements joining it. Enter/exit do not bubble (the path diff replaces bubbling for hover, as in DOM `mouseenter`/`mouseleave`).
6. **Click = press and release inside the same element** (LGUI's semantics, kept). Right-click is a click with `mouse.button == 3`; handlers discriminate on the button field.
7. **Tooltips are rich-first.** The component mount (`tooltipSrc` + `tooltipData`) is the tooltip system; plain-text `tooltip="..."` is sugar routed through the same pipeline via an engine-default card. Tooltips live in an **overlay root** outside the document tree (the nested layer model deliberately cannot lift a deep element above a sibling branch — overlays are the escape hatch, as in every production UI framework).
8. **Tooltip component conventions:** root panel must declare an absolute pixel size; tooltip components are presentation-only (no controller) in v1 — the host controller pre-shapes data; `tooltipData` follows the `<Component data=...>` value-boundary semantics (resolved in the provider's scope, seeded as the tooltip's fresh root).
9. **Tooltips pool and re-seed.** One mount per distinct `tooltipSrc` (lazy), then `SetModel` + reposition on subsequent shows. No per-hover parsing or allocation. Live model mutation updates a visible tooltip automatically (the dynamic-binding architecture gives this for free).

## Proposed exclusions — NOT punted silently, listed for explicit sign-off

Per the "nothing gets punted without a conversation" rule, these are the only things deliberately left out, each with the reason and the seam that keeps it cheap later:

| Excluded | Why | Seam kept open |
|---|---|---|
| **Keyboard focus / tab navigation** | Nothing in the design doc or current screens needs focus. `onKeyPressed` (which IS a design-doc requirement) ships **without** focus: it fires on key-press edges and is broadcast to every element subscribing to it, matching LGUI's non-focused semantics. | Focus becomes "route key events to one element first, then broadcast" — additive, no contract change. |
| **Capture phase (DOM-style trickle-down before bubble)** | No mouse-driven game UI case needs it; it doubles the dispatch semantics surface. | Bubbling dispatch is a single loop; a pre-loop over the same path is a contained addition. |
| **Mouse wheel / scrolling** | The design doc explicitly excludes clipping/scrolling ("no containment/clipping/scrolling"). `Input` doesn't even surface `SDL_MOUSEWHEEL` today. RPG inventories will eventually want this — flagging loudly. | Add `SDL_MOUSEWHEEL` capture in `Input::Update` + an `onMouseWheel` handler kind; the dispatch/bubbling machinery handles it unchanged. |
| **Drag-and-drop event model** (`onDragStart`/`onDrop`) | Real feature with its own design surface (drag data, drop targets, ghosts). The prerequisites (mouse capture, overlay root for the ghost) are IN scope. | Capture + overlay make DnD a dispatch-layer feature later, not an architecture change. |
| **`onMouseDown`/`onMouseUp` handler kinds** | The design doc lists five handlers; down/up aren't among them and clicks don't need them. | The handler-kind enum and dispatch are table-driven; adding kinds is mechanical. |

If any of these is actually needed for the screens you're building next, say so and it moves into a stage below.

---

## Stages

Ordered by dependency. Each stage is independently mergeable and testable.

### Stage 0 — Input layer correctness

**What:** Fix `Input::Update` so mouse state is trustworthy: read coordinates only from mouse events (today `Event.button.x/y` is read for *every* polled event, so keyboard events corrupt the mouse position); record the button on press, not only on release; expose a press-edge (`IsMousePressed()`) and current-button-down state.

**Why:** Everything downstream — hover, click, capture — consumes this state. Hover flicker caused by a corrupted mouse position would be misdiagnosed as a hit-testing bug for days. Right-click ("Right click to sell" is in the design doc's own example) requires the button on the press record, since click resolution compares press location and needs press button.

**Done means:** moving the mouse while typing produces no spurious `MouseMoved()`; `GetMouseDownAt()` carries the button that was pressed; `IsMousePressed()` is true exactly on press frames; left and right clicks are distinguishable at release. Verified by logging in a scratch scene.

### Stage 1 — Bounds correctness

**What:** Fix the position math in `XGUI::GUI::UpdateNode`. Current: `x = Parent.x * rel + abs`. Correct (matching LGUI's proven `Widget::Resize` and the design doc's anchor semantics): `x = Parent.x + Parent.w * rel + abs`.

**Why:** `Element::Bounds` is the thing hit-testing consults. Wrong bounds = every subsequent stage appears broken. This is a two-line fix but it is load-bearing for the entire feature.

**Done means:** a `position="1,0,-300,0"` panel (the design doc's right-anchored example) renders anchored to the right edge and its rendered pixels match its `GetBounds()` rect; nested panels compound correctly. Verified visually with a debug bounds overlay (draw every element's bounds rect — build this tiny debug toggle now, it pays for itself all through stages 4–8).

### Stage 2 — Interaction metadata (parsing)

**What:** `GUILoader` parses the five handler attributes, `mouseEnabled`, `tooltip`, `tooltipSrc`, `tooltipData` on `Panel`/`Text`/`Component`; stores them on `Element` (handler-name map, derived interactive flag, tooltip fields); captures per element the **declaring view** (the ViewHandle whose controller owns the handler names — for `<Component>` elements this is the *parent* document's view, not the mounted child's) and the element's **scope path** (the `ScopePrefix` it was stamped with, needed at dispatch to resolve `targetItemData`). Also: `<Component>` elements get runtime bindings for their own `position`/`size`/`visible`/`layer` attributes (currently ignored entirely — a Component's bounds default to fill-parent, which would make Component-level handlers hit-test against the whole parent).

**Why:** This is the "which panel do you test for hit" answer made concrete: the XML declares it, the loader derives it, nothing else needs authoring. The declaring-view capture is the subtle one — without it, `onMouseClicked="sellItem"` on a `<Component>` resolves against the wrong (child) controller and fails at dispatch, and `<Component position=...>` bindings resolve in the wrong scope.

**Done means:** loading `gui.kittypacks.xml` with handler/tooltip attributes produces elements whose interaction metadata a debug dump prints correctly, including: stamped `GridLayout` instances each carrying their own scope path; a `<Component>` element whose declaring view is the parent's and whose position/size attrs affect its bounds. No dispatch yet — this stage is data only.

### Stage 3 — Layer-sorted paint order (shared render/hit ordering)

**What:** `RenderNode` renders children in `(resolvedLayer asc, child index asc)` sibling order (today `FWidget::Layer` is parsed and bound but ignored at render). The sorted order is cached per element and invalidated when a child's resolved layer changes (layer is bindable). Hit-testing (stage 4) consumes the same cached order in reverse.

**Why:** Hit order must mirror paint order or clicks land on covered elements; making them one data structure makes divergence impossible rather than merely unlikely. Doing this before hit-testing avoids building hit-testing twice.

**Done means:** the design doc's layer semantics hold in the runtime: a higher-layer sibling paints above a lower one; ties break by document order; a container's layer lifts its whole subtree among its siblings; a bound `layer="{token}"` re-sorts when the model changes. One test screen exercising each.

### Stage 4 — Hit-testing, hover path, enter/exit

**What:** `GUI::HandleInput` gains: hit-test in reverse paint order over interactive elements (respecting `bVisible` subtree skip and `mouseEnabled` overrides); the hover path (ancestor chain of the topmost hit) maintained as state; path-diff dispatch of `onMouseEntered`/`onMouseExited`; `onMouseMoved` to the target. Maintain a flat interactive-element list (rebuilt on load/reload) so per-mouse-move cost is O(#interactive), not O(#elements) — `GridLayout` stamping makes trees big; the interactive set stays tiny.

**Why:** This is the heart of the feature, and the hover *path* (vs. a single hovered element) is what both bubbling (stage 5) and tooltip provider resolution (stage 7) are built on. Note: no parent-rect pruning is allowed — the engine has no clipping, children legitimately overflow parents.

**Done means:** hovering nested panels fires enter/exit in correct order (exit bottom-up, enter top-down) with no flicker at boundaries; a covered element never receives hover; an element going invisible (or being hot-reloaded away) while hovered fires its exit; sweeping across a 4×4 stamped grid fires exactly one enter/exit pair per slot transition.

### Stage 5 — Click dispatch, bubbling, consume

**What:** Click resolution (press element == release element, per-button), then bubbling dispatch target → root with per-level controller resolution **by handler name at dispatch time** (not pre-resolved `sol::function`s — this is what keeps dispatch correct across hot reloads that swap controller tables). The full handler signature `(mouse, targetId, targetItemData, currentId)`. `targetItemData` resolves the element's stored scope path against its view at dispatch time.

**Why:** The bubbling model is what makes composite components safe (click on a slot's internal hover-highlight panel still reaches the `<Component onMouseClicked>` in the parent controller) and enables delegation (one `selectPack` on a grid container, discriminating by `targetId`/`targetItemData`). The signature and the consume rule are the two contracts that cannot be walked back — they ship complete here.

**Done means:** the kittypacks screen demonstrates: (a) direct click on a stamped slot invoking its handler with the correct per-instance item table; (b) a click inside a mounted component bubbling out to the `<Component>`-level handler in the parent controller; (c) a handler returning `true` stopping propagation, returning nothing letting a container-level fallback fire; (d) right-click discriminated via `mouse.button`; (e) editing the controller `.lua` while running and clicking again invokes the *new* handler (hot-reload safety).

### Stage 6 — Mouse capture

**What:** A `Captured` element slot on `GUI`: while set, all mouse events route to that element regardless of position; capture is taken on press of an interactive element and released on release. Weak reference; cleared if the element dies (reload).

**Why:** With press/release click semantics, press-inside → drag-outside → release-inside is wrong without capture (the release hit-tests to a different element and the click never resolves — or resolves on the wrong one). It is also the prerequisite for scrollbars/sliders/drag later. Small stage, but production behavior demands it.

**Done means:** press a button, drag off it, release elsewhere → no click anywhere; press, drag off, drag back, release → click fires; a reload mid-capture doesn't crash or wedge input.

### Stage 7 — Overlay root + tooltip system (rich-first)

**What:** Two pieces, one stage because tooltips are the overlay root's first client and they're built together:

- **Overlay root:** a second element list on `GUI`, outside `Root`. Rendered after the tree (always on top); hit-tested before the tree; entries carry `bInteractive` (tooltips: false — hit-transparent, which is what prevents the tooltip-steals-hover flicker loop) and `bModal` (tooltips: false) flags. Overlay entries are ordinary `Element` subtrees — bounds, bindings, rendering all reuse existing machinery.
- **Tooltip controller:** provider = nearest element on the hover path with `tooltipSrc` (or `tooltip`). State machine: show after ~450ms rest; **warm window** ~100ms (moving between adjacent providers shows instantly — the grid-comparison feel every OS ships); hide on provider leaving the path / any press / provider death / reload. Mount pipeline: lazy mount per distinct `tooltipSrc` into the overlay root via the existing component-load path; subsequent shows re-seed via `SetModel` with the freshly resolved `tooltipData` and reposition — **no remount, no reparse, no allocation per hover**. Placement: anchored to provider bounds, flip vertically at the stage bottom edge, clamp horizontally to 1280×768. Loader validates that a tooltip component's root declares an absolute pixel size (warn loudly otherwise). Plain `tooltip="text"` routes through an engine-default text card via the same pipeline.

**Why:** The nested layer model structurally cannot render a deep element above sibling branches — the overlay root is the missing architectural piece, and it is deliberately general (context menus, dropdowns, drag ghosts, toasts are the same primitive with different flags). Rich-first means the mount pipeline IS the system; pooling + re-seed is what makes hover-sweeping an inventory grid allocation-free; live model binding means a visible tooltip with a ticking cooldown updates itself.

**Done means:** hovering stamped grid slots shows a rich card component seeded with each slot's own item data, on top of everything regardless of layers/branches; the delay and warm-window behaviors feel right (sweep = no strobe; compare-adjacent = instant); bottom-row and edge slots flip/clamp on screen; the tooltip never steals hover (no flicker with the cursor over the card); clicking hides it; mutating the model of a visible tooltip updates it live; editing the tooltip's XML on disk hot-reloads the card (pool invalidation), and reload-while-visible hides cleanly instead of dangling.

### Stage 8 — Text measurement & variable-height tooltips

**What:** `Renderer` gains text measurement (`TTF_SizeUTF8`-based: unwrapped extent, and wrapped-height for a given width — note `DrawTextWrapped` already exists, so only measurement is missing). The tooltip root may then opt into height-to-content for the classic variable-length RPG item description. Also wire XGUI's `RenderNode` to honor `bWrap`/`TextAlign` (parsed and bound today, ignored at render).

**Why:** Fixed-size cards ship in stage 7 and are legitimate; variable-length descriptions are the known next demand and require measurement. Sequenced last because nothing earlier depends on it — but it is **required scope, not optional**: RPG item tooltips will force it.

**Done means:** a tooltip card with a 40-char and a 400-char description renders each at correct height with wrapped text; measurement is cached (fonts already are); `textAlign="CENTER"` and `wrap` behave in ordinary Text elements too.

### Stage 9 — `onKeyPressed` (design-doc requirement, focus-less semantics)

**What:** `onKeyPressed` fires on key-press edges (`Input::GetKeyPressed()`), dispatched to every visible element subscribing to it (no focus, no hit test), passing a key table. This matches the design doc's handler list and LGUI's non-focused precedent, minus LGUI's call-every-frame behavior (which pushed edge detection into Lua).

**Why:** It's in the design doc's required handler set; leaving it out would be a silent punt. Focus-less broadcast is the honest v1 semantics; a future focus system layers on top without changing the attribute.

**Done means:** an element with `onKeyPressed="handleKey"` receives one call per key press with the key identified; hidden elements don't receive it.

---

## End-to-end acceptance scenario

The kittypacks screen (`gui/kittypacks/`) is the living testbed; it gets updated alongside the stages (handler attributes on the grid template, a `tooltip.pack-card.xml`, right-click handling in the controller). Final acceptance: run the screen; hover slots (rich per-item tooltips, correct placement everywhere on screen); left-click selects (handler receives the item), right-click "sells" (button discrimination); a click inside the `gui.button.xml` component bubbles to the parent's handler; edit the controller, the layout XML, and the tooltip XML on disk mid-session and all three hot-reload without input wedging or dangling tooltips.
