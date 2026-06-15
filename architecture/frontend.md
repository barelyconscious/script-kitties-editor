# Frontend

React app in `src/`. Entry: `main.tsx` → `App.tsx`, which renders the **NavRail** and the
active **tool**. Start with [`README.md`](./README.md) for shared terms.

## Workbench

The flagship tool (`src/pages/Workbench.tsx`, components in `src/components/workbench/`).
It is composed of three regions, left to right:

- **Objects panel** (`ObjectList`) — a grouped, searchable sidebar of every `GameObject`
  (grouped by type: Creatures, Bundles, Packs, Abilities, …). Loaded via `get_game_objects`.
  Clicking an entry opens it as a **tab**. A `+` opens the **`NewObjectModal`** to create one.
- **Tabs** (`TabBar` + `TabWorkspace`) — each open object is a tab. Tabs stay mounted so
  their draft/unsaved state survives switching. One **`TabWorkspace`** renders the body of
  the active tab.
- **API reference pane** — a single shared, static reference panel spanning all tabs.

A **`TabWorkspace`** body depends on the object type:

- **Flat entities** (Ability, Biogram, Effect, Item, Charm) → a narrow **data pane**
  (schema-driven form from the entity's `EntityField[]`) plus a **script pane** (Monaco
  editor for the object's `.lua` script).
- **Creature** → a `CreatureTabProvider` shares one draft across both panes: the bespoke
  `CreatureDataPane` (the real `CreatureForm`) on the left, and a toolbar **Script/Stats**
  toggle flipping the center between the script editor and the read-only `CreatureChartPane`.
  Because the chart reads the live draft, it tracks unsaved edits, and focusing a stat box
  switches the charted stat.
- **Bundle / Pack** → a **bespoke full-width pane** (`BundleEditorPane` / `PackEditorPane`),
  no script pane — these are script-less, visually richer editors.

Every pane registers a target with the tab's **save bus** (`saveBus.ts`), tagged **auto** or
**manual**. **Data** targets auto-save: an edit schedules a debounced write (`useAutoSave`,
`autoSave.tsx`) with a quiet "Saving…/Saved" indicator — no button. **Scripts** are manual:
the **Save Script** button or ⌘S (and Monaco's ⌘S) persist the script, flushing any pending
data write first. The unsaved-dot and the leave/close guards track only the script (data is
already written); a tab close flushes pending data on unmount. After any successful save the
shell refreshes the object list so renamed/re-sprited objects update.

### Pack editor terminology

`PackEditorPane` renders a pack's **slots** as a grid of TCG-style **cards**. Each slot has
**draw rules**: a **bundle-weight** distribution and a **rarity-weight** distribution (both
authored with `WeightDistribution`, weights summing to 1.00, drawn from the
`creatureRarities` enum). A slot can be a **stack** (`count`) — one card shown with a `−/×N/+`
stepper and a layered sheet behind it — and slots are numbered cumulatively (a `×7` slot is
"Slots 1-7", the next starts at 8).

### Bundle editor terminology

`BundleEditorPane` edits a **bundle** (a named collection of creatures). Each member creature
can carry **overrides** applied when drawn: `nameOverride`, `descriptionOverride`,
`spriteOverride`, `baseStatsOverride`, and `abilitiesOverride`.

## Creature editing

Lives entirely inside the Workbench (the standalone Creature Editor tool was removed).
The reusable parts are in `src/pages/creature-editor/`: `CreatureForm` is the editing
surface — the **stat/growth grid** (`StatGrowthTable`), base abilities, and per-level
unlocks (`AbilitiesByLevelEditor`); identity fields (name/sprite/rarity/description) live
in `CreatureIdentityFields`. A creature tab wraps both panes in `CreatureTabProvider`
(`src/components/workbench/creatureTab.tsx`), which owns the shared draft, population, and
the `"data"` save target. `CreatureDataPane` (left, chart suppressed) edits that draft; the
center region toggles between the aiController **script** and the **progression chart**
(`ProgressionChart`, projected stats vs. population average/max) via `CreatureChartPane`,
which reads the same live draft — so the chart reflects unsaved edits and follows the
focused stat box. The provider is always mounted, so the draft survives hiding the Data pane
or switching to the chart.

## Data Tables

`src/pages/DataTables.tsx` is a tab shell; each `src/pages/data-tables/*DataTable.tsx`
configures the generic **`EntityDataTable`** (browse/search) + **`EntityEditDialog`** (form
from the entity's `EntityField[]`). `ItemsDataTable` **joins** `items.json` with
`itemDropTable.json` and saves both.

## Registry

`src/pages/Registry.tsx` edits the enums in `src/lib/registry.tsx`. Sections may be
read-only (fixed game enums) or editable (e.g. `creatureRarities`). Anything with
`optionsFrom: "<enumKey>"` in a field schema, or `useEnumValues("<enumKey>")` in code, reads
from here — so editing the Registry updates dropdowns everywhere.

## Shared building blocks

- `src/lib/entities/*` — per-entity TS types, `load*`/`save*`, and `*_FIELDS` schemas.
- `src/components/Sprite.tsx`, `SpritePicker`, `IntegerInput`, `TagsSelect`/`TagsInput`,
  `AbilityPicker` — reusable inputs.
- `src/lib/stats.ts` — `STAT_META` (icon/color/label per stat), shared by creatures + charms.
- `src/components/ui/` — vendored shadcn components; treat as generated.
