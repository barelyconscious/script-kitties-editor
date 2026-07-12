---
name: "XGUI editor backfill: scope model + interaction attributes"
description: "The C++ XGUI runtime now exists and has outrun the editor. This backfills two design threads into the editor — the View-as-scope-boundary model (scoped bindings, scopeName, controller signature) and the interaction attribute surface (handlers, modal, tooltips, badges, lints) — plus corrects two attribute contracts where the editor silently diverges from the shipped engine."
status: shipped
author: architect
date_created: 2026-07-06
reviewers:
  - engineer
  - matt
reviewer_decisions:
  engineer: Request for Comment
---
## Context

Four design docs landed 2026-07-06 folding C++ runtime decisions back toward the editor:

- `design/xgui_ta_view_scope_addendum.md` — **normative**, supersedes `xgui_ta.md`. Reframes `<View>` as a *scope boundary*; adds `scopeName`, the controller `(view[, model])` signature, and the `$.`/`$name`/`{$.}` binding grammar.
- `design/xgui_editor_interaction_support.md` — the editor-side plan for the mouse/keyboard/tooltip attribute surface.
- `design/xgui_mouse_input.md` + `_code_changes.md` — the runtime roadmap (engine-side; here for context only).

**The material finding from validating these against source:** the runtime is no longer hypothetical. `worlds-cpp` branch `xgui` now parses, renders, and dispatches input (`GUILoader.cpp`, `XGUI.cpp`), and there is a real testbed at `worlds-cpp/gui/kittypacks/` (4 XML files). CLAUDE.md's "the runtime does not exist yet" is stale. **The editor is now the lagging artifact**, and in two places it *silently disagrees* with what the engine actually parses. I treated engine source + the real kittypacks XML as ground truth over the docs — and the docs already lag the engine in spots (see Corrections).

Nothing here is a C++ change. This is all editor-side, plus flagging two cross-repo decisions the engineer owns.

## What's already aligned (validated, no work)

The addendum's core claim holds: the editor's View model is mostly right already. Confirmed correct in source and needing **no** change — `<View>` mandatory/root-only/non-visual (`guiNode.ts`, `guiTreeEdit.ts`, `guiProperties.ts`); one controller per file; `data=` on `<Component>` only with fresh-root mount semantics (`guiComponentMount.ts`); no `<Scope>` element; lossless attribute round-trip (`guiNode.ts`); unknown attrs already survive as freeform rows. The handler attrs (`onMouseClicked` etc.) are **already** in the resolver's `LITERAL_ONLY_PROPS` — half the interaction wiring is inadvertently done.

## The work — two threads + two corrections

### Thread A — Scope model (from the addendum)

**The binding grammar (authoritative — settled with Matt 2026-07-06).** Three scopes, each with a field-access and a whole-object form:

| Scope | Field access | Whole-object | Valid where |
|---|---|---|---|
| **View / local** (`$.`) | `{$.creature.sprite}` | `{$.}` | anywhere (a View always exists) |
| **Grid item** (bare) | `{sprite}` | `{.}` | **only** inside a GridLayout child |
| **Named** (`$name.`) | `{$app.theme}` | `{$app.}` | anywhere below the publishing `scopeName=` |

Rules: (1) inside a grid child the View frame and item frame are **both live** — `{sprite}` → item, `{$.x}` → View; the item never shadows `$.`. (2) The engine synthesizes bare paths as `$.<collection>.<index>.<field>`; authors never write the index. (3) Whole-object forms feed mounts (`<Component data="{.}">` / `data="{$.}">`). (4) `$name` scopes have **zero** shipped usage — recognize, defer. (5) **STRICT (Matt: "don't punt this"):** bare demotes to grid-only; **bare-at-root is now unresolved + linted.**

**The load-bearing fact:** the editor is on the *opposite* convention. `guiBinding.ts flatRootScope` + `guiModelScaffold.ts` treat **bare = root field** — 175 bare-token occurrences across 15 test files, **zero** `$.` tokens in `src`. Real content (kittypacks) is already `$.`-correct, so flipping to strict costs a near-zero *content* migration and a mostly-mechanical *fixture* rewrite (`{x}`→`{$.x}`). This grammar work splits along its two consumers:

**A1 — Scope grammar in the resolver** (`guiBinding.ts` + tests). The composite view/item scope, `$.`/bare/`{.}`/`{$.}`/`{$app.}`, strict bare-at-root, `$name` deferred. Heaviest single task; I'll spec the scope-layering (Edge 1) so it's not left to implementation.

**A1s — Scope grammar in the model scaffold** (`guiModelScaffold.ts` + tests). Same grammar, other consumer: `$.creature.sprite` → nested object; grid `dataCollection` + bare child tokens → array-of-item-shape; whole-object forms contribute no new fields; bare-at-root no longer invents a root key.

**A2. `scopeName` on the root `<View>`.** Engine parses it (`GUILoader.cpp:154`); editor has no field. Surface it in the Properties panel alongside `controller`, stored verbatim. Small.

**A3. Controller factory signature.** Template is `function(view) return {} end` (`controllerScript.ts`); real controllers are `function(view) … view:setModel(model) … end`. Update the seeded template to `function(view[, model])` and document `view:setModel(...)`. Small.

### Thread B — Interaction attributes (from the interaction doc)

**B1. Schema.** Two new `FieldKind`s: `handler` (literal-only, dropdown of controller fn names) and `componentRef` (tooltip picker). New fields on Panel/Text/Component: the seven handlers, `modal` (boolean, no token affordance), `tooltip`, `tooltipData`. Add a `group` tag to `PropertyField` so these render under a collapsed **"Interaction"** section. `View` gets `onKeyPressed`.

**B2. Panel rendering.** Render the Interaction group; handler dropdown sourced from a new `exportedFunctionNames(source)` in `controllerScript.ts` (regex over the returned table — powers a dropdown + a warn-only lint, not correctness).

**B3. Derivation module — `guiInteraction.ts` (+ tests).** One pure module mirroring the engine's derivation rules verbatim (`isHitTestable`/`isFocusable`/`isModal`), consumed by both the tree and preview so there's a single definition. Badges in `StructureTree`; optional inspect tint in the preview. Tests lock the rules to the engine's so a divergence fails here.

**B4. Lints.** Wire into the existing tree-warning path: `{}` in a handler attr (error), handler not in controller (warning), `tooltipData` without `tooltip` (warning), `tooltipData` not a binding (error), tooltip component root not absolute-sized / declares a controller (warnings), `modal` non-literal (error).

**B5. Scaffolding — attr-write only + tooltip template + docs.** Add-handler context action writes the **XML attr only**; tooltip-component template in New Component; API reference section. **Lua stub auto-injection into the controller is PUNTED** (Matt) — the add-handler flow does not generate function bodies. Leave a **`// TODO`** at the injection seam in the editor source documenting the intended behavior and the two stub shapes it would emit (`function(self, mouse)` for input handlers, `function(payload)` for `<Event>`). This **dissolves the D2 dependency**: with no Lua generation, the unfrozen key-handler signature no longer blocks anything. The handler *dropdown* and the handler-not-in-controller *lint* still read `exportedFunctionNames` — reading, not writing — so authoring aids stay intact.

### Corrections (editor silently disagrees with the shipped engine)

**C1. `textColor` → `color` (a typo fix, per Matt).** The editor's `textColor` was never intentional — the intended attr was always `color`, which the engine reads (`GUILoader.cpp:713`). So this is a straight rename, no design tension. Fix spans **two files**: the resolver's `COLOR_PROPS` (`guiBinding.ts:342`) *and* the `Text` schema field (`guiProperties.ts:226`). Keep the editor field **Text-only** (the engine accepts `color` on any widget, but don't expand Panel's schema now). **Migration IS needed** (D3): `gui.kittypacks.packs-viewer.xml:4` still says `textColor` and is dropping its color in-game — also just a typo to rewrite. Ship a **warn-only lint + one-shot rewrite** on load, since the editor's live gui tree under `<gameInstallPath>/gui/` isn't visible from either repo and may hold more stragglers.

**C2. `mouseEnabled` is gone.** The mouse_input roadmap mentions it; the engine dropped it — `modal` is the only declared hit policy. The interaction doc is correct. No work beyond *not* building `mouseEnabled`.

## Decisions to settle before building

- **D1 — `tooltip` vs `tooltipSrc`. RESOLVED → keep `tooltip=`.** Engineer agrees. YAGNI on the text-sugar seam; engine ships it; matches the "Component src requires basename" precedent. If the sugar ever earns its keep, the engine rename is ~2 lines (one inline literal at `GUILoader.cpp:352` + one XML file) — cheap later, so no pre-emptive churn now.
- **D2 — Handler call signature. RESOLVED → moot for the editor.** Since Lua stub injection is punted (see Punts), the editor never generates a controller function body, so the signature doesn't gate any editor task. Captured only as a `// TODO` at the injection seam for whenever injection is built: input handlers = `function(self, mouse)`, `<Event>` handlers = `function(payload)`, key handler = `function(self, input)` (arg-2 unfrozen engine-side). The aspirational `(mouse, targetId, targetItemData, currentId)` form ships nowhere — never scaffold it.
- **D3 — `textColor`→`color` migration. RESOLVED → migration needed.** `packs-viewer.xml` uses `textColor` today. Folded into C1 as a warn-only lint + one-shot rewrite.
- **D4 — Where `<View onKeyPressed>` is edited.** The root View is a real `onKeyPressed` target (engine dispatches unfocused key events to `Root` — `XGUI.cpp:138`), so the attr needs an authoring home. Today the View row shows **zero** panel fields (id auto-set, controller via the Controller tab). Two options: **(a)** give View a minimal Interaction schema entry (one `onKeyPressed` field, rendered like every other handler) — one place to attach handlers; or **(b)** surface it in the Controller tab — keeps the View row empty but splits handler authoring across two surfaces depending on the owning element. **RESOLVED → (a)** (Matt). The View row gains an Interaction section with `onKeyPressed`; the "View has no fields" invariant becomes "View shows scopeName + Interaction." One place to attach handlers.

## Punts (Matt-approved)

- **Interaction / Lua handler *simulation* in the preview — PUNTED.** No live "click it and watch the handler fire" playback. Static authoring aids ship instead — badges (this panel eats clicks / never receives keys) and lints. **Explicitly NOT punted:** the existing **data-model → binding** simulation, where editing the Data Model panel re-resolves `{token}` bindings live in the preview. That stays, and A1 is precisely what makes it *work on real components* (which bind `$.`-scoped paths the resolver can't yet follow). So the preview still simulates *data* changes; it just doesn't execute *Lua*.
- **Lua stub auto-injection into controllers — PUNTED** (folds into B5). Add-handler writes the XML attr; it does not generate the controller function body. `// TODO` left at the injection seam. This also **removes the D2 blocker** — no Lua generation means the unfrozen key-handler signature blocks nothing.

Everything else the docs mark "out of scope" is either a runtime concern (focus/tab, wheel, drag-and-drop, `onMouseDown/Up`, `onTextInput` — engine-side, not ours) or a genuine seam with no forcing function yet (author-time mount shape-checking from addendum §5; the GridLayout/`forEach` runtime reconciliation from §6, tracked elsewhere). None of those are editor work being dropped on the floor.

## Proposed task breakdown & sequencing

Two threads run **in parallel**; C1 rides Thread A. With Lua injection punted, **nothing is blocked** — every task is buildable now.

1. **Thread A** — A1 resolver (C1 typo-fix folded in, both touch `guiBinding.ts`) → A2 scopeName → A3 controller template. A1 is the highest-leverage single task: it makes the preview resolve real components' `$.`-scoped bindings.
2. **Thread B** — B1 schema (incl. View `onKeyPressed`, D4=(a)) → B2 panel → B3 `guiInteraction.ts` + badges → B4 lints → B5 scaffolding (attr-write + tooltip template + docs; Lua injection is a `// TODO` seam).

~8 engineer tasks. Cutting once D4 is nodded.

## Open questions for reviewers

1. **Engineer:** D1 and D2 are yours — keep `tooltip=`? And can you freeze the handler signature, or should B5 wait?
2. **Engineer:** C1 — any authored gui files besides kittypacks using `textColor` that need migrating?
3. **Matt:** sign-off on punting interaction *simulation* (or pull it into scope as its own thread)?
4. **Both:** A1's `{$name.x}` / `{$.}` grammar is unused in real XML today — build now for completeness, or defer until a component actually authors a `scopeName`? (I lean: build the `$.`+nesting must-have now, stub the named-reach grammar but defer full support.)

## Engineer review

Decision: **Concerns** — direction is right and the two corrections are real, but one premise is factually wrong (C1) and one decision under-specifies the problem (D2 conflates two handler families). Both are additive fixes, not blockers. I read engine source on `worlds-cpp@xgui` as ground truth. Line refs below are that branch.

### D1 — `tooltip` vs `tooltipSrc`: agree, keep `tooltip=`

Confirmed and I agree with keeping `tooltip=`. Rationale stands: YAGNI on the text-sugar seam, engine already ships it, matches the `<Component src=>` "ref requires basename" precedent.

One precision on your cost estimate: the rename is cheap but it's **not "one getter"** — the engine reads tooltip *inline*, not through a named `XWidget::` accessor. It's `string TooltipSrc = Node.attribute("tooltip").value();` at `GUILoader.cpp:352` (inside `GetPanel`), with its sibling `tooltipData` read at :358. So a rename is: **one inline literal (`GUILoader.cpp:352`) + one XML migration (`gui.kittypacks.xml:8`, the only `tooltip=` in the tree).** Still trivially cheap — which is the argument for *not* pre-emptively renaming: if the text-sugar seam ever earns its keep, the rename costs ~2 lines then. Note also that a rename would leave a `tooltipSrc` / `tooltipData` naming pair, which is arguably cleaner but not worth churning for. **Freeze on `tooltip=`.**

### D2 — handler signature: don't wait, but the decision is under-specified

The contract is more knowable than "aspirational, not shipped" suggests — and it's **two contracts, not one**. This is my main concern with the doc as written.

**The mechanism (frozen):** `Element::Exec` (`XGUI.h:155`) is `Fn(this, std::forward<Args>(args)...)` — it *always* prepends the element as `self`. So every **input handler** is `handler(self, <args>)`.

**Input handlers (mouse/focus/blur) — effectively frozen.** All six dispatch through `Exec(fnName, Input.GetMouse())`: `OnMouseClicked/Entered/Exited/Moved` (`XGUI.cpp:66,87,94,106`) and `OnFocus/OnBlur` (`:47,54`). That's `function(self, mouse)`, consistent across six call sites. **B5 can scaffold these today** — they are not blocked on anything.

**Key handler — genuinely unstable.** `onKeyPressed` has two live-TODO call sites passing *different types*: a stub string `"some key events"` when focused (`XGUI.cpp:133`) and `&Input` when unfocused (`:142`). Scaffold `function(self, input)` (matches the sample controller's `onKeyPressed`) but mark it provisional; the arg-2 type is unsettled engine-side.

**`<Event>` handlers are a SEPARATE family the doc doesn't distinguish — this is the gap.** `<Event name= handler=>` is registered via `View->RegisterEvent(Name, Fn)` (`GUILoader.cpp:227`) and invoked with the **event payload only, no `self`**. The real controller proves it: `handleOnBattleStart = function(battle)`, `handleSelectedCreatureChanged = function(selectedCreature)` (`controller.kittypacks.lua:46,50`) — vs the input handlers `handleOnEnter = function(self, mouse)` (`:41`). **B5 must emit two stub shapes:** input-handler attrs → `function(self, mouse)`; `<Event handler>` → `function(payload)`. The doc's "scaffold minimal `function(self, mouse)`" would emit the wrong shape for events.

Do **not** scaffold the aspirational `(mouse, targetId, targetItemData, currentId)` — it appears nowhere in shipped dispatch. And don't treat the sample controller as the signature authority: `handleOnClick = function(mouse)` (`:56`) is itself buggy (missing `self`, so `mouse` actually binds to the element). `Exec`'s `Fn(this, ...)` is the contract, not the sample.

**Net:** D2 doesn't block B5 wholesale. Recommendation: freeze `function(self, mouse)` for the six mouse/focus/blur handlers now (it's already stable); scaffold `<Event>` as `function(payload)`; scaffold key as `function(self, input)` flagged provisional. Only the key-handler arg is truly waiting on the engine.

### C1 — `textColor`→`color`: correct bug, but the "no migration" premise is FALSE

The fix is right (`color` is read at `GUILoader.cpp:713`). But the claim "the kittypacks XML already uses `color`, so likely none [need migrating]" is wrong: **`gui.kittypacks.packs-viewer.xml:4` uses `textColor="255,255,0,255"`** — inside kittypacks itself. That Text's color is being dropped in-game *right now*; it's a live instance of the bug, not a hypothetical. So **D3's answer is: yes, at least one file needs migrating** (`gui.kittypacks.packs-viewer.xml`). The other repo hit for `textColor` (`Scripts/dialog_walker.lua:74`) is an unrelated Lua local, not an XGUI attribute — ignore it.

Caveat on completeness: the editor's *live* gui tree lives under `<gameInstallPath>/gui/`, which isn't in either repo, so I can't enumerate author files there. Whoever owns that install dir should grep it for `textColor` too. Cheap insurance: the editor could ship a warn-only lint flagging `textColor` on load and offering a one-shot rewrite to `color` — turns a silent drop into a visible nudge for any file we can't see from here.

Two engineering nuances for whoever builds C1:
- C1 spans **two files**, not just `guiBinding.ts`: the resolver's `COLOR_PROPS` set (`guiBinding.ts:342`) *and* the schema field name (`guiProperties.ts:226`, the `Text` case). Fold both into the A1 task or track it explicitly — the doc's "both touch `guiBinding.ts`" undersells it.
- The engine reads `color` for **all** widgets via `XWidget::GetElement` → `Color()` (`GUILoader.cpp:541`), not Text-only — `color` is a universal foreground color. The design scopes the editor field to Text, which is fine; just don't be surprised that `color` is legal on Panel engine-side. I'd keep C1 tight (Text only) and not expand Panel's schema now.

### Q4 — thread/sequencing read

Mostly sound. A1-highest-leverage is right; parallel threads after decisions is right. Specific notes:

- **A1 scope is correctly bounded — don't over-build it.** The engine's `WithScopePrefix` (`GUILoader.cpp:22`) injects the scope prefix after *every* `{` at parse time; that's runtime scope-stack machinery for nested `GridLayout`/`forEach`. The editor preview resolves against the single flat model the author supplies, so A1 only needs **strip `$.` + walk dotted paths** against that model. Do **not** try to replicate `WithScopePrefix`'s per-`{` injection in the preview — that's the deferred nested-scope work. Your instinct in Q4 (build `$.`+nesting must-have, stub named-reach) is right.
- **B3 `guiInteraction.ts` — pin the derivation to the exact engine predicate.** Hit-testing is `SupportsMouseEvents() || HasTooltip() || IsModal()` (`XGUI.cpp:20`); focus is `bModal || bReceivesFocus` (`XGUI.h:152`). The non-obvious rule the badge must encode: **a panel with only a `tooltip` (no handlers) still eats mouse events** — `HasTooltip()` alone makes it hit-testable. If B3's tests lock to those two source lines, good; if they lock to the *design doc's* prose, they may miss the tooltip-implies-hittest clause. Point the test at the source.
- **B5 is only partially gated on D2**, per the D2 analysis above — the mouse/focus/blur stubs can ship before the key-handler arg is frozen. Consider splitting B5 so the unblocked scaffolding isn't held hostage to the key-path TODO.
- **~7–8 tasks feels right.** No missing thread from an impl standpoint, given the two corrections above are folded in.

**Bonus divergence (not in your four, same class as C1, lower severity):** the engine parses `layer` (`XWidget::Layer`, `GUILoader.cpp:738`) but `GetElement` never calls it and `RecalculatePaintOrder` (`:451`) orders purely by tree traversal — so authored `layer` is currently **inert in-game**, while the editor has full nested z-order (`guiZOrder.ts`). Unlike C1 this is the editor being *ahead* of the runtime (authoring intent not yet consumed), not a name mismatch — so no correction to make now, but the architect should know `layer` is a not-yet-honored contract, and it's a candidate for a future "runtime doesn't consume this yet" lint alongside the C1 nudge.
</content>
