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
- **Creature** → the bespoke `CreatureDataPane` (embeds the real `CreatureForm`).
- **Bundle / Pack** → a **bespoke full-width pane** (`BundleEditorPane` / `PackEditorPane`),
  no script pane — these are script-less, visually richer editors.

Every pane registers with the tab's **save bus** (`saveBus.ts`): one Save action (button or
⌘S) persists every dirty target of the active tab in order, then reports one summary. After
a successful save the shell refreshes the object list so renamed/re-sprited objects update.

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

## Creature Editor

`src/pages/CreatureEditor.tsx` + `src/pages/creature-editor/`. A list sidebar plus
`CreatureForm`, which leads with the **progression chart** (`ProgressionChart`, projected
stats vs. the population average/max), then the **stat/growth grid** (`StatGrowthTable`),
base abilities, and per-level unlocks (`AbilitiesByLevelEditor`). Identity fields
(name/sprite/script/rarity/description) live in `CreatureIdentityFields`. The same
`CreatureForm` is reused inside the Workbench's `CreatureDataPane`.

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
