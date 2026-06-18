# XGUI Editor — User Workflows

Step-by-step walkthroughs of the actions a user takes to accomplish common goals in the GUI editor. Companion to `xgui_ta.md` (which describes the layout and elements). These are written from the user's point of view to keep the editor's flows honest — if a step here feels heavy, the design needs another look.

Conventions used below:
- **Component list** = leftmost collapsible panel (every component file, in a folder tree).
- **Structure column** = tree (top) + properties (below). Events are ordinary `<Event>` nodes in the tree — there is no separate events panel.
- **Main content** = segmented View / Controller / XML toggle (the XML tab is a read-only live view of the serialized layout).
- **Data Model panel** = always-visible, collapsible JSON panel on the right.

> Shipped-vs-design note: this companion was written during design. The events-as-tree-nodes model, the XML tab, and in-tree element deletion landed in the shipped MVP — the steps below reflect that. See `xgui_ta.md` → "Current state — what shipped" for the full reconciliation.

---

## 1. Create a new component (screen or widget)

1. Open the GUI editor from the navrail.
2. Click the `+` button at the top of the component list.
3. Enter a name (e.g. `Bag`). The editor will store it as `bag.xml` in the `gui` folder.
4. Choose whether to also create a controller script. If yes, it defaults to `bag_controller.lua` (editable).
5. Confirm. The new component is selected; the main content shows its (near-empty) preview, the tree shows its root `<View>`.

**First-run note:** with an empty `gui` folder, the main content shows a skeleton placeholder until step 5 produces the first component.

---

## 2. Add an element to a component

1. Select the component in the component list.
2. In the **tree**, right-click the element you want to be the parent (e.g. the root `<View>` or a `<Panel>`).
3. Choose the element type to add: `Panel`, `Text`, `Component`, or `Event`.
   - If you choose `Component`, a **component picker** opens — search and select the source file (e.g. `bag_slot.xml`).
4. The element appears in the tree, in the preview, and in the underlying XML simultaneously.
5. The new element is selected; edit it in the Properties panel (workflow 3).

---

## 3. Edit an element's properties

1. Select the element — click it **in the tree** or **in the preview** (selection stays in sync either way).
2. The **Properties** panel reflects the element. The computed `id` (e.g. `view.stats.statText`) shows read-only at the top; the editable local `id` is below it.
3. Set values:
   - `position` / `size` — four labeled inputs each (scale-x, scale-y, offset-x, offset-y).
   - `texture` — opens the sprite selector.
   - colors, `borderSize`, `visible`, `fontSize`, `textAlign`, etc. — typed/selected inline.
   - `text` (for `<Text>`) — including `{token}` parameters that bind to the data model.
4. Changes reflect in the preview immediately.

---

## 4. Position an element visually (drag)

1. Select the element in the preview (click it).
2. Drag it to the desired spot. The `position`'s **offset** values update live in the Properties panel as you move.
3. Release to place. Scale values are untouched — only the pixel offset changed.
4. For precise values, type directly into the Properties `position` inputs.

> MVP limit: drag moves elements only. Resizing is done by typing `size` values; there are no resize handles, snapping, or alignment guides yet.

---

## 5. Add a reusable component as a child (e.g. a bag slot)

1. In the tree, right-click the intended parent.
2. Choose `Component`; the component picker opens.
3. Search for and select the source file (e.g. `bag_slot.xml`).
4. The `<Component>` instance appears. Select it.
5. In Properties, set `id`, `position`, `size`, `visible`, and any **override properties** the source component expects (e.g. `actionText`). Override property names are freeform — typos silently do nothing, so match the source component's expected names.

---

## 6. Parameterize text with the data model

1. Select a `<Text>` element and set `text` to include tokens, e.g. `Health: {health}/{maxHealth}`.
2. In the preview, the tokens render **literally but styled distinctly** (they look like bindings, not finished text).
3. Open the **Data Model** panel and enter JSON, e.g. `{ "health": 15, "maxHealth": 25 }`.
4. The preview updates: the text now reads `Health: 15/25`.
5. Adjust the JSON to preview different states (low health, full bag, etc.).

---

## 7. Add a controller script to a component

1. With the component selected, open the **Controller** tab.
2. If no controller exists, click **Add script**. It creates `bag_controller.lua` (rename if desired) and sets the `<View>`'s `controller` property.
3. Write Lua in the monaco editor.
4. Reference elements by their computed `id` (e.g. `view.moneyBg.money`) and handler functions named in events/handlers.

---

## 8. Wire up events and handlers

1. **Lifecycle/game events** (`<Event>`): in the **tree**, add an `<Event>` node under the root `<View>` (right-click → add `Event`). Select it and set its event name (e.g. `Battle:OnCreatureDied`) and handler function name (e.g. `refresh`) in the Properties panel. Events are tree nodes — there is no separate events panel.
2. **Element interaction events** (`onMouseClicked`, `onMouseEntered`, etc.): select the element, and set the handler in its Properties panel (the value is a controller function name).
3. Implement the named handler functions in the Controller tab (workflow 7).

---

## 9. Preview a nested-component screen

1. Select a top-level View (e.g. `Battle`).
2. The View tab renders it including every nested `<Component>`, resolved from their source files.
3. Supply a Data Model (workflow 6) to fill in bound values across the whole tree.
4. Click into nested elements in the preview to select and inspect them.

---

## 10. Save your work

1. Make edits across the layout, properties, controller, etc. Nothing auto-saves; unsaved state is indicated.
2. Trigger the **Save** action. It persists the current component's XML layout **and** its controller script together.
3. If you select another component (or leave the tool) with unsaved edits, the editor warns first — **Save / Discard / Cancel** — so edits are never silently lost.

---

## Open flow questions (not yet specified)

These are flows the design doesn't fully answer yet — flagged here so they're not lost:

- **Renaming / deleting / moving a component** — deferred for the MVP (the component list has no file-delete, rename, or move). What happens to `<Component src>` and `controller` references when a component is renamed/moved is the open question; see `xgui_ta.md` → create-flow section for why move/rename are deferred.
- **Deleting a tree element** — *shipped*: every non-root element (including `<Event>` nodes) carries a delete affordance in the tree, with undo/redo. **Reparenting / moving** a tree element is still not described.
- **Discovering a component's override properties** — with freeform overrides, the user has no in-editor hint of what `bag_slot.xml` accepts. Acceptable for an audience of one; revisit when modders use each other's components.
