# XGUI

## Context

We are improving the GUI engine for Script Kitties and to start with we are creating a GUI editor in the Script Kitties Editor. 

## Purpose

The purpose is to create a fully functioning MVP GUI editor in the Script Kitties Editor. This document describes clearly the requirements to achieve that.

## Overview

The GUI editor lives as a new tool in the navrail (the icon signifies this is for editing GUIs) and a whole new page separate from the other existing tools. It is positioned immediately below the workbench tool and above the data tables tool. 

## XML Elements

XML is used to describe the visual layout of the component. The following elements are supported in phase 1:
```xml
<View> - the top level element, optionally defines a lua controller
<Panel> - a flexible UI element that can be positioned, textured, and sized
<Text> - a flexible UI element identical to a Panel except more explicitly a Text field
<Component> - signifies this element is defined in another source file
<Event> - registers an event listener. Events may only be present as an immediate child of `<View>`
```

In phase 2, we would consider the following additional elements. Phase 1's implementation must support these seamlessly:
```xml
<HorizontalLayout> - automatically places child elements in a horizontal pattern
<VerticalLayout> - similar but for vertical patterns
<GridLayout> - renders vertically and horizontally
```

### Elements in more detail

Supported properties for each element

**<View>**
- `controller` - a lua file attached to this view. Not required

**<Panel>**
- `id` - required, this is the name used to reference the elmeent in lua. follows parent hierarchical structure (see examples below)
- `position` - optional, follows a format of `"relativeX,relativeY,absoluteX,absoluteY"` eg `position="1,0,0,5"` puts the element at the top right corner and 5 pixels down. default is `"0,0,0,0"`
- `size` - optional, same format as position. default is `"1,1,0,0"`. A `0` in any field means **literal zero** (zero scale or zero pixels) — there is no content/auto sizing.
- `borderColor` - optional, color of the border. default is transparent
- `borderSize` - optional, size of the border. default is 1 pixel
- `texture` - optional, sprite used as the background. default is none
- `backgroundColor` - optional, color of the background. default is transparent
- `visible` - optional, signifies the starting visibility state of the element. default is true
- component event handlers (`onKeyPressed`, `onMouseMoved`, `onMouseEntered`, `onMouseExited`, `onMouseClicked`) - optional, value is a function name
- `layer` - optional, integer value, higher number renders on top of lower numbers. default is 0 (base layer)

**<Text>**
everything in `<Panel>` plus:
- `text` - required, the string to display. Can use `{}` to denote parameterization eg `{health}` will read the `health` attribute of the model and replace the text with that value automatically. eg `Health: {health}/{maxHealth}` might result in the produced string `Health: 15/25`
- `textColor` - optional, default is Color(185,178,165,255)
- `textAlign` - optional, default is left-aligned
- `fontSize` - optional, the size of the text, default is 14

**<Component>**
Note: `<Component>`s cannot have children. The _definition_ of that component (the source file) can obviously have children, but you can't nest elements inside a `<Component>` directly.

Properties:
- `id` - required, this is the name used to reference the elmeent in lua. follows parent hierarchical structure (see examples below)
- `src` - required, the name of the source file eg `button.xml` 
- `position` - optional, follows a format of `"relativeX,relativeY,absoluteX,absoluteY"` eg `position="1,0,0,5"` puts the element at the top right corner and 5 pixels down. default is `"0,0,0,0"`
- `size` - optional, same position as position. default is `"1,1,0,0"`
- `visible` - optional, signifies the starting visibility state of the element. default is true
- other properties can be defined on the component which will translate to overrides in the component

**<Event>**
- `name` - required, the name of the event eg `Battle:OnCreatureDied`
- `handler` - required, lua function name defined in the controller

**Editor's role with events (intentionally thin):** events are a global bus at *runtime* — anyone can emit, anyone can subscribe — but the **editor does not model any of that.** From the editor's perspective an event (and likewise an element handler such as `onMouseClicked`) is just a **name → function-name mapping** that it stores as written. The editor does no validation that the handler exists, no tracking of who emits or subscribes to a name, and no payload awareness. The bus semantics are owned by the user and the controller script.

### Data binding (`{token}` on properties)

`{token}` parameterization is **not limited to `<Text>`'s `text`** — it applies to element properties generally. A property value may be a **literal** or a **binding** that reads from the controller-supplied data model. This is what lets the preview render real states (selected, empty, low-health, etc.) and keeps dynamic visuals declarative instead of pushing them back into imperative controller Lua.

The rule for what can bind is **presentation vs. structure**: *if a property changes how the element looks, it can bind; if it changes who the element is or what it's wired to, it stays literal.*

**Bindable (presentational):** `position`, `size`, `texture`, `backgroundColor`, `borderColor`, `borderSize`, `visible`, `textColor`, `textAlign`, `fontSize`, `text`, `layer`.

**Literal only (structural / identity):**
- `id` — the element's identity and reference path (`view.stats.health`); referenced by the controller and the computed-id system, so it cannot be data-driven.
- `src` (on `<Component>`) — defines which subtree mounts. (Binding it = swapping the whole child tree; a heavier feature, not in scope.)
- `controller` (on `<View>`) — a file reference.
- event handler names (`onMouseClicked`, `<Event handler=…>`, `<Event name=…>`) — these point at code, not data.

**Compound properties bind per-field.** `position` and `size` are four values each (`relX,relY,absX,absY`); each field is independently a literal *or* a token. This is what makes data-driven sizing possible, e.g. a health bar: `size="{healthRatio},1,0,0"` binds scale-x and fixes the rest.

**Interpolation vs. whole-value:**
- **String-typed properties** (`text`, `texture`) allow interpolation — tokens embedded in a string, e.g. `text="Health: {health}/{maxHealth}"`, `texture="icon_{type}.png"`.
- **Typed properties** (numbers, colors, booleans — `visible`, `backgroundColor`, `fontSize`, a single `position`/`size` field, etc.) are **whole-value bind only** — the token must resolve to the entire value, e.g. `backgroundColor="{barColor}"`, `visible="{isOpen}"`.

**No format specifiers.** Tokens are raw substitution — there is no `{health:%.0f}`-style formatting syntax. If a value needs rounding, padding, or any formatting, the **controller pre-formats it into a string** and the data model supplies the finished string. (Consistent with the editor staying thin: presentation-of-values is the controller's job.)

**In the editor:** a property field accepts either form inline — typing `{healthRatio}` makes it a binding (styled distinctly), typing `0.5` makes it a literal. No separate mode toggle. Unresolved tokens render literally-but-styled in the preview (see Data Model panel) until the data model supplies a value.

### Colors and the palette

Named theme colors are defined in a **JSON palette** (a simple `name → color code` map), not in Lua. The palette is authored/edited in the **Registry** tool so the user can rename or recolor entries in one place. The GUI editor reads that palette and the game runtime resolves against the same source.

A color property (`borderColor`, `backgroundColor`, `textColor`) can therefore take one of:
- a **palette name** — a bare string, e.g. `textColor="TextDefault"` (resolved through the palette JSON);
- a **literal color code** — e.g. `textColor="185,178,165,255"` (an override, when the user wants a one-off color);
- a `{token}` **binding** — e.g. `backgroundColor="{barColor}"` (resolved from the data model, per Data binding above).

**Resolution rule:** if the value is a `{token}` it binds; else if it matches a palette key it resolves through the palette; else it is parsed as a literal color code. (Palette keys are identifiers and color codes have a distinct numeric/`#` form, so the two don't collide.)

**In the editor:** a color field offers the **palette entries as named swatches** to pick from, plus an option to enter a custom color code (override) or a `{token}`. The preview resolves palette names through the palette JSON so colors render true. Because references are by name, recoloring a palette entry in the Registry updates every GUI that uses it — the reason to prefer a palette name over a literal.

Scope note: the palette holds **colors only** for now (not fonts/sizes/other theme values).

#### Palette on-disk location and DAL exposure resolved (architect)

The load-bearing constraint is in the requirement itself: *the runtime resolves against the same source.* That single sentence settles the location and rules out the obvious-but-wrong choice.

**Location: `<gameInstallPath>/Data/gui_palette.json` — it is game data, not editor config.**

- The existing Registry tool persists to `./editor.registry.json` (the app's working dir, see `src-tauri/src/registry/mod.rs`). That file is **editor-private** — the game never reads it. **The palette must not follow that pattern.** A palette the runtime reads cannot live in the editor's private config; it has to ship inside the game's data tree.
- It lives under `Data/` (alongside `abilities.json`, `creatures.json`, …), **not** in the `gui/` folder. Rationale: the `gui/` folder holds *component XML and controllers* (per-screen structure + behavior); the palette is *project-global theme data* that the runtime resolves for every screen. It is a sibling of the other domain JSON files, and placing it in `Data/` means it is picked up by `update_asset_manifest`'s existing walk and watched by the existing `Data/` non-recursive watch with zero new watcher wiring.
- It is **game data the editor edits**, exactly like `charms.json`. The Registry *tool* (the UI surface) edits it, but it is persisted to game data, not to `editor.registry.json`. Keep these two storage substrates distinct in the implementation: the palette is a new DAL domain writing to `Data/`, even though its editing UI sits in the Registry tab next to enum sections that write to `editor.registry.json`. (This split is the one real coupling subtlety in the Registry tool — name it in the plan so the engineer doesn't dump the palette into the registry config file for convenience.)

**Shape: a flat `name → color-code` object.**

```json
{
  "TextDefault": "185,178,165,255",
  "PanelBg":     "0,0,0,200",
  "Accent":      "255,210,40,255"
}
```

- Values are the same `r,g,b,a` color-code string form already used inline in XML (`textColor="185,178,165,255"`), so the resolver parses palette values and inline literals through one code path.
- Flat map, not an array of `{name, code}` records: lookup is by name (`textColor="TextDefault"` → one map hit), and the runtime wants the same direct keyed access. (This differs from the Registry enums' `{value, description}[]` shape; the palette has no per-entry description requirement, and a keyed map is the right structure for name resolution. If descriptions are wanted later, they go in a sidecar or a `_meta` block, not by reshaping the resolution map.)
- Keys are palette names (identifiers); the resolution rule above (`{token}` → bind; else palette-key match; else parse as literal code) relies on palette names being identifiers and codes being numeric, so the three never collide.

**DAL exposure: a new `palette` domain, mirroring the existing per-domain pattern.**

Consistent with every other domain in `src-tauri/src/dal/`:
- New `dal/palette.rs` owning `get_palette()` / `save_palette(palette)`. `get_palette` reads `Data/gui_palette.json`, caches in a new `Cache<(), Arc<Palette>>` field on `Dal` (where `Palette = BTreeMap<String, String>` or an order-preserving map; see below), returns the cached `Arc`. `save_palette` writes atomically via the existing `atomic_write` + `serialize_pretty`, then refreshes the cache — identical to `save_charm`.
- A `Palette` model type in `model/` (`BTreeMap<String,String>`, or a `serde_json`-`preserve_order` map if author-controlled key order matters for diffs — prefer order preservation so re-saves don't churn the file, matching the manifest's order-preserving discipline).
- New Tauri commands `get_palette` / `save_palette` registered in `lib.rs`, thin wrappers in `commands/`, per the established three-step add-a-command recipe.
- Watcher: add one row to the `invalidators` table in `dal/mod.rs` for `data_dir.join("gui_palette.json")` invalidating the new palette cache — same shape as the `charms.json` row. No new watch path needed (it's under the already-watched `Data/`).
- **First-run absence:** if `Data/gui_palette.json` doesn't exist, `get_palette` returns an **empty palette** (`Ok` with no entries), not an error — a fresh project simply has no named colors yet, and the color field falls back to literal-code entry. (Contrast with `get_script`'s broken-install error: a missing palette is a legitimate empty state, not a corrupted install.) `save_palette` creates the file on first write.

The frontend's GUI-editor preview resolves palette names through `get_palette` (cache it module-level like `Sprite.tsx` does for sprites), so colors render true and recoloring an entry in the Registry updates every GUI that references it by name.

#### Registry palette-editing UI (ux-designer)

The palette is edited in the Registry tab, but it is **not** another enum section — it writes a *different file to a different substrate* (`Data/gui_palette.json`, game data) than the enum sections (`editor.registry.json`, editor config). The whole design problem here is making that split **legible** so the user never wonders why one tab saves two things to two places.

**Layout — a separate, visually distinct band, not a card in the enum grid.**

Today the Registry page is: a header (title + one Save/Reset pair) over a `grid-cols-1 xl:grid-cols-2` of enum-section cards, all governed by one draft + one dirty state + one Save that writes `editor.registry.json`. The palette must **not** be dropped into that grid (it would read as "just another enum" and imply the page Save covers it). Instead:

- Split the page into **two labeled regions** with a clear divider between them:
  - **"Editor enums"** (the existing grid) — framed as *"values that populate the editor's own dropdowns,"* writes `editor.registry.json`.
  - **"GUI color palette"** (the new region, full-width below the enum grid) — framed as *"named theme colors the **game** reads at runtime,"* writes `Data/gui_palette.json`.
- Each region carries a small, persistent **target-file caption** in its header (e.g. a muted `editor.registry.json` / `Data/gui_palette.json` monospace tag). Naming the file is the cheapest, most honest way to make "two backends, one tab" legible — the user sees exactly where each region's Save lands.
- Give the palette region a distinct accent (e.g. a left border / different card tint than the enum cards) so the eye registers it as a different *kind* of thing, not a sibling enum. It reads as game-facing data, the enums read as editor-facing config.

**Independent save state — the load-bearing rule.** The palette region has its **own draft, its own dirty flag, and its own Save/Reset**, scoped to the palette only and physically located *in the palette region's header* (not the page header). The existing page Save/Reset stays with the enum region and continues to write only `editor.registry.json`. **Two backends → two Saves, each co-located with the data it persists** — the control's location tells you what file it writes. Do not add a single "Save all" that writes both; that is exactly the collapse the architecture warns against, and it reintroduces the confusion this layout exists to prevent. (If both regions are dirty and the user navigates away, warn per-region — consistent with the GUI editor's warn-on-switch.)

**Per-entry row (add / rename / recolor / remove).** The palette is a flat ordered `name → "r,g,b,a"` map; each entry is one row:

- **Swatch** — a color chip rendering the entry's current `r,g,b,a` over a checkerboard (so alpha is visible). Clicking it opens an RGBA color picker; picking writes the code back. The swatch is the *recolor* affordance and the at-a-glance read of the palette.
- **Name field** — the palette key (an identifier, e.g. `TextDefault`). Mono, like the enum value field. Editing it is *rename*.
- **Color-code field** — the raw `r,g,b,a` string (e.g. `185,178,165,255`), directly editable for users who type codes; kept in sync with the swatch. This mirrors the inline literal form used in XML, so the same value reads identically in both places.
- **Remove** button (trash icon), matching the enum row.
- An **"Add color"** button at the foot of the region appends a blank row (empty name + a sensible default code). Validation mirrors the enums: no empty names, no duplicate names (names are the resolution key and must be unique within the palette).

**Trust framing — surface both the power and the hazard, honestly.** Because references resolve *by name* and the editor is intentionally thin (it does **not** index which GUIs use which color — see the events/thin-editor stance), the UI must frame the consequences rather than track them:

- **Recolor is the headline benefit** — a short line in the region header: *"Recoloring a palette entry restyles every GUI that uses it by name."* This is the reason to prefer named colors over literals, stated where the user is recoloring.
- **Rename and remove are footguns** — both silently break references (`textColor="TextDefault"` stops resolving if `TextDefault` is renamed or removed), and the editor will **not** find or fix those references for you. So:
  - On **remove**, and on **rename** (a name edit that commits to a different key), show a brief inline confirm/warning: *"GUIs that reference this color by name will stop resolving it — the editor can't update those references for you."* Keep it lightweight (an inline warning or a confirm on Save), not a modal per keystroke.
  - Do **not** promise a "used by N components" count or a reference list — that would require the cross-file indexing the editor deliberately doesn't do. The warning is unconditional and honest about the thinness instead of faking knowledge it doesn't have.

**Empty state.** A fresh project has no `gui_palette.json`; the palette region shows an empty state with the "Add color" affordance and a one-line note that colors added here become available as named swatches in the GUI editor's color fields — closing the loop between where colors are *defined* (here) and where they're *used* (the GUI editor Properties panel).

### Repetition and control flow (`forEach`)

Real screens are list-driven (item grids, stat rows, creature tabs, ability lists). Rather than a dedicated `<Repeater>` *element*, repetition is a **binding attribute that any element can carry** — `forEach`. This keeps the element set small and means future control flow (notably conditional rendering) grows by **adding attributes, not new element types.**

```xml
<Component src="biogram_slot.xml" forEach="{biograms}" size="0,0,64,64"/>
```

- `forEach="{collection}"` — the element (and its subtree) is **stamped once per item** in the bound collection. The element it sits on *is* the template; there is no separate template/container concept.
- **Scoped data context:** inside a repeated element, tokens resolve against the *current item*. The exact scoping syntax (item-relative `{name}` vs. explicit `{item.name}`) is an open semantic — see below.
- Works on `<Panel>`, `<Text>`, and `<Component>`. On a `<Panel>` the whole subtree repeats; on a `<Component>` the component instance repeats (one per item).

**Future companion — conditional rendering:** when needed, conditional rendering follows the *same* attribute pattern — e.g. an `if="{hasCreature}"` attribute on any element — **not** a new `<If>` element. `forEach` and `if` are the same family: control flow expressed as bindable attributes on ordinary elements. (Only `forEach` is in scope now; `if` is named here so the mechanism is reserved.)

**In the editor:** a `forEach` element appears as a single node in the tree with a Properties field ("Repeat for each: `{collection}`"). The preview, driven by the Data Model panel, stamps one rendered instance per item — design the one, see the many. (Direct-manipulation drag on a repeated element moves the template/all instances, not a single instance, since instances are data-driven — per-instance dragging is not meaningful.)

#### `forEach` semantics resolved (architect)

These were the three deferred open semantics. The governing principle is the same one the rest of the editor commits to: **the editor authors structure; the runtime owns meaning.** `forEach` is therefore resolved as a small set of *authoring rules*, not a runtime feature the editor simulates beyond what the preview needs.

**(a) Keying / identity — optional `key` attribute, default index-keyed.**

A repeated element may carry an optional `key` attribute whose value is a token resolved in the *item scope* (see (c)):

```xml
<Component src="biogram_slot.xml" forEach="{biograms}" key="{id}" size="0,0,64,64"/>
```

- `key` is a **structural/literal-only attribute** (it joins `id`, `src`, `controller`, and handler names in the literal-only set). It names a field path within each item; it is not itself a data binding that the editor pre-resolves to a value.
- **Default when omitted: positional (index) identity** — instance *n* maps to item *n*. This is the simplest rule and is correct for the MVP's static-preview needs (the Data Model panel supplies a fixed array; there is no live insert/remove/reorder to track).
- **Why offer `key` at all if the editor doesn't need it:** identity is a *runtime* concern (preserving per-instance state — focus, selection, scroll, animation — across data-model mutations). The runtime needs the authored hint; the editor would lose nothing by dropping it but would force a later breaking XML change to add it. We reserve the attribute now, store it verbatim, and let the runtime honor it — consistent with how the editor stores event handlers it doesn't interpret.
- **Editor obligation:** store `key` as written; surface it as one Properties field on the repeated node ("Key: `{id}`"). The editor does **not** validate that the field exists on items, nor does it use `key` to optimize its own re-stamp (it re-stamps wholesale on data-model change — the preview arrays are small). Do not build editor-side identity diffing.

**(b) Empty state — renders nothing; the template node stays in the tree.**

When the bound collection is empty (or the token is unresolved in the Data Model), the element produces **zero rendered instances** in the preview. There is no built-in placeholder/empty slot.

- The **template node remains a single node in the tree** regardless of collection contents — it is the authored element, not a rendered instance. It is always selectable, editable, and draggable there even when the preview shows nothing. This is what keeps "design the one" possible when the many is currently zero.
- An author who wants a visible empty state composes it the same way they would at runtime: a sibling element bound with the reserved `if="{isEmpty}"` (the conditional companion named below). The editor does not special-case empty collections — staying thin.
- **Unresolved vs. empty are the same render outcome (nothing), but read differently in the tree:** an unresolved `forEach` token is styled as a waiting-binding (consistent with unresolved `{token}` styling elsewhere); an explicitly empty array renders nothing without that "waiting" affordance. Both are zero instances in the preview.

**(c) Scoped data context — item-relative by default, `$` escapes to the root model. Nesting composes by shadowing.**

Inside a repeated element's subtree, bare tokens resolve **item-relative**:

```xml
<Panel forEach="{biograms}">
  <Text text="{name}"/>          <!-- the current item's `name` -->
  <Panel backgroundColor="{color}"/>  <!-- the current item's `color` -->
</Panel>
```

This is the common case (a slot binding its own item's fields) and keeps templates terse. The resolution rule for a bare token `{name}` inside a `forEach` subtree:

1. look it up on the **current item** first;
2. if absent on the item, **do not** fall through to the root model — a bare token is item-scoped, full stop. (Silent fall-through to the root is the kind of accidental coupling that makes templates impossible to reason about: a typo in an item field would quietly resolve against unrelated root data.)

To reach the **root model** from inside a repeated subtree, use the explicit `$` root prefix:

```xml
<Text text="{$.currency} {name}"/>   <!-- root `currency`, then item `name` -->
```

- `$` always denotes the top-level data model, irrespective of nesting depth. There is exactly one root.
- **No explicit `item.` prefix.** Bare = item; `$.` = root. Two scopes, two syntaxes, no third "current-item-by-name" form. (`{item.name}` was the alternative; rejected because it forces every template to name its loop variable, adds a reserved word, and complicates nesting — bare-is-item is the terser rule and the more common case.)

**Nesting** composes by **lexical shadowing**, which is what keeps the rule simple enough to not preclude nested `forEach`:

```xml
<Panel forEach="{rows}">                 <!-- item scope A = a row -->
  <Text text="{label}"/>                  <!-- A.label -->
  <Panel forEach="{cells}">               <!-- {cells} is A.cells; item scope B = a cell -->
    <Text text="{value}"/>                <!-- B.value -->
    <Text text="{$.title}"/>              <!-- root title -->
  </Panel>
</Panel>
```

- The inner `forEach="{cells}"` binds against the **nearest enclosing item scope** (row A), so `{cells}` means `A.cells`. Once inside the inner loop, bare tokens are the cell (scope B); the row (scope A) is shadowed.
- **There is no `parent`/`..` escape to an intermediate scope.** From the inner loop you can reach the current item (bare) or the root (`$.`), but not "the row two levels out." This is a deliberate limit: an intermediate-scope escape is the feature that makes nested templates hard to read and is not needed for the list-driven screens in scope. If a deeply nested template needs an ancestor's field, the controller flattens it into the item or onto the root — pushing the join into data, where it is explicit. (Reserved for a future `^`/`parent.` syntax if real screens demand it; named here so the door isn't accidentally closed by the `$`-only rule.)

**Editor obligations for scoping (thin):** the editor's preview evaluator walks the data model with a scope stack (push item on entering a `forEach` subtree, pop on leaving; `$` reads the stack bottom). It does **not** type-check tokens against the model, infer item shapes, or warn on misses — an unresolved token renders literally-but-styled exactly as a top-level unresolved token does. The scope stack exists only to make the preview render the right values; it carries no validation responsibility.

**Summary of the rule set (the simplest that doesn't preclude nesting):**
| Concern | Rule |
|---|---|
| Item field | bare token `{name}` — item scope only, no root fall-through |
| Root field | `$.` prefix `{$.currency}` |
| Intermediate ancestor | not addressable (push to item or root in the controller) |
| Identity | optional literal `key="{id}"`; default positional |
| Empty / unresolved | zero instances; template node persists in tree |
| Nesting | lexical shadowing; nearest item wins |

#### Component child data scope resolved (architect)

> **F6b one-liner:** A mounted `<Component>` child resolves its `{token}`s against **its override attributes only, as a fresh root** (no parent data, no parent `$`); the parent **pre-resolves** each override value in its own scope (forEach item scope included) and hands the child concrete values — so the override boundary is a *value* boundary, not a token boundary.

This settles architect risk #4 and is the second scope boundary in the renderer (the first being `forEach`). It is built to compose with the already-locked `forEach` scope-stack rules above — bare = item-scoped, `$.` = root, lexical shadowing, no root fall-through, no intermediate escape — without contradicting any of them. The governing principle is the same: **a component is a reusable unit; its internals must be reasonable in isolation, never coupled to whichever parent happens to mount it.**

**(a) What scope a mounted child sees — overrides-only, as a *fresh root*. No parent data, no parent `$`.**

When the preview mounts `<Component src="child.xml" actionText="Sell" qty="3"/>`, the data model the child's subtree resolves against is **exactly the override attributes on that `<Component>` element** — `{ actionText: "Sell", qty: "3" }` — and nothing else.

- The child does **not** see the parent's data model. A bare `{actionText}` inside `child.xml` resolves to the override; a bare `{money}` that the parent's model happens to define resolves to **nothing** (renders as an unresolved-but-styled token), because `money` was not passed in. This is the prop boundary: the only way data crosses into a child is by being named on the `<Component>` element.
- **`$.` inside the child means the child's own root, which *is* the overrides — not the parent's root.** There is one root per *mount*, and a `<Component>` mount starts a fresh one. So `{$.qty}` inside `child.xml` equals `{qty}` equals the `qty` override. The child cannot reach the parent's `$` root. (This is the one place the earlier *recommendation* left open — "plus the same `$` root if the runtime exposes one globally" — and it is closed in favor of **no parent-`$` leak**. A global-`$` escape would let any child silently bind to whatever top-level model it is dropped into, which is exactly the accidental coupling the whole boundary exists to prevent; if a child genuinely needs a global value, the parent passes it explicitly as an override, e.g. `currency="{$.currency}"`.)
- Consequence for the preview evaluator: **mounting a `<Component>` pushes a new scope stack whose bottom (root) is the resolved overrides object**, not a continuation of the parent's stack. The parent's stack does not bleed across the mount. (Inside the child, a `forEach` then pushes item scopes onto *the child's* stack exactly as in section (c) of the forEach rules — the two mechanisms nest cleanly because each `<Component>` mount reseats the stack bottom.)

**(b) A `forEach`-stamped `<Component>` — overrides resolve in the PARENT's item scope; the child's own scope is independent.**

For `<Component src="biogram_slot.xml" forEach="{biograms}" key="{id}" label="{name}" tint="{$.theme}"/>`:

- The `<Component>` element sits **in the parent scope**. Its override values are therefore resolved against the parent's current scope stack — which, because this element carries `forEach`, is the **current item scope** (the current biogram). So `label="{name}"` resolves to *this biogram's* `name`, and `tint="{$.theme}"` resolves to the parent root's `theme`, all per the locked `forEach` rules (bare = item, `$.` = parent root, no fall-through). Each stamped instance gets its own resolved override set.
- Those resolved values become the instance's overrides — i.e. that instance's child-root. **Inside `biogram_slot.xml`, `{label}` is the concrete value already computed in the parent's item scope.** The child does not know it was stamped by a `forEach`, does not see `{biograms}`, and cannot reach the item scope or the parent root directly. It only sees its own resolved props.
- This is the clean composition the boundary buys: the parent's item scope is used to *fill the props*; the child's scope is sealed off from it. There is no third "look at the loop item from inside the child" path, mirroring the deliberate "no intermediate ancestor escape" decision in the `forEach` rules.

**(c) Override values are PRE-RESOLVED in the parent scope and passed as concrete values — not passed as raw token strings re-resolved in the child.**

This is the linchpin that makes (a) and (b) hold. When the preview mounts a child:

1. For each override attribute on the `<Component>`, **resolve its value in the parent's current scope** (item scope if under a `forEach`, root otherwise) — turning `label="{name}"` into `label = "Bitlynx"`.
2. Build the child's root model from those **resolved, concrete values**.
3. Render the child against that model; the child's `{token}`s read concrete props.

The override boundary is therefore a **value boundary, not a token boundary.** A raw-token model — where `label="{name}"` is handed into the child as the *string* `"{name}"` and re-resolved against the child's model — is explicitly **rejected**: it would make the child re-resolve a parent's token namespace, silently coupling child internals to whatever the parent's fields happen to be named, and would make `forEach`-item tokens (which only exist in the parent's scope) meaningless or wrongly-resolved inside the child. Pre-resolution severs that coupling: by the time a value reaches the child, it is data, not a reference into someone else's scope.

- **Literal overrides** (`actionText="Sell"`) are already concrete and pass straight through.
- **Token overrides** (`label="{name}"`, `tint="{$.theme}"`) are resolved in the parent scope per the rules above, then passed.
- **Unresolved-in-parent overrides** stay unresolved-but-styled and are passed as their unresolved form, so a missing parent field surfaces visibly at the boundary rather than silently re-resolving inside the child.

**Editor obligation (thin, consistent with the rest of the renderer):** the preview's mount step resolves overrides in the parent scope, seats them as the child's fresh root, and recurses — it does **not** merge parent and child models, does **not** expose parent `$` to the child, and does **not** validate that the child actually consumes a given override. Unconsumed overrides are harmless; unresolved child tokens render literally-but-styled exactly as everywhere else. The cycle guard and missing-`src` placeholder (section (3)) wrap this same mount step.

**Summary of the child-scope rule set:**
| Concern | Rule |
|---|---|
| Child's data model | the `<Component>`'s override attributes **only** — a fresh root |
| Parent data visible to child | none, except what the parent passes as an override |
| `$.` inside the child | the child's own root (= its overrides), **not** the parent root |
| Override token like `{name}` under a `forEach` | resolved in the **parent's item scope**, then passed as a value |
| Override token like `{$.theme}` | resolved against the **parent's** root, then passed as a value |
| Pass mode | **pre-resolved concrete values**, never raw tokens re-resolved in the child |
| Scope stack | a `<Component>` mount **reseats the stack bottom** to the resolved overrides |

### High Level Visual Layout

The editor has three working columns, left to right: the **component list** (collapsible), the **structure column** (tree + properties + events), and the **main content** (tabbed preview/controller, with a collapsible Data Model panel on its right).

#### 1. Component list (leftmost, collapsible)

A **folder tree** that mirrors the `gui/` folder (and its subfolders) in the configured project directory. It shows every component *file* in the project, organized by the folders the user has put them in. Everything is a component — even top-level things like "Profile" and "Battle" are components (though they are defined as `<View>`s in code, since that's the top-level element). The Rust backend will need to be updated to read this folder tree.

- **Folders are the organizing axis.** The tree reflects the on-disk subfolder structure exactly — the user groups components however they like (by feature: `profile/`, `battle/`; or by kind: `screens/`, `widgets/`). Folders are collapsible.
- **View-vs-widget is a per-item indicator, not a grouping.** Each component shows an icon/badge for whether it is a top-level `<View>` (screen) or a reusable sub-component (widget), so the user can still tell a destination from a part at a glance — but that distinction is a glyph on the item, not the tree structure (folders own structure).
- This panel is collapsible like the workbench (toggle via its navrail icon) to give the preview more room.
- **Creating things** (a `+` at the top, next to the search bar — and right-click context actions on folders):
  - **New component** — asks for the name and a **destination folder** (an existing folder, or create one inline). Writes `{component_name_in_snake_case}.xml` into that folder, optionally a controller script (`{component_name_in_snake_case}_controller.lua`) alongside it, **and registers the new file(s) in `assets.json`** (gui files are manifest-resolved by the runtime — see the create-flow resolution below).
  - **New folder** — creates a subfolder under the selected folder (or `gui/` root) to organize components into. New components can then be created in it, or existing ones moved in.

Note: the component list (every component file, in its folders) and the tree (the element hierarchy *inside* the selected component) are two different things and should read as such — one is the project's files, the other is one file's elements.

#### Component list as a recursive tree + create-flow mechanics resolved (architect)

Two earlier recommendations were reversed by product decision and are settled here. I verified the relevant facts against the real `worlds-cpp` game tree (the existing `gui/` folder and `assets.json`) on 2026-06-16; where the runtime is unbuilt, I say so explicitly rather than guess.

**What the game tree actually shows (the load-bearing evidence):**
- The real `gui/` folder is **deeply nested** (`gui/profile/`, `gui/battle/`, `gui/escape_menu/`, `gui/abilityeditor/`, …) and today holds the *imperative* Lua GUI. The XML engine this editor authors for is **not yet written in `worlds-cpp`** — there are zero `.xml` files and no XML loader in the C++ source. So the XML/`<Component src>` load path cannot be empirically verified; it is a contract the runtime will implement to match what the editor writes. The Lua facts below ARE verifiable and constrain the design.
- **GUI `.lua` files are already in `assets.json`** — e.g. `gui_ability_editor.lua → gui\abilityeditor\gui_ability_editor.lua`. The existing `collect_assets` walk (`.lua`/`.png`/`.json`, recursive) catalogues everything under `gui/` automatically. So the manifest *contains* gui lua, registered by **basename key → backslash relative path**.
- **But the runtime loads peer Lua by direct relative path, not by manifest lookup:** `gui/profile/gui_profile.lua` does `pcall(dofile, "gui/profile/gui_profile_creature_overview.lua")`. The `dofile` argument is a path, not a manifest basename. The manifest entry for that lua exists (the walk made it) but is **not the mechanism the controller load uses.**

This split — *manifest catalogues lua, but lua is loaded by path* — is the crux of decision (1) below.

##### (1) Create-component flow: what gets a manifest entry, ordering, failure, and DAL surface

**Manifest entries cover BOTH the `.xml` component and the `.lua` controller.**

- The runtime manifest-resolves **`.xml` components** (product-confirmed). So creating `{name}.xml` MUST insert a manifest entry `"{name}.xml" → "gui\…\{name}.xml"`, exactly like `create_script` does for `Scripts\…`.
- The runtime **will also manifest-resolve gui `.lua` controllers** once the XML engine is fully built out (product-confirmed — closing the seam the prior draft left open). So the create flow ALSO inserts a manifest entry for the controller, `"{name}_controller.lua" → "gui\…\{name}_controller.lua"`. (Historical note: today's *imperative* Lua loads peers by direct `dofile("gui/…")` path, which is why this was previously left unregistered; the built-out engine resolves by manifest, so the editor registers it now and authors to the final contract, not the interim one.)
  - Like the `.xml`, the existing asset *walk* (`update_asset_manifest`) would also catalogue the controller on its next bulk run — but the create flow registers it directly so the new component and its controller resolve immediately, without waiting on a rescan.

**Multi-write ordering and failure handling — reuse the `create_script` discipline exactly.**

The create flow is up to four writes: controller `.lua` (optional), component `.xml`, and the manifest inserts for both. The invariant to preserve is the same one `create_script` already encodes: **never leave a manifest entry pointing at no file, and never wedge the name so a retry is impossible.** Both files land first, then both manifest entries — manifest writes are the last, least-rollback-able steps. Ordering:

1. **Write the controller `.lua` first** (if requested), via `atomic_write` (self-cleans on its own failure — temp + rename, no residue). It is the safe thing to land first. If it fails, nothing else has happened — propagate, zero residue.
2. **Write the component `.xml`** via `atomic_write`. If it fails, **delete the controller written in step 1** (best-effort), then propagate. Result: zero residue.
3. **Insert the manifest entries** via `insert_manifest_entry` (order-preserving) — the `.xml` entry, then the controller `.lua` entry (if a controller was written). If either insert fails, **roll back: remove any manifest entry already inserted in this step, then delete both files** (best-effort), then propagate. Result: zero residue, name not wedged, retry clean.
4. On full success, **refresh caches in-process** so the new component resolves without a watcher round-trip: seed the manifest cache with the map returned by the inserts, and invalidate/seed the new `gui` tree cache (see (2)) so the component list shows the file immediately.

Rationale for "manifest **last**, not first" is identical to `create_script`'s: a manifest-first order risks an entry pointing at a missing file, and the no-clobber guard (`resolve_asset(name).is_some()`) would then refuse every retry of that name. The file-bearing writes are rollback-able; the manifest inserts are the last, least-rollback-able steps, so they go last (and the two inserts are kept adjacent at the end so a partial-insert failure has the smallest possible rollback).

The pre-flight no-clobber checks also mirror `create_script`: refuse if `"{name}.xml"` already resolves through the manifest, OR if either target file already exists on disk. Refuse **before** writing anything.

**DAL surface — a new `create_component` on `Dal`, per the three-step add-a-command recipe.**

- `dal/gui.rs` gains `create_component(folder_rel: &str, name: &str, xml: String, controller: Option<(String /*lua filename*/, String /*lua contents*/)>) -> Result<(), String>`. It owns the ordering above and reuses `atomic_write` + `insert_manifest_entry`. `folder_rel` is the gui-relative destination folder (`""` for `gui/` root, `"widgets"`, `"profile/cards"`, …); the file lands at `<gameInstallPath>/gui/<folder_rel>/<name>.xml`. The manifest filepath uses the existing backslash convention: `gui\<folder_rel-with-backslashes>\<name>.xml`.
- It does **not** extend `save_component` (the per-component save in section 7) — creation is the separate "first-time, must-register" door, exactly as `create_script` is kept distinct from `save_script`. Don't loosen `save_component` to create-on-save; keep the two doors.
- Thin command wrapper `create_component` in `commands/`, registered in `lib.rs`'s `invoke_handler!`. Frontend calls `invoke("create_component", { folderRel, name, xml, controller })` (camelCase arg keys matching the Rust params).

##### (2) `gui/` as a recursive-tree DAL domain, create-folder, and the watch

The reversed decision (subfolders allowed, list mirrors the tree) changes the `gui` domain from a flat resolve-by-name to a **recursive tree read**. This is the largest structural delta of the two reversals.

**Read model: a recursive tree, returned as a nested shape the frontend renders directly.**

The frontend needs enough to draw a folder tree with a per-file View-vs-widget glyph, without parsing every file's body. The DAL walks `gui/` recursively and returns:

```ts
type GuiTree = GuiFolder;          // the gui/ root folder
type GuiFolder = {
  name: string;                    // folder name ("" for the gui/ root)
  path: string;                    // gui-relative path ("" root, "widgets", "profile/cards")
  folders: GuiFolder[];            // subfolders (recursive)
  components: GuiComponentRef[];   // .xml files directly in this folder
};
type GuiComponentRef = {
  name: string;                    // basename without extension ("bag_slot")
  fileName: string;                // "bag_slot.xml"
  path: string;                    // gui-relative path to the file ("widgets/bag_slot.xml")
  kind: "view" | "widget";         // see below — cheap classification, not a full parse
  controllerFileName: string | null; // sibling "{name}_controller.lua" / authored controller, if found
};
```

- **`kind` (View vs widget) is the one place the read must peek inside a file.** A component is a `view` if its root element is `<View>`, else a `widget`. The cheap, robust way: read the file and check whether the first element tag is `View` (a small scan, or parse-and-inspect-root). The list does **not** need the full element tree — just the root tag. (Do not eagerly parse every component's whole body into `GuiNode` trees at list time; the per-file parse happens only when a component is *opened* into the structure column. The list read stays lightweight: tree shape + root-tag classification + sibling-controller detection.)
- **`controllerFileName` is resolved by sibling convention**, not by reading the xml: look for `{name}_controller.lua` alongside the `.xml`. (The authoritative controller reference is the `<View controller="…">` attribute, but surfacing that requires opening the file; the sibling-name check is the cheap list-time signal. The open-time parse reconciles the actual `controller` attr.) If a component names a non-conventional controller, the list glyph may under-report until opened — acceptable for the list; the editor's Controller tab reads the real attribute.
- This is a genuinely different DAL shape from every `Data/*.json` domain (flat `Vec<T>` keyed by `id`) — it is closer to a filesystem listing. Do not force it into the load-all-into-a-Vec pattern. It is a **tree read**, cached as one `Arc<GuiTree>` under a single cache key `()` (like the manifest), invalidated wholesale on any `gui/` change (see watch below).

**Create-folder: a thin filesystem op, no manifest involvement.**

- `dal/gui.rs` gains `create_folder(parent_rel: &str, name: &str) -> Result<(), String>` → `std::fs::create_dir` at `<gameInstallPath>/gui/<parent_rel>/<name>`. Folders are **not** assets, so there is **no manifest entry** — folders carry nothing the runtime resolves. Refuse if the directory already exists. Command wrapper + registration per the recipe. After success, invalidate the `gui` tree cache.
- An empty folder is legitimate (the user makes it, then creates components in it). The tree read must surface empty folders (they exist on disk), so the walk lists directories regardless of whether they contain `.xml`.

**Move / rename of components and folders: DEFERRED, not MVP.** Recommendation, with reasons:
- A component **rename** is not a single file rename: the `.xml` basename is a **manifest key**, and renaming it must rewrite the manifest entry AND every `<Component src="old.xml">` reference across the whole tree — a project-wide find-and-rewrite. That is a real refactor feature with its own correctness surface (miss one referrer → broken `src`). Out of MVP scope.
- A **move** (drag a component into another folder) changes its on-disk path and therefore its manifest `filepath`. Because the manifest key is the **basename** (not the path — see the collision risk below), a move that doesn't change the basename only rewrites the entry's `filepath` value, not the key, and does NOT touch `<Component src>` referrers (they resolve by basename). That makes move *cheaper* than rename — but it is still a multi-write (move file + rewrite manifest filepath) and interacts with the basename-collision hazard. Defer both; MVP creates-in-place only.
- MVP scope is therefore: **create component, create folder, edit/save in place, delete (optional).** No move, no rename. State this in the plan so the engineer doesn't half-build a drag-to-move that silently breaks `src` resolution.

**Watch strategy: a new RECURSIVE watch on `gui/`, invalidating the whole tree cache.**

- The existing watcher does **non-recursive** watches on `Data/` and the game root (and does not watch `Scripts/` at all — that gap is documented elsewhere). A non-recursive `gui/` watch would miss edits inside `gui/profile/`, `gui/battle/`, etc. — which is most of the tree. So `gui/` needs a **`RecursiveMode::Recursive`** watch (the one place this app uses recursive watching).
- **Invalidation shape: coarse, whole-cache.** Unlike the `Data/` invalidator table (per-file path → specific domain cache), the `gui` tree is a single `Arc<GuiTree>` cache. Any create/delete/rename/content-change anywhere under `gui/` invalidates that one cache key `()` — the next list read re-walks. This is acceptable because (a) the walk is cheap (filesystem listing + root-tag peek, not full-body parse) and (b) the tree is a single coherent artifact; partial invalidation would buy nothing. Do **not** try to mirror the per-file `Data/` invalidator granularity here — the read model is a tree, so the cache unit is the tree.
- Open-component editor state (the parsed `GuiNode` tree of the *currently open* file) is a frontend concern and is NOT this cache. An external edit to the open file invalidates the tree cache (list refreshes) but does not silently stomp the user's in-editor draft — the manual-save + warn-on-switch model (section 7) governs that. Name this so the engineer doesn't wire the watcher to clobber editor state.

##### (3) `<Component src>` resolution under subfolders — and the basename-collision hazard this reversal introduces

This is a **new structural risk created by allowing subfolders**, and it must be settled before the component picker and preview mount are built.

**The hazard, concretely:** the asset manifest is keyed by **basename**, not by path. I verified this in `collect_assets`: it keys entries by `path.file_name()` and, on a duplicate basename, *the later file silently overwrites the earlier* (except the `Tiles\` override). Today there are **zero duplicate basenames** across the real `gui/` tree (56 files, 56 unique basenames), so the model has never been stressed. But the moment the editor lets a user create `widgets/bag_slot.xml` and `screens/bag_slot.xml`, **the manifest can only hold one of them** — the two collide on the key `"bag_slot.xml"`, and `<Component src="bag_slot.xml">` is ambiguous: there is no way for a basename lookup to say *which* `bag_slot.xml`.

**Resolution — adopt basename-global `src`, and make the editor enforce basename uniqueness across the whole `gui/` tree.**

The runtime resolves `<Component src>` and `controller` references; the manifest it resolves against is basename-keyed; therefore `src` is, of necessity, a **flat basename lookup across the whole tree**, NOT a path relative to the referencing file and NOT a full path. `src="bag_slot.xml"` means "the component whose file basename is `bag_slot.xml`, wherever it lives in `gui/`." Folders are an **organizational convenience for the human**, not a namespace for resolution. This is the only model consistent with the basename-keyed manifest that product has confirmed is the resolution mechanism.

Consequences the editor MUST enforce (this is the new obligation the subfolder reversal creates):
- **Component basenames must be unique across the entire `gui/` tree, not just within a folder.** The create-component flow's no-clobber check therefore widens: refuse a name if `"{name}.xml"` already exists *anywhere* in the tree (equivalently, if it already resolves through the manifest), regardless of destination folder. This is stricter than a per-folder uniqueness check and is the thing an engineer would otherwise get wrong (checking only the target folder). Call it out explicitly.
- The **component picker** (right-click → add `<Component>`) lists components by basename across the whole tree; it may *show* the folder as a disambiguating hint to the human, but the value it writes into `src` is the bare basename. Two same-basename entries cannot both exist (the create guard prevents it), so the picker never has to resolve an ambiguity.
- This keeps `src` resolution **stable under moves** (moving a file between folders doesn't change its basename, so referrers don't break) — which is why move-without-rename is the cheaper deferred feature noted above.

**Why not path-relative `src`?** Path-relative resolution (`src` resolved against the referencing file's folder) would let two `bag_slot.xml` coexist, and is the more conventional choice — but it **contradicts the basename-keyed manifest the runtime actually uses.** The editor cannot author a `src` semantics the runtime won't honor. Unless/until the runtime's (unbuilt) XML loader is specified to resolve `src` by path, basename-global is the correct and only safe model. **Flag for re-confirmation when the XML engine lands:** if the runtime chooses path-relative `src`, the basename-uniqueness constraint relaxes and the picker must write paths — a contained change, but it inverts this rule. Build basename-global now; mark the seam.

**Missing / renamed `src` → visible placeholder (folds in earlier risk #3, product-confirmed).** When the preview mounts a `<Component src="bag_slot.xml">` whose basename does not resolve (deleted, renamed, never created), it renders a **visible placeholder box** in place of the subtree — e.g. a dashed/error-styled box reading `missing: bag_slot.xml` — never a silent blank and never a crash. The placeholder occupies the component instance's own `position`/`size` (those live on the `<Component>` element, not the missing child), so layout doesn't collapse. This is pure editor-render robustness, not runtime semantics — it lives in the preview renderer.

**Cycle guard — ancestor-set detection (folds in earlier risk #3).** Nested-component mount is recursive: A mounts B mounts A would infinite-loop the renderer. Guard with an **ancestor-set check**, not a blunt depth cap: as the preview descends, carry the set of `src` basenames currently on the mount path; before mounting a child, if its `src` is already in the ancestor set, render a **`recursive: bag_slot.xml`** stub box (same visible-placeholder family as missing-`src`) instead of recursing. Ancestor-set is exact — it catches A→B→A and A→A with no false positives, unlike a depth cap that would either falsely trip on legitimately deep (but acyclic) trees or allow a few cycle iterations before stopping. The mount path is short (hand-authored GUI), so the set is tiny. Both the missing-`src` and recursive-`src` stubs share one placeholder component in the renderer, parameterized by reason — one visible-error affordance, two triggers.

**Coupling summary for these resolutions.** The reversal's real cost is not "add subfolders to a list" — it is that **subfolders create a basename-collision surface against a basename-keyed manifest**, and the editor must now enforce tree-wide basename uniqueness to keep `src`/`controller` resolution unambiguous. That enforcement (widened create-guard + tree-wide uniqueness) is the new load-bearing constraint. The recursive watch and tree-read DAL are mechanical; the uniqueness invariant is the thing that, if missed, produces silently-wrong resolution at runtime. It is named here so it is guarded in the plan.

#### 2. Structure column (tree + properties + events)

A single column immediately right of the component list, split into **three vertically-stacked panels**:

- **Tree** (top) — the element hierarchy of the selected component. Right-click any element to add a child; if the child is a `<Component>`, a **component picker** (a searchable list of the gui-folder components) lets the user choose the source file. Adding a child automatically updates the XML and the preview.
- **Properties** (middle) — reflects the properties of the currently selected element. A computed read-only `id` field sits at the top, derived from the parent hierarchy (e.g. `view.stats.statText`). The editable `id` below it is the element's own local id. For `<Component>` elements this is also where `src` and any freeform override properties are set. `texture` uses the sprite selector UI component.
  - **`position` and `size` each render as four labeled inputs** — scale-x, scale-y, offset-x, offset-y — not a single `"relX,relY,absX,absY"` comma-string. (The serialized XML still uses the comma form.) Each field accepts a literal number *or* a `{token}` binding (see Data binding), so a field showing `{healthRatio}` is bound and one showing `0.5` is literal.
- **Events** (bottom) — lists of `<Event>` registrations (event name + handler function name), added/removed here. Events apply to the `<View>` (top-level) component.

#### 3. Selection model

There is **one selection state** for the active component, settable two ways, kept in sync:

- Click an element **in the tree** → it becomes selected, and it highlights in the preview.
- Click an element **in the preview** → it becomes selected, and it highlights in the tree.

The Properties and (where relevant) Events panels always reflect the current selection.

#### 4. Main content — tabbed (View / Controller)

- **View tab** — shows an exact preview of the selected component, including nested components. Unresolved parameter tokens (e.g. `{money}`) render **literally**, but are styled distinctly (dimmed/highlighted) so they read as "bindings waiting for data," not broken text. They resolve once a Data Model is supplied. The stage is the fixed 1280×768 resolution; opening a component **fits-and-centers** it in the viewport (the default/Fit state). The preview **is zoomable and pannable** (task 473): Ctrl/Cmd + wheel zooms toward the cursor (clamped ~0.1×–8×), space-drag or middle-mouse pans, and a corner toolbar offers −/+/Fit/100% controls. A resize re-fits only while the user hasn't manually zoomed or panned; once they have, their view is preserved. The view transform (`translate(panX,panY) scale(scale)`) is applied to the ROOT stage **only**, per the F5a single-stacking-context invariant, and the **viewport** clips the transformed stage (overflow hidden) — note this is the viewport's outer clip, distinct from the stage-internal overflow below (child boxes still overflow their parents inside the stage).
  - **Overflow:** there is **no containment/clipping/scrolling** — child elements that extend past their parent simply overflow, matching the game runtime. That is expected and fine.
  - **Layer:** because elements overlap and overflow, the preview **must honor `layer`** so draw order (e.g. a tooltip above its siblings) matches the runtime, rather than relying on document order alone.
- **Controller tab** — a Lua monaco editor for the component's controller. If no controller exists yet, this panel shows an **"Add script"** button that creates the file and sets the `<View>`'s `controller` property (default name `{component_name_in_snake_case}_controller.lua`, but the user may name it anything). Created in the `gui` folder alongside the component.
- The structure column (tree/properties/events) stays visible (and collapsible) in both tabs.

#### 5. Data Model panel (right of main content, collapsible)

Lets the user define, as raw JSON, the data model injected into the GUI. The preview updates to match — this is what resolves the `{token}` bindings. Collapsible.

#### 6. Direct manipulation in the preview (MVP: drag-to-move only)

The user can **drag an element in the preview to reposition it.** Scope for the MVP is deliberately narrow:

- Dragging changes **only the offset** (the absolute pixel half of `position`); the scale half is never touched by a drag. (Scale is edited by typing in the Properties panel.)
- The on-screen pixel delta maps directly to the offset delta (divided by the preview zoom factor if the preview is zoomed). No layout solver, no trig.
- During a drag, the `position` value in the Properties panel updates live.
- **Out of scope for the MVP** (explicitly deferred): resize handles, snapping, alignment guides, anchor points, and any scale↔offset conversion.

Structural prerequisite: every rendered box in the preview must carry a back-reference to its source XML node, so a click can select it and a drag can write the new offset back to the correct element. (This same back-reference powers preview→tree selection sync.)

#### Preview back-reference + layer rendering model resolved (architect)

This settles three coupled things: the in-memory document the editor edits, the node↔element mapping that carries the back-reference, and how `layer` + the rel/abs position model map to the DOM.

**The editor edits a parsed document tree, not a string. XML text is a serialization boundary.**

The single most important structural decision here: the editor's live state is a **parsed in-memory tree of typed element nodes**, and XML is produced from it only at save time (and parsed from it only at load time). Every surface — tree panel, properties, preview, drag-writeback — reads and writes the *same node objects*. The "visual editor, no raw XML" requirement makes this mandatory: there is no second source of truth.

```
Load:  gui/bag.xml ──parse──▶ GuiNode tree (live editor state)
Edit:  tree panel / properties / preview drag  ──mutate──▶ same GuiNode tree
Save:  GuiNode tree ──serialize──▶ gui/bag.xml
```

Each node carries a **stable editor-assigned node id** (call it `nodeId`) minted at parse/create time — distinct from the authored XML `id` attribute. The `nodeId` is the join key for everything:

```ts
type GuiNode = {
  nodeId: string;            // editor-internal, stable for the node's lifetime; NOT serialized
  tag: "View" | "Panel" | "Text" | "Component" | "Event";
  attrs: Record<string, string>;   // raw authored attribute strings (literal OR "{token}"), verbatim
  children: GuiNode[];
};
```

- `nodeId` is **never serialized** — it exists only to identify a node across the tree/preview/properties triad within a session. The authored `id` attribute lives in `attrs.id` like any other attribute. (Two ids, two jobs: `attrs.id` is the runtime reference path the user authors; `nodeId` is the editor's internal handle. Conflating them breaks the moment two siblings have a duplicate or empty `id`.)
- `attrs` stores **raw strings exactly as authored** — `"0.5"`, `"{healthRatio}"`, `"TextDefault"`, `"1,0,0,5"`. Binding/literal/palette interpretation is a *render-time* concern, not stored state. This keeps the serializer trivial (write attrs back verbatim) and keeps the editor thin about semantics.
- **One selection state** (per the Selection model section) is just a `selectedNodeId: string | null`. Tree rows key off `nodeId`; preview boxes carry `data-node-id={nodeId}`. A click in either surface sets `selectedNodeId`; both highlight whatever matches. That is the entire sync mechanism — no separate mapping table to keep coherent.

**The node↔rendered-element mapping: carry `nodeId` on the DOM node; resolve clicks via `closest`.**

Rather than maintaining a side table from rendered element → source node (which has to be rebuilt and kept in sync every render), **stamp the identity onto the rendered DOM element itself**:

- Each rendered box is a `<div data-node-id={node.nodeId}>`. 
- A preview click handler reads `event.target.closest('[data-node-id]')?.dataset.nodeId` → that is the selected node. `closest` walks up from the click target, so clicking a child text span inside a panel still resolves to the nearest rendered box. (This also gives correct hit-testing under overlap for free: the topmost painted element at the cursor is the `event.target`.)
- A drag reads the same `nodeId` to know which node's `position` offset to write back.
- **`forEach` instances** all share their template's `nodeId` but add an instance discriminator: `data-node-id={templateNodeId}` plus `data-instance-key={key-or-index}`. Selecting any instance selects the **template node** (the design's stated behavior: drag/selection acts on the template, since instances are data-driven). The instance key exists for the preview's own rendering identity (React `key`), not for selection.

This is **derived state, rebuilt every render** — there is no mapping to invalidate. The DOM *is* the mapping. The only persistent structure is the `GuiNode` tree plus the single `selectedNodeId`.

**Mapping the rel/abs (UDim2-style) model to the DOM.**

`position` / `size` are `relX,relY,absX,absY` — a scale fraction of the parent plus a pixel offset. The runtime's UDim2 math maps **directly and exactly** onto CSS, which is the reason the preview can be a plain absolutely-positioned DOM tree rather than a canvas:

- Each rendered box is `position: absolute` within a **`position: relative` parent box**, so percentages resolve against the parent's content box — matching "scale is a fraction of the parent."
- `position="relX,relY,absX,absY"` →
  `left: calc(relX * 100% + absX px)`, `top: calc(relY * 100% + absY px)`.
- `size="relX,relY,absX,absY"` →
  `width: calc(relX * 100% + absX px)`, `height: calc(relY * 100% + absY px)`.
- `calc()` does the `scale·parent + offset` sum natively, so there is **no layout solver and no measurement pass** — the browser computes it. (This is why the drag MVP is trivial: a drag adds Δpx to `absX`/`absY` only; the `calc` re-evaluates. No trig, no parent-size readback.)
- The **root preview box is a fixed 1280×768** stage (per the View tab's fixed resolution). All percentages cascade from there.
- **Overflow is honored by doing nothing:** no `overflow: hidden` anywhere — children that exceed their parent paint outside it, matching the runtime. (The design explicitly wants this.)
- Negative and >100% values work natively (`calc(100% + -300px)` for the `position="1,0,-300,0"` right-anchored panel in the example). No clamping.

**Applying `layer` (draw order) — and the stacking-context trap.**

`layer` is an integer; higher paints on top, across the *whole* component, not just among siblings. The naïve `z-index: layer` per element **does not work** because of CSS stacking contexts: a `z-index` only competes *within its parent's stacking context*, so a deeply-nested high-`layer` element cannot rise above a shallow low-`layer` element in a different branch. Document-order/branch nesting would leak back in — exactly what the design says must not happen.

Resolution: **flatten layering into a single stacking context.**

- The preview renders the tree into nested DOM (so the rel/abs parent-relative math works), but **does not** set `z-index` on the structural nesting. Instead, every box that participates in layering gets its `z-index` from a **single global ordering computed across the entire flattened node list**, and the structural parent boxes are kept from creating competing stacking contexts.
- Concretely for the MVP, the robust approach is a **two-pass render**:
  1. **Layout pass** establishes the nested parent-relative boxes (for `calc` percentage math) but those structural wrappers are `position: relative; z-index: auto` — they do *not* create stacking contexts that trap children.
  2. **Paint-order is set by sorting:** compute a stable order = `(layer asc, document-order asc)` over all rendered leaf boxes, and assign `z-index` from that global sequence. Because the contributing boxes share one root stacking context (the 1280×768 stage), a single integer `z-index` per box gives a total paint order that honors `layer` globally and falls back to document order within equal `layer`.
- **The pitfall to hold the engineer to:** anything that *implicitly* creates a stacking context on an intermediate node — `opacity < 1`, `transform`, `filter`, `mix-blend-mode`, `will-change`, `isolation: isolate`, or a `position`+`z-index` combo — will re-trap descendants and silently break cross-branch layering. The preview's structural wrappers must avoid those. (If a future feature needs opacity on a panel, layering has to move to a flat-render model where boxes are emitted into one container with computed absolute geometry — note this as the escape hatch, but it's not needed for the MVP.)
- `layer` is **bindable** (it's in the presentational set), so the resolved integer comes from the same token/literal resolution as other typed properties before the global sort runs.

**Why this shape (coupling summary).** The `GuiNode` tree is the single source of truth; tree/properties/preview are three projections of it joined only by `nodeId`; the DOM carries `nodeId` so the mapping is never a separate structure to maintain; rel/abs maps to `calc()` so there's no layout engine; and `layer` is applied as one global z-order to dodge stacking-context coupling. The one explicit, named coupling that remains is **structural-nesting (for percentage math) vs. global paint-order (for layer)** pulling in opposite directions — resolved by keeping intermediate wrappers out of the stacking-context game. That tension is the thing most likely to be reintroduced accidentally later; it is called out so it stays guarded.

##### F5a — confirmed render contract for the layer / global z-order model (architect)

The model above is correct in principle; this is the **implementation contract the F5b build task must satisfy**, pinned against how CSS stacking contexts actually form so the trap can't be silently reintroduced in React 19's DOM output. Nothing above is revised — this makes it precise and testable.

**Why the model holds (the one fact that makes global z-order work).** A `z-index` competes inside the **nearest ancestor stacking context**, not inside the nearest positioned ancestor. A structural wrapper that is `position: relative` but has `z-index: auto` is positioned **but does not form a stacking context**, so it does not become that "nearest ancestor." Therefore a leaf's numeric `z-index` participates directly in the **root stage's** stacking context, no matter how deeply the leaf is nested — which is exactly what lets a deep box out-paint a shallow box in a different branch. This is the load-bearing CSS guarantee; the entire contract below exists to keep it true. (`position: relative`/`absolute` + `z-index: auto` does NOT create a stacking context; `position` + a *numeric* `z-index` DOES — that is the single trap, and it is why structural wrappers must never carry a numeric `z-index`.)

**(1) The exact CSS constraints — what an intermediate / structural wrapper box must NOT have.** A "structural wrapper" is any rendered box that has descendants which participate in layering (i.e. every non-leaf preview box: the stage's children, panels containing panels, etc.). Each such wrapper MUST be `position: relative` (for the `calc()` percentage math) and MUST keep `z-index: auto`. It MUST NOT carry **any** property that forms a stacking context, because each such property re-traps that wrapper's descendants into a local context and breaks cross-branch layering. The complete prohibited-on-wrappers list (each entry independently forms a stacking context per the CSS spec):

- `z-index` set to any value other than `auto` while positioned (the headline trap — keep wrappers at `z-index: auto`)
- `position: fixed` or `position: sticky` (these form a stacking context **unconditionally**, even with `z-index: auto` — so wrappers must use `relative`/`absolute`, never fixed/sticky)
- `opacity` less than `1`
- `transform` other than `none` (includes `translate`/`scale`/`rotate` longhands)
- `filter` other than `none`, and `backdrop-filter` other than `none`
- `perspective` other than `none`
- `clip-path` other than `none`
- `mask` / `mask-image` / `mask-border` other than `none`
- `mix-blend-mode` other than `normal`
- `isolation: isolate`
- `will-change` naming any property in this list (or any property that would itself form a stacking context) — `will-change: transform`, `will-change: opacity`, etc.
- `contain: layout`, `contain: paint`, `contain: strict`, or `contain: content`

Notes that matter for a React/Tailwind implementation:
- **Tailwind is a silent re-introducer.** Utilities like `transform`, `transition-transform`, `scale-*`, `opacity-*` (< 100), `filter`/`blur-*`/`drop-shadow-*`, `mix-blend-*`, `isolate`, `will-change-*`, and `backdrop-*` each emit one of the prohibited properties. Do not put any of these on a structural wrapper. The MVP's selection highlight and hover affordances must be drawn **without** them on wrappers — use an inset `box-shadow`/`outline` overlay (neither forms a stacking context) rather than `transform`/`opacity`/`isolation`, or draw the highlight as a separate sibling leaf box rather than styling the wrapper.
- **`box-shadow`, `outline`, `border`, `background`, `overflow: visible` are all safe** on wrappers — none forms a stacking context. (Per the design, no wrapper sets `overflow: hidden` anyway.)
- **Leaf boxes are exempt from the "no numeric z-index" rule** — assigning a numeric `z-index` to a leaf is the whole mechanism. A leaf forming its own stacking context is harmless precisely because it has no layering descendants to trap.
- **The stage is the single shared stacking context.** The 1280×768 root stage box itself SHOULD form the one intentional stacking context (it is the root for this subtree); every box's `z-index` is interpreted relative to it.

**(2) The two-pass flatten-then-global-z-order approach (confirmed against React's render output).** React renders the nested DOM; the z-order is computed as derived state over the same `GuiNode` tree, not baked into the tree:

1. **Flatten pass.** Walk the `GuiNode` tree in **document order** (depth-first, pre-order — the order nodes appear in the serialized XML) and produce a flat list of the boxes that participate in layering. For each, capture `{ nodeId (+ instance key for forEach stamps), resolvedLayer, docOrderIndex }`. `resolvedLayer` is the `layer` attribute **after** token/literal resolution (layer is bindable), defaulting to `0`. `docOrderIndex` is the node's position in this pre-order walk — it is the stable tiebreaker and must match serialized document order so the runtime and preview agree.
2. **Sort + assign pass.** Stable-sort the flat list by `(resolvedLayer asc, docOrderIndex asc)`. Assign each box a `z-index` equal to its **rank in the sorted list** (a dense 0..N-1 sequence — the actual integers are irrelevant, only their relative order is). Hand that map (`nodeId[/instanceKey] → zIndex`) back to the render so each leaf `<div>` gets `style={{ zIndex }}`; structural wrappers get **no** `z-index` (stay `auto`).

Why this composes with the rel/abs nested-absolute layout: the nesting exists **only** so `calc(rel * 100% + abs px)` resolves percentages against the correct parent content box. Because the wrappers carry `z-index: auto`, that nesting contributes nothing to paint order; paint order comes entirely from the flat global ranks landing in the stage's single stacking context. The two concerns (geometry via nesting, paint order via flat rank) are fully decoupled — which is the whole point. Assigning rank instead of raw `layer` as the `z-index` also sidesteps duplicate-`z-index` document-order ambiguity: equal-`layer` boxes get distinct, document-ordered ranks, so paint order is fully determined and never relies on the browser's tie-break.

Forward-compat seam (restating the existing escape hatch as a build note, not a new decision): this contract is sound **only** while no panel needs `opacity`/`transform`/`filter`/etc. The moment a real feature requires one of those on a box that has layering descendants, the nested-wrapper model can no longer host global z-order, and the renderer must switch to the **flat-emit** model — emit every box as a direct child of the stage with fully-computed absolute geometry (resolve the `calc()` cascade in JS), so there are no intermediate wrappers to trap anything. F5b builds the nested model; it should keep the flatten pass (step 1) as a clean seam so a later switch to flat-emit reuses it.

**(3) Concrete cross-branch regression scenario (the F5b acceptance test).** This is the exact shape that breaks the instant a wrapper silently forms a stacking context, so it must be the regression test. Two sibling branches under the stage; the deeply-nested box in the **low-document-order** branch carries a **high** `layer`, the shallow box in the **high-document-order** branch carries a **low** `layer`. Correct global ordering must let the deep-high-layer box paint **on top of** the shallow-low-layer box even though it is both deeper and earlier in document order:

```xml
<View>
  <Panel id="branchA" position="0,0,0,0" size="0,0,400,400" backgroundColor="0,0,255,255">
    <Panel id="a1" position="0,0,20,20" size="0,0,360,360">
      <Panel id="a2" position="0,0,20,20" size="0,0,320,320">
        <!-- deep + earliest in document order, but HIGH layer: must end up ON TOP -->
        <Panel id="deepHigh" layer="10"
               position="0,0,40,40" size="0,0,240,240" backgroundColor="255,0,0,255"/>
      </Panel>
    </Panel>
  </Panel>
  <!-- shallow + later in document order, but LOW layer: must end up UNDERNEATH where they overlap -->
  <Panel id="shallowLow" layer="0"
         position="0,0,120,120" size="0,0,240,240" backgroundColor="0,255,0,255"/>
</View>
```

Expected paint order, bottom → top: `branchA` < `a1` < `a2` < `shallowLow` (layer 0, but later doc order than the branchA chain) < `deepHigh` (layer 10). The **load-bearing assertion**: in the overlap region of `deepHigh` (red) and `shallowLow` (green), **red is visible** (`deepHigh` paints above `shallowLow`). If any structural wrapper (`branchA`/`a1`/`a2`) has accidentally formed a stacking context, `deepHigh`'s `z-index` would be confined to that wrapper and `shallowLow` (a stage-level sibling) would paint over it — green visible — and the test fails. The test should assert against computed paint order / actual rendered pixel at an overlap coordinate (or against the assigned `z-index` ranks: `rank(deepHigh) > rank(shallowLow)` AND a runtime check that no `branchA`/`a1`/`a2` element is a stacking context, e.g. via `getComputedStyle` confirming `z-index: auto` and none of the prohibited properties set). A second sub-case to lock the tiebreaker: give `deepHigh` and `shallowLow` the **same** `layer` — then document order decides, and `shallowLow` (later in document order) must paint on top.

**Conflict check (hard-stop gate): none found.** The global-z-order-in-one-stacking-context approach is fully compatible with the rel/abs nested-absolute layout, because the nesting uses `z-index: auto` wrappers (positioned-but-not-stacking) and the leaf z-index lands in the shared stage context. The model is workable as designed; F5b is cleared to build against this contract.

#### 7. Saving

Nothing auto-saves. A single **manual Save** action persists the current component — both its XML layout and its controller script. Unsaved changes are indicated (e.g. a dot on the component in the list / on the Save action).

**Warn on switch:** if the user selects a different component (or leaves the tool) with unsaved edits, the editor prompts before discarding — Save / Discard / Cancel. This is the tool's most likely trust-breaking moment (manual save + switching components is the main navigation move), so the guard is part of the MVP, not a later polish.

#### 8. Empty / first-run state

When no component is selected (or the `gui` folder is empty), the main content shows a **skeleton layout** placeholder rather than a blank panel.

## Architect: additional structural risks to settle before build

These are *not* on the deferred list but surfaced while resolving the three above. Each is a structural decision an engineer would otherwise make implicitly and inconsistently. Flagged here, with a recommended resolution, for sign-off before the work is picked up.

1. **`gui/` folder is a new DAL domain with a fundamentally different shape than every existing one — confirm the read model.** Every current domain is *one JSON file → a flat `Vec<T>` of records keyed by `id`* (`charms.json` → `Vec<Charm>`). The `gui/` folder is *many files, one component per file, each an XML tree with an optional sibling `.lua`* — closer to the `Scripts/` model (per-file, resolve-by-name) than the `Data/*.json` model. Recommended: a `gui` DAL domain that (a) **lists** components by scanning `gui/*.xml` (filename stem = component name), and (b) **reads/writes** a single component's XML text and its controller text by name. Do **not** force it into the load-all-into-a-Vec pattern; the component list wants names + a screen/widget flag, not every file's parsed body eagerly. The watcher needs a new recursive-or-shallow watch on `gui/` (it is not under `Data/`); decide shallow vs. recursive based on whether subfolders are allowed in `gui/` (recommend **flat, no subfolders** for MVP — simplest list model, matches the `{snake_case}.xml` naming rule).

2. **Are `gui/` files in `assets.json`, and does the runtime resolve them through the manifest?** The whole script/sprite resolution machine runs through `assets.json`. Scripts in `gui/` (controllers) and the XML components themselves: are they manifest-registered like `Scripts/*.lua` are, or does the runtime load `gui/` by direct path? This determines whether creating a component must **write an `assets.json` entry** (the same manifest-write cost the "New Object" feature carries — see the create_script precedent) or whether `gui/` is a free directory the runtime globs. **This must be answered before the create-component and add-controller flows are built**, because it decides whether those flows touch the manifest. Recommended default unless the runtime says otherwise: `gui/` is loaded by direct path (not manifest-resolved), so component/controller create is a pure file write with **no manifest mutation** — simpler, and avoids coupling GUI authoring to the asset manifest. Confirm against the runtime.

3. **`<Component src="...">` resolution + cycle safety in the preview.** Nested-component preview (workflow 9) recursively mounts `src` files. Two structural holes: (a) **resolution** — `src="bag_slot.xml"` resolves to `gui/bag_slot.xml` (a flat-folder name lookup), and a missing `src` must render a visible placeholder box, not crash the preview; (b) **cycles** — A embeds B embeds A would infinite-loop the renderer. The editor must guard with a **mount-depth cap or an ancestor-set check** and render a "recursive component" stub at the limit. This is editor-render robustness, not runtime semantics, so it is in the editor's court. Name the depth cap (recommend ancestor-set detection — exact, no false positives — over a blunt depth cap).

4. **Override properties cross a component boundary the preview must model.** A `<Component>` instance sets freeform overrides (`actionText="..."`) that the *child component's* tree reads as tokens against *its* data model. Structurally: when the preview mounts a child component, **what data model does the child's `{token}`s resolve against** — the parent's data model, the override attributes, or a merge? **RESOLVED — see "Component child data scope resolved (architect)" under the `forEach` section.** The recommendation (overrides-as-props) is now locked, with the two sub-rules it left open settled: the child gets a *fresh* root (no parent-`$` leak), and override values are pre-resolved in the parent scope before being handed in. This was the second-most-likely accidental-coupling site after the layer/nesting tension; it is now closed for the F6b build.

5. **Save atomicity across two files.** Save persists a component's XML **and** its controller `.lua` together (section 7). If the XML write succeeds and the `.lua` write fails (or vice-versa), the on-disk pair is inconsistent and the "unsaved dot" state is ambiguous. Recommend a defined order (write controller first, then XML, mirroring the create_script "write the rollback-able thing first" discipline) and a single surfaced error that leaves the dirty indicator *set* if either write fails, so the user knows the save didn't fully land. Small, but it is a trust-breaking moment exactly like the warn-on-switch guard the design already prioritizes.

# Examples

```xml
  <View controller="bag_controller.lua">
    <Event name="OnItemSold" handler="refresh"/>
    <Event name="OnItemBought" handler="refresh"/>

    <Panel id="root" position="1,0,-300,0" size="0,1,300,-32"
           borderColor="0,0,0,255" backgroundColor="0,0,0,255">

      <Component id="closeButton" src="close_button.xml"
                 position="1,0,-50,8" size="0,0,32,32"/>

      <Text id="title" position="0,0,0,18" size="1,0,0,32"
            textAlign="CENTER" fontSize="22" text="Bag"/>

      <Panel id="moneyBg" position="0,0,18,318" size="1,0,-38,36"
             borderColor="255,255,0,255"
             onMouseEntered="showHint" onMouseExited="hideHint">
        <Panel id="coin" position="0,0,2,2" size="0,0,32,32"
               texture="gui_kittycoin.png"/>
        <Text  id="money" position="0,0,40,12" size="1,1,0,0"
               text="{money}"/>
        <Text  id="hint" position="0,0,0,40" size="1,0,0,0"
               text="Money used to buy things." visible="false"/>
      </Panel>

      <Component id="slot1" src="bag_slot.xml"
                 actionText="Right click to sell" onMouseClicked="sellItem"/>
      <Component id="slot2" src="bag_slot.xml"
                 actionText="Right click to sell" onMouseClicked="sellItem"/>
      <Component id="slot3" src="bag_slot.xml"
                 actionText="Right click to sell" onMouseClicked="sellItem"/>
    </Panel>
  </View>
```
