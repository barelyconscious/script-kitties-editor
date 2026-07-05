# Editor Support for XGUI Interaction Attributes

Companion to [xgui_mouse_input.md](xgui_mouse_input.md) (runtime design) and [xgui_input_stage0_code.md](xgui_input_stage0_code.md) (engine Input layer). This document covers the **script-kitties-editor** side: what must change so the editor can author, validate, and visualize the interaction surface the engine now parses. Editor paths relative to repo root; engine references to `worlds-cpp/worlds-cpp/`.

## The attribute surface being supported (as shipped in the engine, 2026-07-05)

Parsed by `GUILoader` (`XWidget::OnMouseMoved()` etc.) onto `Element::FInputHandlers`:

| Attribute | Value | Notes |
|---|---|---|
| `onMouseClicked`, `onMouseEntered`, `onMouseExited`, `onMouseMoved` | literal controller function name | never scope-prefixed, never bindable |
| `onKeyPressed`, `onFocus`, `onBlur` | literal controller function name | same |
| `modal` | literal boolean (presence) | element is hit-testable with no handlers; sized rect = partial occluder, full-screen = screen modal |
| `tooltip` / `tooltipData` | component ref / binding expression | **naming unsettled — see Decisions** |

Derivation rules (the editor must mirror these EXACTLY — they are the engine's, in `XGUI.h`/`XGUI.cpp`):

- **Hit-testable** = has any mouse handler `||` has tooltip `||` `modal`
- **Focusable** = has `onKeyPressed` `||` `onFocus` `||` `onBlur` (later `onTextInput`); mouse handlers do NOT imply focus
- No `mouseEnabled`, no `focusable` attribute — capabilities are derived; `modal` is the only declared policy.

## Final result (acceptance)

Open `gui.kittypacks.xml` in the editor:

1. The grid template Panel's `tooltip`/`tooltipData` and any handler attrs appear as **labeled, typed fields in an "Interaction" section** of the Properties panel — not freeform rows.
2. Handler fields offer a **dropdown of the controller's actual function names** (typo in a handler = impossible to author via the panel; hand-authored typo = lint warning).
3. The structure tree / preview shows **derived badges**: hit-testable, focusable, modal — computed by the same rules the engine uses, so an author sees "this panel will eat clicks" / "this will never receive keys" before running the game.
4. Lints fire on every contract violation: `{...}` inside a handler attr; handler name missing from the declaring controller; `tooltipData` that isn't a binding expression; tooltip component whose root lacks an absolute pixel size or declares a controller; `modal` with a non-literal value.
5. "Add handler" on a tree node writes the attribute AND stubs the function in the controller with the engine's real call signature; the tooltip component template is one click in New Component.
6. Everything round-trips losslessly (already true — see below) and the XML view shows the attributes verbatim.

## Current state (validated against source — do not re-derive)

1. **Round-trip is already lossless.** `GuiNode.attrs` stores every attribute verbatim in authored order and `serializeGui` writes them all back (`src/lib/guiNode.ts:38-45, 322-343`). Unknown attributes also already render as editable **freeform override rows** (`freeformAttrs`, `src/pages/xgui/guiProperties.ts:305-309`). So the new attributes are usable *today*; nothing is stripped. This work is promotion, not plumbing.
2. **The per-tag field schema** is `fieldsForTag` / `fieldsForTagInner` (`guiProperties.ts:194-265`) with `FieldKind` (`text | modelKey | compound | color | sprite | boolean`) driving how `PropertiesPanel` renders each row. `specialAttrs` (`guiProperties.ts:273-293`) keeps panel-special attrs out of freeform rows.
3. **The View row shows no fields** (`fieldsForTagInner` returns `[]`; `id`/`controller` are special-cased). A `<View onKeyPressed=...>` therefore needs either a View schema entry or Controller-tab treatment — see Decisions.
4. **Controller parsing exists** (`src/pages/xgui/controllerScript.ts`) — the Controller tab already reads/creates controller scripts. Verify it exposes (or can expose) the returned table's function names; that list powers the handler dropdown and the handler-exists lint.
5. **Component picking exists** (`src/pages/xgui/ComponentPicker.tsx`) — reuse for the tooltip component ref. Component metadata/caching exists (`src/lib/guiComponentCache.ts`) — the tooltip root-size/no-controller lints read from it.
6. **The preview's z-order already implements the nested layer model** (`src/lib/guiZOrder.ts`) which the engine does NOT yet render (Stage 3 pending). Known temporary divergence: layered layouts preview correctly in the editor and render flat in-game. No editor change; tracked so nobody "fixes" the editor to match the bug.
7. **Schema discrepancy found while validating**: editor `Text` schema exposes `textColor` (`guiProperties.ts:226`), but the engine parses `color` (`GUILoader.cpp`, `XWidget::Color` reads `Node.attribute("color")`). One of the two is wrong — resolve before adding more schema (see Decisions).

## Decisions to settle BEFORE building (each blocks a piece below)

1. **`tooltip` vs `tooltipSrc`.** The runtime design reserves `tooltip="plain text"` as sugar and `tooltipSrc="component"` for the rich path; the current kittypacks XML and engine parse use `tooltip=` for a component ref. Whichever wins gets baked into the editor schema, the picker field, and the lints. Recommendation: rename to `tooltipSrc` now (keeps the text-sugar seam open; one XML file and one getter to rename engine-side).
2. **Handler call signature.** The engine currently calls `handler(self /* Element* userdata */, mouse /* FMouse userdata */)`; the frozen design contract says `(mouse, targetId, targetItemData, currentId)` with plain tables. The "Add handler" scaffolding must emit stubs matching whatever the engine ACTUALLY calls — freeze the signature engine-side first, then scaffold. Do not scaffold the aspirational contract against the current engine.
3. **Where `<View onKeyPressed>` is edited.** Options: (a) give View a minimal Interaction schema entry (one handler field), or (b) surface it in the Controller tab next to the controller wiring. Recommendation: (a) — it's an attribute like any other; the View "no fields" rule was about id/controller, not a law.
4. **`textColor` vs `color`** (finding 7): pick one, fix the other side.

## Changes by area

### 1. Schema — `src/pages/xgui/guiProperties.ts`

- Two new `FieldKind`s:
  - `handler` — text input + dropdown of controller function names; literal-only (no `{token}` affordance, unlike every other kind).
  - `componentRef` — the tooltip component field, rendered with `ComponentPicker` (same UX as `<Component src>`, but editable here since it's not the special-cased `src`).
- New fields, appended to `Panel`, `Text`, and `Component` schemas (one shared constant, spread into each):
  - `onMouseClicked` / `onMouseEntered` / `onMouseExited` / `onMouseMoved` — `handler`
  - `onKeyPressed` / `onFocus` / `onBlur` — `handler`
  - `modal` — `boolean` **without** the token affordance (engine reads it via `as_bool()`, pre-binding; a `{token}` here is a lint)
  - `tooltipSrc` (pending decision 1) — `componentRef`
  - `tooltipData` — `modelKey` (same commit-on-blur reasoning as `data`)
- `View` gains `onKeyPressed` per decision 3.
- Group metadata: the panel needs to render these under a collapsed **"Interaction"** header rather than mixed into geometry/appearance — add an optional `group` field to `PropertyField` (default group = current behavior).

### 2. Panel — `src/pages/xgui/PropertiesPanel.tsx`

- Render the Interaction group (collapsed by default when no interaction attr is set; expanded when any is).
- `handler` kind: dropdown populated from the **declaring controller's** function names. For Panel/Text that's the owning View's controller; for attributes on a `<Component>` node it is the PARENT document's controller (the engine's declaring-view rule) — which, inside a single open component, is simply "this document's controller" in both cases. Free-typing stays allowed (hot reload may add the function later) with a soft warning state.
- Function-name source: extend `controllerScript.ts` with `exportedFunctionNames(source): string[]` (parse the returned-table keys; regex-level parsing is fine — `(\w+)\s*=\s*function` over the return block — it powers a dropdown and a warn-only lint, not correctness).

### 3. Derivation + badges — new pure module `src/lib/guiInteraction.ts` (+ tests)

One pure module, mirroring the engine rules verbatim, consumed by both the tree and the preview so there is ONE definition (the `guiZOrder`/`isWholeToken` pattern):

```ts
export function isHitTestable(node: GuiNode): boolean; // mouse handler || tooltip || modal
export function isFocusable(node: GuiNode): boolean;   // key/focus/blur handler
export function isModal(node: GuiNode): boolean;
```

- `StructureTree.tsx`: small badges/icons per node (pointer, keyboard, modal).
- `GuiPreview.tsx`: optional inspect toggle tinting hit-testable rects (pairs with the engine's planned debug bounds overlay).
- Unit tests assert the derivation against the same cases the engine review established (mouse-only ⇒ not focusable; modal-only ⇒ hit-testable; etc.), so an engine rule change fails a test here instead of silently diverging.

### 4. Lints (wherever the existing tree warnings live — the missing-id TriangleAlert path)

| Lint | Severity | Source of truth |
|---|---|---|
| `{` or `}` inside any `handler`-kind attr | error | handler names are literal (engine: `WithScopePrefix` corrupts them) |
| handler name not found in controller | warning | `exportedFunctionNames` (hot reload may add it later) |
| `tooltipData` present without `tooltipSrc` | warning | dead attribute |
| `tooltipData` not a binding expression | error | it's resolved as a scope path |
| tooltip component root size not absolute (`rel1/rel2 != 0`) | warning | `guiComponentCache` lookup of the referenced component |
| tooltip component declares `controller` | warning | v1 tooltip components are presentation-only |
| `modal` value not literal `true`/`false` | error | parsed pre-binding via `as_bool()` |

### 5. Scaffolding

- **Add-handler flow**: context action on a tree node ("Add onMouseClicked…") → writes the attr + appends a stub to the controller script with the engine's frozen signature (decision 2). Skip if the function already exists.
- **Tooltip component template** in `NewComponentDialog.tsx`: root Panel with absolute size (e.g. `size="0,0,280,140"`), no controller, one bound Text placeholder.

### 6. Author docs — `ApiReferencePane.tsx`

New reference section: the attribute table above, the two derivation rules, the handler signature with a Lua example, `modal` semantics (rect = swallow region; full-screen vs sized), and the focus model (click-to-focus on focusable, click-away blurs, focused element receives keys first).

## Explicitly out of scope (with the seam kept open)

| Excluded | Seam |
|---|---|
| Interaction *simulation* in the preview (hover/click/tooltip playback) | badges + lints catch authoring errors; simulation is a preview-runtime feature for after the engine semantics stop moving |
| Tab-order authoring | no tab navigation in the runtime; `isFocusable` already enumerates the future tab set |
| Capture / drag / click-to-carry authoring UI | runtime Stage 6/7.5 first; carry needs no XML surface beyond handlers anyway |
| `onTextInput` field | add to the shared handler constant when the engine parses it (Stage 9) — one line in the schema |

## Suggested order

1. Decisions 1–4 (naming, signature, View row, textColor) — everything below hardcodes them.
2. Schema + panel (§1–2) — the authoring surface.
3. `guiInteraction.ts` + badges (§3) — cheap, high leverage.
4. Lints (§4).
5. Scaffolding + API reference (§5–6).
