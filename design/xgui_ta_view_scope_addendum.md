# XGUI Addendum — View as Scope Boundary

> **Status: ADDENDUM. Normative as of 2026-06-29.** This document folds in the design
> decisions taken on the C++ runtime side (a runtime design session) and binds the editor
> to conform. **Where it conflicts with the existing design docs it supersedes them** —
> primarily `design/xgui_ta.md` (the primary XGUI design doc) and, where noted,
> `design/xgui_workflows.md`. The existing docs are left intact; the precise overrides are
> in **§7 Supersedes**, what the editor already gets right is in **§8 Already aligned**.
>
> The model has **converged**. The body below states only the **final locked decisions**.
> Intermediate ideas that were toyed with and dropped on the way to convergence are
> recorded — with a one-line reason each — in **§9 Alternatives considered and discarded**,
> so the reasoning isn't lost but the normative text stays clean.

## 1. Why this addendum exists

The original `xgui_ta.md` treats `<View>` as "the top level element" but never gives a
first-class account of *data scope* — scope appears only piecemeal (the `forEach`
item-scope stack, the `<Component>` child-data boundary). The runtime design session
reframed the whole picture around one idea:

> **A `<View>` is a scope boundary, not a layout/visual element.**

The good news of convergence: the original editor/design model turns out to be **mostly
correct** under this reframing — `<View>` *is* the mandatory root, and it *is* the
non-visual thing that holds a component's scope. The reframing mainly makes that explicit,
adds a named-reach attribute, and pins down how data crosses a mount. It does **not**
change the rendering model (rel/abs geometry, the nested `layer` z-order, the preview
stage), the palette, saving/watching, or the component-list/file model.

## 2. The locked model

### 2.1 Every file is rooted by exactly one `<View>` (mandatory, root-only)

Every component file is rooted by **exactly one `<View>`**: the root is **mandatory**, it
is **root-only** (a `<View>` is never a child element), and there is **at most / exactly
one per file**. There are no nested or inline Views, and there is no other kind of root.

Nested scopes therefore come **exclusively from `<Component>` mounts** (composition): each
mounted file is itself View-rooted, and scopes chain down through those mount boundaries
(§2.10, §4). There is no way to open a new scope *inline* within a file.

### 2.2 A `<View>` is a scope boundary, not a visual element

A `<View>` has **no geometry** — no position, size, style, or border of its own. It is the
**non-rendered "stage"**: the renderer does not draw a box for the View, it renders the
View's **children** into the stage. The model a View holds influences rendering only
*indirectly*, through the `{token}` bindings its descendant widgets evaluate.

Decomposed: **`View = Scope + model + (optional Controller)`** — Scope is the always-on
part (a frame in the chain), the model is the data that frame holds, and the controller is
optional behavior.

### 2.3 A `<View>` always establishes an isolated anonymous frame

A `<View>` **unconditionally** establishes its own **anonymous scope frame** and
**isolates**. Inside the component, `{$.x}` resolves against **this** frame — never the
caller's. Isolation is not opt-in and is not triggered by any attribute: a bare `<View>`
with no `scopeName` and no `controller` still isolates exactly the same as one with both.
A mounted component sees **only** the model it is given (§2.4), never the caller's frame by
default.

### 2.4 `<Component src="…" data="{expr}">` is the call site

Data crosses a mount **only** through the mount's `data=`:

```xml
<Component src="button.xml" data="{buttonProps}"/>
```

`data=` is the **only** place a model value is supplied across a mount boundary, and it
lives on `<Component>` **only** — never on `<View>`. This is a function/call-site duality:
the mounted View is the function definition (its parameter *shape* inferred from how its
widgets bind — §2.5); the `<Component data=>` mount is the call passing the argument.

### 2.5 A component's required model is an implicit shape

A component does **not** declare its model on the View. Its required model is an
**implicit SHAPE inferred structurally from its widgets' bindings**: `<Text text="{name}"/>`
implies `.name`; `size="{ratio},1,0,0"` implies `.ratio`. The contract is duck-typed and
scattered across the subtree; the controller's ability to **reject** (§2.7) is the runtime
guard. A future optional *explicit* shape declaration is possible but not required.

### 2.6 `scopeName="name"` publishes the frame for named reach

`scopeName="name"` (optional, on the root `<View>`) **publishes this View's frame under a
name** so that **deeper descendants** can reference it as `{$name.x}` (e.g. `$app`,
`$theme`, `$form`). It does **not** change isolation — the component always reads its own
frame via `{$.x}` whether or not it is named. Use `scopeName` **only** when something
nested needs named reach across mount boundaries; omit it otherwise. Imperative twin:
`view:provide(name)`.

**Named `scopeName` deliberately:** it matches the project's camelCase attribute
convention (`backgroundColor`, `fontSize`, …) and matches the C++ binding vocabulary end
to end — the binding/lookup side already resolves against a "scope name"
(`ScopedBinding.ScopeName` / `FBindingLookup.Scope`), so authoring `scopeName="app"`, the
expression `{$app.x}`, and the resolver matching `lookup.Scope == "app"` all use the
**same word for the same concept**.

### 2.7 `controller="file.lua"` — one per file, on the root View

`controller="file.lua"` (optional, on the root `<View>`) attaches behavior. There is
**one controller per file**. Its factory is:

```lua
function(view[, model])
    -- may view:setModel(...) to set / project / reject the model
    return { --[[ handlers ]] }
end
```

The factory receives the view (and the passed model), may **set / project / reject** the
model via `view:setModel(...)`, and returns the controller/handlers table.

### 2.8 Data pipeline: argument → optional controller → final frame

```
<Component data="{…}">     the argument (the passed model)
        │
        ▼
   controller (optional)   may transform / project / reject via view:setModel(...)
        │
        ▼
   final frame             what the View's bindings resolve against
```

The passed `data` is the default model; a controller may transform or replace it; **with
no controller the data flows straight through** as the model. The View's bindings are the
structural contract on the **final** frame.

### 2.9 Root views are fed by the controller or by engine Props

A **root** View has no caller, so it has no mount `data=`. It is fed by either:

- its **controller**, which reads domain singletons and calls `view:setModel(...)`; or
- **engine Props** — the C++ entry point `GUILoader::Load(const sol::table& Props)`.

Mounted (non-root) Views get their data from their mount's `data=` (§2.4).

### 2.10 Multiplicity and the scope chain

- **One controller per file.** A file has exactly one root View, so it has at most one
  controller.
- **Many controllers per rendered tree.** A rendered screen accumulates many controllers
  — one per mounted, View-rooted `<Component>`. Multiplicity arises through **mount
  nesting**, never by stacking controllers in a single file.
- **Scopes chain down through mount boundaries, nearest-wins.** Each mounted View pushes
  its frame; a `{$name.x}` reference resolves against the nearest ancestor frame published
  under that name (§4).

### 2.11 Transparency is exactly `data="{$.}"` — nothing else

When a mounted component should **share the caller's scope** rather than be isolated, the
mount passes the caller's **entire current frame** as the child's model:

```xml
<Component src="row.xml" data="{$.}"/>
```

`{$.}` is "the whole current frame," so `data="{$.}"` injects the caller's scope into the
mounted view's frame. **This is the ONLY transparency mechanism.** There is no
`<Fragment>` element, no `transparent` flag, and no pass-through default — every View
isolates (§2.3), and sharing is an explicit, ordinary use of `data=`.

> **Dependency to note:** this rests on `{$.}` being a valid "whole current frame"
> reference. The editor's current flat resolver does **not** yet support a `$.` whole-frame
> reference (it has no `$.` root — see §7.3); supporting `{$.}` (and `{$name.x}`) is the
> one binding-resolver extension this transparency mechanism requires.

### 2.12 `<View>` attribute vocabulary

| Attribute | Required? | Meaning |
|---|---|---|
| `scopeName="name"` | optional | Publishes this View's frame under `name` for deeper descendants to reach as `{$name.x}` (§2.6). Does not affect isolation. Declarative twin of `view:provide(name)`. |
| `controller="file.lua"` | optional | The one controller for this file; factory `function(view[, model])` (§2.7). |
| ~~`data=`~~ | **never** | A View has **no** `data=`. Data arrives via the mount (§2.4). |

A `<View>` carries **no** geometry/style attributes (§2.2).

### 2.13 `<Scope>` is eliminated as an authored element

There is **no `<Scope>` element** and never will be. A scope is the emergent consequence of
a `<View>` (which every file has — §2.1), not a thing authored on its own. The editor never
had a `<Scope>` tag, so there is nothing to remove (§8).

## 3. Editor impact (minimal)

Under the converged model the editor is **almost entirely correct already**. Only **two**
changes are required:

1. **Add the `scopeName` attribute/property.** Surface `scopeName` on the root `<View>` in
   the Properties panel (alongside the existing `controller`), stored verbatim like any
   other attribute. It is the one new piece of authoring vocabulary (§2.6).
2. **Update the controller factory signature.** The seeded controller template changes from
   `function(view)` to `function(view[, model])` and documents `view:setModel(...)`
   (`src/pages/xgui/controllerScript.ts`; §2.7).

Everything else the editor **already does correctly** and must be left as-is (cited in
§8): `<View>` mandatory root; `<View>` root-only / never a child; `<View>` non-visual with
the stage rendering its children; one controller per file; one model per component file;
`data=` only on `<Component>`. The `data="{$.}"` transparency (§2.11) works with the
existing `data=` machinery **once** the resolver gains the `{$.}` whole-frame reference
(the only resolver extension — §7.3).

## 4. Scope chain, resolution & inheritance

The runtime resolves a `{$name.x}` reference by walking the **scope chain** from the
current frame outward, matching the nearest ancestor frame **published** under `name`
(via `scopeName=` / `view:provide(name)`) — **nearest wins**. A `{$.x}` reads the current
frame (the nearest enclosing View's frame); `{$.}` is the whole current frame (§2.11). A
View **isolates**: bare-name lookup does not leak past a View boundary into the caller
(§2.3); the chain grows only at **`<Component>` mount boundaries**, never inline within a
file.

| Frame kind | Is a View? | Carries controller/lifecycle? | Produced by |
|---|---|---|---|
| **View frame** | yes | yes | a `<View>`-rooted component (reached at a `<Component>` mount, or the top-level entry) |
| **Item frame** | no | no | inline repetition (the runtime `forEach` item; editor equivalent in §6) |
| **Provided / named frame** | — | no | `scopeName=` on a root `<View>` / `view:provide(name)` |

The editor's preview need only model **enough** of this to render correctly. Its current
single-frame-per-component + per-mount-fresh-root behavior already matches "one frame per
View, chaining across mounts"; the additions it does not yet model are the `{$.}`
whole-frame and `{$name.x}` named references (§7.3).

The rest of this section codifies, normatively, exactly how a binding finds its value and
how scopes are (and are not) inherited.

### 4.1 Token resolution grammar

How a binding finds its value:

- **`{$.x}`** — resolves against the **nearest enclosing View's own frame** (the "self"
  frame), then reads field `.x`. **Local**: it never crosses a View boundary upward.
- **bare `{x}`** — the **same locality** as `{$.x}`: the nearest local frame, **stopping
  at the View/component boundary**. It does **not** walk up across a View.
- **`{$name.x}`** — walks **up** the View chain to the **nearest** View whose
  `scopeName == name`, then resolves `.x` in that frame. This is the **only** ambient,
  cross-boundary upward reach in the model.
- **`{$.}`** — the **whole** current frame (used at a mount as `data="{$.}"` — §2.11, §4.6).

### 4.2 Isolation (locked — no pass-through)

- A `<View>` **always** establishes its own frame and isolates. This is automatic by
  *being* a View — it is independent of `setModel`, `data=`, and `scopeName`. Those only
  **populate** the frame; **the frame exists regardless** (an empty View still has an
  empty self frame).
- A `{$.x}` (or bare `{x}`) **miss resolves to nil/default** — it does **NOT** fall
  through to an ancestor frame. This is deliberate **fail-loud isolation**; silent
  pass-through to an ancestor was rejected (see §9 Alternatives considered and discarded).

### 4.3 Named vs anonymous frames (the inheritance / exposure contract)

- **Anonymous frame** — a View with **no `scopeName`**. It is **private**: reachable only
  within its own subtree via `{$.x}` until the next View boundary, **invisible by name** to
  descendants, and **inert to the named chain** — it neither exposes anything by name nor
  shadows any ancestor's named frame.
- **Named frame** — a View with **`scopeName="x"`**. It is **public**: reachable by all
  descendants as `{$x...}` across boundaries, and it **shadows nearest-wins** *only if* an
  ancestor also carries `scopeName="x"` (a name collision is a **replacement**, never a
  field-level merge — §4.4).

**Contract (state it plainly): naming is the explicit opt-in to expose a scope downward;
anonymous = private.** The named chain is only ever affected by *naming* something — both
exposure and shadowing are **intentional acts**. Nothing leaks, and nothing is clobbered,
by accident.

### 4.4 Conflict resolution = REPLACE (shadow), not merge

- **Same `scopeName` at two depths** → the **nearer** frame shadows the farther one
  **wholesale**; the farther one is **unreachable by that name** from below ("mother, not
  grandmother"). There is **no** deep / field-level merge of two same-named frames.
- **Different names** → all **accumulate / coexist** — a descendant sees the **union** of
  the visible named frames (one per distinct name, each resolved nearest-wins).

### 4.5 Orthogonal axis — updating ONE frame's model (do not conflate with chain shadowing)

Shadowing (§4.4) is about *which frame* a name resolves to. Updating a frame's model is a
*separate* axis about *what is inside one frame*:

- **`view:setModel(t)`** → **replaces** that frame's whole model.
- **`view:patch(t)`** (if/when added) → **merges** fields into that frame's model.

Neither touches the chain: they change one frame's contents, not which frames are visible
by name.

### 4.6 Cross-boundary data push-down (`data=`) vs ambient inheritance

Named-frame inheritance (§4.3) is an **ambient, upward, by-name reach**. Distinct from it,
data also crosses a boundary **explicitly and downward** via `data=` at the `<Component>`
mount — a **push-down**, not an inherit-up:

- `<Component src="…" data="{expr}">` seats `expr` as the mounted child View's model.
- `data="{$.}"` injects the parent's **whole** frame as the child View's model — the
  transparency mechanism (§2.11). It is the only way to hand a child an **anonymous**
  parent frame's data (which is otherwise unreachable by name).

### 4.7 Worked example

Top View **A** (`scopeName="app"`, model `A`) mounts component **B** (a View, model `B`,
**no** `scopeName`), which mounts component **C** (a View, **no** model, **no**
`scopeName`). `C` contains:

```xml
<Text text="{$.backgroundSprite}"/>
<Text text="{$app.title}"/>
```

- **`{$.backgroundSprite}`** resolves against **C's own (empty) frame → nil.** Not B, not
  A. C is a View, so it has its own self frame even though nothing called `setModel` on it;
  `{$.}` is local and isolation forbids fall-through (§4.1, §4.2).
- **`{$app.title}`** resolves against **A's frame** — the walk goes **up the named chain**,
  past the anonymous B and C (which are inert to the named chain — §4.3), to the nearest
  View named `app` (§4.1, `{$name.x}`).
- To get **B's or A's anonymous data** into C, mount C with **`data="{$.}"`** — a
  push-down of the caller's whole frame (§4.6). There is no ambient way to inherit an
  anonymous ancestor's fields.

## 5. Author-time shape checking (editor convenience)

Because a component's shape is inferred from its descendants' bindings (§2.5) and the
editor already extracts that shape (`extractShape` / `src/pages/xgui/guiModelScaffold.ts`),
the editor **can** check a mount: given `<Component src="child.xml" data="{obj}">`, compare
the resolved `obj` against `child.xml`'s inferred shape and surface a **non-blocking**
warning when a required field is absent. This is convenience only — the controller's
ability to reject is the runtime guard, and the editor must never block a save on a shape
mismatch.

## 6. Inline item-scoping and the GridLayout reconciliation (deferred)

The runtime model speaks of `forEach` **item frames** as a non-View inline scope producer
(§4). The editor has already *replaced* the `forEach` attribute with `<GridLayout>`
(`design/gridLayout_element_design_prompt.md`), which forwards each collection item as the
data model of its single child — i.e. GridLayout is the editor's current inline
item-scoping mechanism, the `forEach` successor. The conceptual role is identical (an
inline, non-View, lightweight item scope that needs no mount). **No change to GridLayout is
mandated here**; whether the C++ runtime ultimately spells inline repetition as `forEach`,
GridLayout, or both is a runtime-vs-editor reconciliation **tracked elsewhere, deferred,
not resolved in this addendum.**

## 7. Supersedes

Net of convergence, the original model is mostly correct, so the supersede list is small.
Doc references are to `design/xgui_ta.md`; file:line citations point at the implementation
the rule touches.

1. **The controller factory signature.**
   - Implementation: `src/pages/xgui/controllerScript.ts` — the seeded controller is
     `function(view) … return {} end` (lines 12–20).
   - **Superseded by §2.7 / §2.8:** the factory is `function(view[, model])`, and a
     controller may call `view:setModel(...)` to set / project / reject the model before
     returning its handler table. Update the starter template (`NEW_CONTROLLER_TEMPLATE`).

2. **`scopeName` is a new authoring attribute (additive).**
   - `xgui_ta.md` §"Elements in more detail" → **`<View>`** (lines 52–53) lists only
     `controller`. **Extended by §2.6 / §2.12:** the root `<View>` also accepts an optional
     `scopeName` (the `{$name.x}` named-reach publisher). Additive — it removes nothing.

3. **"One model per component" reframed as "one frame per View, chaining across mounts."**
   - `xgui_ta.md` §"Current state" (line 24) and §5 "Data Model panel" (lines 505–507):
     the per-component Data Model is a single flat JSON object.
   - Implementation: `src/lib/guiBinding.ts` — `flatRootScope` resolves tokens against one
     flat model with **no `$.` root and no named scopes** (the SCOPE note, lines 31–37; the
     resolver, lines 76–87).
   - **Reframed by §2.10 / §4 (mostly a clarification, not a reversal):** per file the
     representation is the **same** — one frame per View == one model per component. What
     the runtime adds on top is (a) **chaining across `<Component>` mounts** (which the
     editor already approximates via per-mount fresh roots — §8) and (b) the **`{$.}`
     whole-frame and `{$name.x}` named references**, which the flat resolver does not yet
     support. Closing (b) is the one resolver extension this addendum implies (§2.11, §3);
     (a) needs no change.

**Explicitly NOT superseded:** the `<Component>` child-data-scope rule (`xgui_ta.md`
"Component child data scope resolved (architect)" / `src/lib/guiComponentMount.ts`) —
overrides-as-fresh-root, the value boundary, pre-resolution, the cycle guard, and
`data="key"` base-object semantics all **stand**, and are the concrete embodiment of
§2.4's call-site `data=` (see §8). The rendering model (rel/abs geometry, the nested
`layer` z-order in `guiZOrder.ts`, the preview stage/zoom/pan), the palette, saving,
watching, and the component-list/file model are untouched.

## 8. Already aligned (the editor already gets these right)

Under the converged model, the following are **correct as-is** and need **no** rework:

1. **`<View>` is the mandatory root.** `parseGui` requires the root element to be `<View>`
   (`src/lib/guiNode.ts` lines 301–304), enforces `<View>`-only-at-top (line 225), and
   `<Event>`-only-under-`<View>` (lines 228–230). This is exactly §2.1.
2. **`<View>` is root-only, never a child, one per file.** The structure tree never offers
   `<View>` as an addable child: `src/pages/xgui/guiTreeEdit.ts` enforces "`<View>` is the
   TOP-LEVEL element only — it is never added as a child" (lines 78–79), never creates a
   `<View>` child node (lines 186–187), and the `allowedChildTags` `View` case lists visual
   children + `<Event>` + `<Component>`, **not** `<View>` (lines 100–101). This is §2.1.
3. **`<View>` is non-visual; the stage renders its children.** The Properties panel treats
   `<View>` as non-visual — `nodeHasId` excludes `View` (`src/pages/xgui/guiProperties.ts`
   lines 136–137) and the `View` case shows **no** geometry/style fields, routing
   `controller` through the Controller tab (lines 204–206, 284–290). The preview renders
   the component's children into the fixed stage rather than drawing a box for the View.
   This is exactly §2.2 — **the earlier "render a non-View root as a real box" idea is
   discarded** (§9).
4. **Backend view-vs-widget classification.** `classify_kind`
   (`src-tauri/src/dal/gui.rs` lines 621–631) classifies by root tag (`View` → view). With
   `<View>` reinstated as the mandatory root, this heuristic is correct, not in need of
   revision.
5. **One controller per component file.** The Controller tab edits the single
   `{component}_controller.lua` wired to the root `<View controller=>`
   (`src/pages/xgui/controllerScript.ts`; `xgui_ta.md` §4 line 502), and the save pipeline
   pairs one XML with one controller. This is §2.7 / §2.10. The only change is the factory
   *signature* (§7.1), not the count.
6. **`data=` is on `<Component>` only, with the call-site meaning.** `DATA_ATTR = "data"`
   lives on `<Component>` (`src/lib/guiComponentMount.ts` line 53); `resolveChildRoot`
   (lines 186–194) seats it as the child's fresh root; `data` is excluded from a `<View>`'s
   vocabulary. This is §2.4 — keep it, and never add a `data=` to `<View>`.
7. **The mount scope-boundary machinery already composes** — fresh root per mount, no
   parent-data leak (`src/lib/guiComponentMount.ts`). This is exactly §2.3's per-mount
   isolation and §2.10's chaining; `data="{$.}"` (§2.11) is the explicit opt-out that rides
   the same machinery (once `{$.}` is supported — §7.3).
8. **There is no `<Scope>` element** (`GuiTag` / `KNOWN_TAGS`, `src/lib/guiNode.ts` lines
   20–23). Nothing to remove for §2.13.
9. **The shape-from-bindings scaffold exists** — `extractShape` / `reconcileModel`
   (`src/pages/xgui/guiModelScaffold.ts`) derive a component's model shape from its
   `{token}`s, the basis for §2.5 and the §5 mount check.

## 9. Alternatives considered and discarded

Ideas that were explored on the way to the converged model and **dropped**:

- **`<View>` opt-in / non-`View` layout roots ("a file root may be a plain layout
  element").** Dropped — the model converged on `<View>` as the **mandatory** root: every
  file is uniformly a scope holder, which is simpler than a screen-vs-widget root split and
  keeps the editor's existing parser/renderer correct.
- **A layout-rooted-vs-View-rooted component duality** (the `data=` duality: "View-rooted
  isolates and receives data; layout-rooted is a transparent fragment that takes no data").
  Dropped entirely — there is only **one** kind of component: every View isolates and takes
  data, and transparency is expressed by `data="{$.}"` (§2.11), not by a second component
  kind.
- **"Bare `<View>` = transparent pass-through," with isolation triggered by `scopeName`/`controller`.**
  Dropped — every `<View>` isolates **unconditionally** (§2.3); no attribute gates
  isolation.
- **A `<Fragment>` element / a `transparent` flag / pass-through-by-default.** Dropped —
  the single, explicit transparency mechanism is `data="{$.}"`; no new element or flag is
  introduced.
- **Attribute-name candidates `as=` / `scope=` / `provide=`** for the named-frame
  publisher. Dropped in favor of **`scopeName=`** (camelCase house style + exact match to
  the C++ `ScopeName` / `Scope` binding vocabulary — §2.6).
- **The three editor changes for non-`View` roots** — "make `parseGui` accept a non-`View`
  root," "make the renderer draw a non-`View` root as a real box," and "make
  create/scaffolding offer a layout root." All dropped — with `<View>` reinstated as the
  mandatory root, the editor **keeps its current behavior** on all three (see §8.1, §8.3).
