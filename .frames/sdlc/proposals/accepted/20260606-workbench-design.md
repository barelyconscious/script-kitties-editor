---
name: "Workbench: a code-and-data workspace for game objects"
description: "The Workbench is a tabbed workspace of game objects — an object-list explorer plus per-object tabs, each with a DATA pane, a Monaco Lua script editor, and an API reference — where editing an object's data and its script feel like one tool with one per-tab save."
status: accepted
author: ux-designer
date_created: 2026-06-06
reviewers:
  - ux-designer
reviewer_decisions:
  architect: Aligned
  engineer: Aligned
---

## Context

The Workbench is the third tool in Script Kitties Editor (`src/pages/Workbench.tsx`, currently a one-line stub). The other two tools are form-first: **Data Tables** edits entity fields in schema-driven grids/dialogs, and the **Creature Editor** edits one creature through a bespoke form. The Workbench is different in kind — it is the surface where the editor becomes a **code tool**, not a form-filler. That shift changes the trust model: a code editor lives or dies on "did my change take, and where did it go."

Matt is the audience of one today; **modders are a later audience**. So v1 can assume fluency with the game's data model, but discoverability (especially the API reference) is a forward investment we should not architect ourselves out of.

### What already exists to build on

A predecessor editor — `bcgeditor`, an Electron + React + MUI + Monaco app at `worlds-cpp/editor/bcgeditor` — already implemented essentially this entire feature. It is a **blueprint for content and interaction, not a UI to copy** (the new app is Tauri + React + Tailwind + shadcn). The reusable pieces:

- `workbench/views/GameObjectView.tsx` — a three-pane object workspace: collapsible **DATA** pane (left), **script editor** (center), collapsible **API** pane (right); for creatures, a progression viewer takes the right side.
- `workbench/ScriptEditor.tsx` — Monaco Lua editor; loads `selectedObject.script`, save + "Open in VS Code", read-only when no script.
- `workbench/apiViewer/gameApi.ts` + `GameDocumentationViewer.tsx` — a searchable, drill-in API reference. `ApiItem` carries `name`, `type`, `args`, `returns`, `examples`, and nested `members`.
- `services/CompletionProvider.ts` — a Monaco completion source: Lua keywords, stdlib, per-entity `self.*` properties, and the game API (`GetBag`, `GetParty`, `combat.caster`, `battle:findCreatures`, `CombatAction.*`, `DamageType.*`, `ArenaEffects.*`).

**A caution the predecessor teaches by counter-example:** its reference data (`gameApi.ts`) and its completion data (`CompletionProvider.ts`, ~700 lines of separately hand-authored items) are **two independent sources that never share a line.** That is the trap to avoid. We want the API **reference** and the future **inline intellisense** to ride *one* structured source — but that means *building* that single source now, not porting the predecessor's two forked lists. See commitment 4.

### What exists in this app already

- `get_game_objects` already unifies abilities/biograms/charms/creatures/effects/items into `GameObject { objectType, id, name, sprite, script, description }`. This is the feed for the object list.
- Every object type except **charms** carries a `script`. Creatures call theirs `aiController`; items/dlc are optional. `get_game_objects` normalizes these into `script` (empty string for charms).

### The load-bearing data facts

**1. `script` is a pointer to a separate `.lua` file; that file's contents are the actual code.** The field holds a *bare filename* (`ability_bite.lua`, `ai_default.lua`), and the files live in a `Scripts/` folder that is a **sibling of `Data/`, not under it.** Crucially, these scripts are **already registered in `assets.json`** — the same manifest that resolves sprites. So resolution is a solved problem: a script name resolves through `dal::assets::resolve_asset` exactly like a sprite name does. The Workbench therefore writes to **two persistence targets**:

1. The object's **data fields** (name, range, cost, tags, stats…) → the entity JSON, via existing `save_<entity>` commands.
2. The object's **script** → the `.lua` file in `Scripts/`, resolved by name through the asset manifest — *not* the JSON.

**2. Scripts are shared, not one-per-object.** `ai_default.lua` is the `aiController` for *many* creatures. The script a workspace opens is **not owned by the selected object** — it is shared infrastructure. Editing it changes every object that points at the same file. This is correct game semantics (a shared controller), and it has a direct UX consequence (commitment 2): the script must be presented as a *file*, never as "this object's script."

**The backend gap:** the Tauri app currently serves only the script *name* (via `get_game_objects`); nothing reads or writes script *file contents*. A `get_script` / `save_script` pair is required — resolving the name through the manifest, then doing file I/O, mirroring `dal::sprites`. Detailed in "For the architect."

## Proposal

**The Workbench is a tabbed workspace of game objects, not four tools bolted together.** A persistent **object list** on the far left is the explorer; clicking an object opens it as a **tab**. Each tab *is* that object's whole workspace — its DATA pane, its script, its API reference — so several objects can be open at once and you switch between them like files in an editor (commitment 5). The panes within a tab collapse to taste:

```
┌────────────┬──────────────────────────────────────────────────┐
│ OBJECT     │ [ bitlynx ×][ ability_bite ×][ healing_potion ×]  │ ← object tabs
│ LIST       ├───────────┬─────────────────────────┬────────────┤
│            │  DATA     │   SCRIPT EDITOR         │   API      │
│ ▸ Creatures│  (fields) │   (Lua, Monaco)         │  (ref)     │
│ ▸ Abilities│ collapse◄ │                         │ ►collapse  │
│ ▸ Items …  │           │                         │            │
└────────────┴───────────┴─────────────────────────┴────────────┘
```

The script editor is the **center of gravity** within a tab — it is what makes this tool distinct from the form-first tools. DATA and API flank it and default to a calm state (see open questions on defaults).

### The first ten minutes (the flow we are designing)

1. User clicks **Workbench** in the NavRail → sees the object list grouped by type, plus an empty-state center that says *"Select an object to open it."*
2. User searches or expands a group, clicks an object → it **opens as a tab**; the script editor loads that object's `.lua` contents; the DATA pane shows its fields; the tab and header name what is being edited.
3. User edits Lua with syntax highlighting. They hit a function they don't know → open the **API** pane, search, read the signature and an example.
4. User edits a data field in the DATA pane too (Matt's "edit everything"), and opens a second object in another tab, switching back and forth.
5. User saves the active tab **once** (⌘S) → both that object's script file and its JSON fields persist. One dirty dot per tab, one save action, no "wait, which save button?"

### The UX commitments

**1. Object list — every object, grouped, findable, honest about scripts.**
- Group by type (Creatures, Abilities, Biograms, Effects, Items, Charms), collapsible headers, with a single search that filters across all groups.
- Each row shows sprite + name. A **script affordance** distinguishes objects *with* a script from those *without* (charms have none; some items may not). Proposed: a small code-glyph on rows that have a script; absence reads as "data-only."
- Opening a **script-less** object (e.g. a charm, for now) still works — its tab opens with the DATA pane active and the script editor showing a clear *"This object has no script yet"* state rather than a dead gray box. (Charms are expected to gain scripts — see commitment 3.)

**2. Two save targets, one invisible save — but never a *blind* save.** This is the central trust commitment.
- A **per-tab dirty state**, aggregating "script changed" and "data fields changed" for that object. Each open tab tracks its own.
- A **single Save** action (and ⌘S) that writes whichever of the *active tab's* targets are dirty. The user is never asked to reason about *where* their change lives.
- **The script is named as a file, and its reach is shown.** Because scripts are shared, the editor header names the *file* (`ai_default.lua`), not "Bitlynx's script," and surfaces **"shared by N creatures"** when N > 1 — and **"also open in another tab"** when a sibling tab has the same file open (see commitment 5). Editing a shared controller is legitimate, but it must be a sighted choice — an invisible save that silently alters objects the user never opened is a trust withdrawal, not a convenience.
- **Save order is defined:** the data record (which holds the script *pointer*) saves before the script file, so a pointer change can't strand the contents. Each target is written by its own atomic command; the frontend reconciles the two outcomes.
- Unsaved-changes guard when closing a tab or leaving the tool with any tab dirty.
- A quiet confirmation on success ("Saved") and a legible error if either target fails — including the partial-failure case (script saved, data failed, or vice versa), which must not silently look like success.

**3. Coherence with Data Tables and the Creature Editor.** The Workbench edits the *same* objects those tools edit. The mental model we commit to: **the Workbench is the code-and-raw lens; the dedicated tools are the structured lens; both write the same underlying records.** Consequences to honor:
- The DATA pane reuses the existing `EntityField` schemas for the flat record types (abilities, biograms, effects, items), so an object edited in the Workbench and in Data Tables behaves identically — same validation, normalization, and save path. (Items carry a **third** save target: their `itemDropTable.json` join, exactly as the items table already handles.)
- **Enabling refactor (named so planning sizes it):** today the schema-driven form body lives *inside* `EntityEditDialog` with its own draft/dirty/save. To get *one* workspace dirty state, extract a controlled `EntityFieldsForm` (`fields` + `value` + `onChange`, no internal save) that both the dialog and the DATA pane render. And because `get_game_objects` is a **lossy list** (id/name/sprite/script/description only), selecting an object triggers a **second fetch** of the full per-domain record (`get_<domain>`, found by `id`) to populate the DATA pane.
- **Creatures are embedded, in one place (Matt's call).** Creatures have no flat schema — they are a bespoke form (stat grids, per-level unlocks) with zero-stripping normalization in `creature.ts`. The Workbench **embeds the existing creature form** (`CreatureForm`) under the unified save — *not* a second raw-field editor, which would drift. The standalone Creature Editor tool stays, but its role narrows to the **balance** surface (progression chart vs. population); the Workbench is where a creature's script and data live together. **Cost named honestly:** embedding under the single dirty/save means `CreatureForm`'s dirty-state and save must be *lifted* out of the standalone editor into the workspace — the same controlled-component treatment the flat types get. `CreatureForm.tsx` already exists as a *pure controlled* body (state lives in the parent), so the lift is a ~15-line `draft`/`saved`/`saveCreature` pattern — the same controlled shape every other type uses; delicate only because of the bespoke zero-stripping save path, not because the component resists. The progression chart already renders *inside* `CreatureForm`'s body, so embedding the form brings it along — there is **no** separate right-pane progression view for creatures (that would double-render it); the right pane stays the API reference, consistent with the other types.
- **Charms are data-only in v1 — but not forever.** Charms today have no script *and* a non-flat `stats` map; v1 lists them as data-only objects (the `stats` map rides the existing `custom` field renderer their table already uses, so this is cheap). But Matt has signalled **charms will need scripts.** So the design must *not* treat "charm = permanently script-less" as a fixed truth: the script affordance is data-driven (presence of a `script`), and charms gaining scripts is the concrete driver for the deferred "Add Script" phase (which also needs a `script` field added to the charm model + a manifest write).

**4. API reference now, inline intellisense later — built on *one* authored source.** v1 ships the collapsible right-side reference pane (searchable, drill-in, signatures + examples). The data is a single typed `ApiItem[]` module, **static in the frontend** (it describes the game's Lua API — editor knowledge, not per-install data, so there is no reason to serve it from Rust). We **do not port the predecessor's two forked lists verbatim** — that would re-import the duplication we are trying to avoid. Instead we author one `ApiItem` tree (seeding its content from the predecessor's `gameApi.ts` *and* `CompletionProvider.ts`, merged), and a later phase registers a Monaco completion provider as a **projection of that same tree** — no re-authoring, no drift. We explicitly do not build inline completion in v1, but the single-source decision is what keeps it cheap when we do.

**5. Tabs are objects, not scripts.** Opening an object from the list opens (or focuses) a **tab**; each tab is a full object workspace, and several stay open at once — the VS-Code mental model the tool reached for from the start, but the unit is the *object*, not a file. This is what makes "edit everything in one place" composable across objects.
- **One click opens a persistent tab** (no preview/pinned distinction in v1 — deferred). Clicking an already-open object focuses its existing tab rather than duplicating it.
- **Per-tab everything:** dirty state, save, and pane layout belong to the tab (commitment 2).
- **The shared-script cross-tab hazard, handled.** Tabs make shared scripts concrete: two creature tabs can point at the same `ai_default.lua`. The rule — **when a shared script is saved from one tab, any other open tab showing that same file refreshes to the new contents**; and if that sibling tab holds *unsaved* script edits, it must **warn before clobbering**, never silently lose work. This is what re-justifies the `Scripts/` cache + watcher: not external editors, but keeping sibling tabs consistent. The "shared by N" / "also open in another tab" signals (commitment 2) are the surfaced face of this.
- **Restoring open tabs across app restarts is deferred** (nice-to-have).

### What this locks in vs. leaves open

- **Locks in:** **tabbed object workspaces** (tabs = objects, per-tab dirty/save, cross-tab shared-script refresh); script editor as center; **Monaco** with self-hosted workers; single ⌘S save across two atomic targets with defined order; scripts presented as shared files with reach shown; one static `ApiItem` source feeding reference now and intellisense later; **creatures embedded** under the unified save (lifting `CreatureForm` state); **pane default = script only, flanks collapsed**; charms data-only in v1 but architected to gain scripts.
- **Leaves open:** nothing structural remains — only reference *reach* (how much of the API surface v1 seeds), which is a content-authoring scope call, not a design fork.

### Out of scope for v1 (named deferrals, not gaps)

- **Lua validation / error feedback.** v1 has syntax highlighting only — no parse/error checking, no error panel. The predecessor's `ScriptValidator` + `ErrorPanel` are **not** ported. (Matt's call: highlighting is enough for v1.)
- **Script test-runner.** No "run/test this script" + result panel (predecessor's `ScriptTestingFramework` + `TestResultPanel`). Out.
- **"Open in VS Code."** No external-editor handoff. Out — the `Scripts/` watcher stays, re-justified by cross-tab consistency (commitment 5).
- **"Add Script" / creating new scripts.** Next phase — it needs a manifest write *and* a `script` field on the `Charm` model. v1 edits existing scripts only.
- **Inline intellisense.** v1 ships the API *reference panel* only; the single `ApiItem` source keeps the completion provider a cheap later projection (commitment 4).
- **Preview tabs** (single-click-preview vs. pinned) and **restoring open tabs across restarts** — both deferred; v1 tabs are simple and session-only (commitment 5).

## For the architect

*(Architect-reviewed 2026-06-06; the points below are the agreed resolutions.)*

- **Backend gap (required for v1):** a `get_script(name)` / `save_script(name, contents)` pair that resolves the **logical script name** (the value already in the `script`/`aiController` field) through `dal::assets::resolve_asset`, then reads/writes the file — mirroring `dal::sprites`. No new path-resolution rules: the script names are already in `assets.json` (134 gameplay scripts) and point into `Scripts/`. Model a `dal::scripts` domain with a Moka cache keyed by script name (like the `sprites` cache, not the per-domain singleton caches).
- **`get_script` / `save_script` edge cases:** the read must distinguish three states, not two — (a) name absent from manifest → genuinely script-less (the charm case); (b) name in manifest but file missing on disk → surface as a *broken-install error*, **not** an editable blank that a save would silently create; (c) resolved → contents. Because "Add Script" is deferred, `save_script` must **refuse to write a name that doesn't already resolve** (no orphan `.lua` the manifest doesn't know about). Reuse the atomic temp+rename write, generalized off the `.json`-specific extension.
- **Script cache + cross-tab consistency:** a `dal::scripts` cache is the source of truth a tab reads from. The v1 cross-tab refresh (commitment 5) is the **in-app** case — tab A's `save_script` succeeds, and the **frontend** tells sibling tabs holding the same file to refresh (or warn if dirty). This is orchestrated client-side off the save result; it needs **no** watcher→frontend event pipeline (the current `notify` watcher invalidates the Rust cache but emits no Tauri event, and v1 does not add one). A `Scripts/` watch (the watcher currently covers `Data/` + game root non-recursively — **not** `Scripts/`) is worth adding only to freshen the cache for the *next read* if a `.lua` changes on disk by some route; v1 promises **no live auto-refresh** on external edits (consistent with "Open in VS Code" being out of scope).
- **Two-target save (decided):** two separate, individually-atomic commands (`save_<entity>` + `save_script`), orchestrated and reconciled in the frontend — not one bracketing Rust command (a cross-file atomic write across `Data/` and `Scripts/` isn't achievable anyway, and a single command would have to special-case all six entity types). Save the data record (the pointer) before the script file.
- **"Add Script" deferred to the next phase (not abandoned):** creating a new script is also a **manifest write** (a new `.lua` needs an `assets.json` entry or it won't resolve) — a third write target touching the manifest cache. v1 edits existing scripts only; script-less objects are data-only. **Note:** Matt has signalled charms will need scripts, so this phase is near-term, and it pairs with adding a `script` field to the `Charm` model. Architect this as the planned next step, not a someday-maybe.
- **API data location (decided):** static, typed `ApiItem[]` in the frontend. Not served from Rust — it's editor knowledge, not per-install data, and a Monaco provider registers client-side anyway. Revisit only if the API surface ever becomes per-install/moddable.

## For the engineer

*(Engineer-reviewed 2026-06-06; resolutions folded in.)*

- **Editor engine — decided: Monaco, self-hosted workers.** Not left open. Monaco's `registerCompletionItemProvider` is the projection target for the committed single `ApiItem` source. The predecessor's `@monaco-editor/react` CDN worker loader **fails in an offline Tauri app**, so Monaco ships with workers self-hosted via a Vite plugin (`vite-plugin-monaco-editor-esm`, or manual `?worker` wiring) — accept the bundle cost (~few MB) as the price of the committed intellisense path. Register the Lua language config + completion provider **once at app init**, not per-mount. Do **not** port the predecessor's `MonacoEditor.tsx` worker/global wiring (module-level globals keyed off `entityType`, brittle internal-change dance) — rebuild the editor as a controlled component (`value` + `onChange` + `onSave`).
- **`EntityFieldsForm` extraction is the enabling task** for the single dirty state (see commitment 3). The DATA pane dispatches on `objectType` to select the schema + save command — the write-side twin of the `get_game_objects` match arm.
- **Creature embed lifts state:** per Matt's decision, the creature form embeds under the unified save, so `CreatureForm`'s dirty/save lift into the workspace. This is the most delicate piece in v1 — plan it as its own work item.
- **Tabs multiply state:** dirty/save is now **per-tab** across N open object workspaces, plus the cross-tab shared-script refresh (commitment 5) — when one tab saves a shared `.lua`, sibling tabs showing it must refresh, and warn if they hold unsaved edits. Plan the tab/dirty model and the shared-script sync as explicit pieces (the predecessor's `ScriptTabs` was script-keyed; ours is object-keyed — don't reuse it directly).
- **Items reuse:** lift the existing `loadItemRows` / `saveItemRow` join logic into a shared module that both the items table and the DATA pane import — don't reimplement the `items ⋈ itemDropTable` join.
- **API content is authoring, not a port.** Merge `gameApi.ts` (~1600 lines, already `ApiItem`-shaped with `members`/`examples`) and `CompletionProvider.ts` (~700 lines, 189 flat items) into **one** `ApiItem` tree. Reconciling two hand-authored lists is real authoring work — size it as such. Rebuild the reference UI (MUI panels/snackbars) in shadcn/Tailwind.
- **Watcher / script cache:** the cross-tab refresh (commitment 5) is **frontend-orchestrated** off `save_script` success — no watcher event needed, no net-new watcher→frontend pipeline. The `Scripts/` watch only freshens the `dal::scripts` cache for the *next read* if a `.lua` changes on disk externally; v1 promises no live push.

## Open questions

**Resolved through review (2026-06-06, architect + engineer + Matt):**
- **Save model:** two atomic targets, frontend-reconciled, data before script; **per-tab** dirty state; scripts shown as shared files with reach.
- **Tabs = objects:** multiple objects open as tabs (not script-tabs); per-tab dirty/save; cross-tab refresh when a shared script is saved. Preview-tabs and tab-restore deferred.
- **Out of scope for v1:** Lua validation/error feedback, script test-runner, "Open in VS Code", "Add Script", inline intellisense, preview/restore tabs (see the "Out of scope" section).
- **Editor engine:** **Monaco, self-hosted workers** — committed (it's the intellisense projection target).
- **Creatures:** **embedded** under the unified save (one place to edit everything); the standalone Creature Editor narrows to the balance surface. Cost: lifting `CreatureForm` state into the workspace.
- **Pane default:** script editor only, DATA + API collapsed.
- **Charms:** data-only in v1, but architected to gain scripts (not a permanent special case).
- **"Add Script":** deferred to the near-term next phase (pairs with charms gaining scripts + a manifest write).
- **API data:** one static `ApiItem` source in the frontend, merged from the predecessor's two lists — not a verbatim port.

**Still open (scope, not design):**
- **Reference reach:** does v1 seed the `ApiItem` source with the full predecessor API surface, or a curated subset? (Completeness builds trust for the modder audience; a thin reference quietly erodes it. Lean: do the full merge once.)

---
# Review: architect

**Date**: 2026-06-06
**Decision**: Request for Comment

**Comments**

The product shape is sound and I'm aligned on the one-workspace-per-object model, the single-dirty/single-save commitment, and the "data is the structured lens, Workbench is the code lens, both write the same records" framing. My concerns are structural, and one of them changes a load-bearing fact the proposal asserts. None of these block the *design* — they block handing it to an engineer as written, because the engineer would build to the wrong path model.

### 1. The script path model in the proposal is wrong — and resolution already exists (blocking)

The "For the architect" section says `get_script(path)` / `save_script(path, contents)` should read/write "the `.lua` file the `script` field points at, relative to the data dir." I checked the real game data, and this is not how it works:

- The `script` field is a **bare filename**, not a typed-subdirectory path: abilities store `"script": "ability_bite.lua"`, creatures store `"aiController": "ai_default.lua"`. (The predecessor's `scriptUtils.validateScriptPath` assumed `abilities/{id}.lua` style paths — that convention does **not** match this game's data. Do not port it.)
- The files live at `<gameInstallPath>/Scripts/<name>.lua` — a **sibling of `Data/`, not under it.** "Relative to the data dir" would resolve to the wrong directory.
- Critically: **these scripts are already in `assets.json`.** `ability_bite.lua` → `Scripts\ability_bite.lua`; 134 gameplay scripts are in the manifest. That means `dal::assets::resolve_asset` already resolves a bare script name to an absolute path today — the exact same machinery that backs `get_sprite`. `resolve_asset` even has the bare-stem fallback, though scripts already carry their `.lua` extension so no fallback is needed.

**Structural consequence:** the backend gap is real, but smaller and differently shaped than the proposal describes. `get_script`/`save_script` should take the **logical script name** (the value already in the `script` field), resolve it through `resolve_asset`, and read/write the file. This mirrors `dal::sprites` exactly: resolve-through-manifest, then I/O. No new path-resolution rules to invent. I'd model a `dal::scripts` domain with a Moka cache keyed by script name (like the `sprites` cache, not the singleton domain caches) and add a watcher invalidator — but note the watcher currently does two **non-recursive** watches (`Data/` and game root); it does **not** watch `Scripts/`. External edits to `.lua` files won't invalidate unless we add a `Scripts/` watch. Given "Open in VS Code" is a stated feature, external edits are expected, so this matters. Flagging for the engineer.

### 2. Scripts are shared, not 1:1 with objects — the save model has a hazard (blocking to acknowledge)

`ai_default.lua` is the `aiController` for many creatures. So the script target is **not** owned by the selected object — it's shared infrastructure. The "single invisible save" commitment is still right, but it now carries a coupling the proposal doesn't name: **saving the script from creature A's workspace also changes the behavior of every other creature pointing at the same file.** That's correct game semantics (it's a shared controller), but the UX must not present the script as if it belongs to this one object. At minimum the script header should name the *file* (`ai_default.lua`), not imply "creature Bitlynx's script," and ideally surface "shared by N objects" so an edit isn't made blind. This is a UX call, so I've added ux-designer back to reviewers — but it originates from a data-shape fact, so I'm raising it here. (Abilities/items appear 1:1 by filename, so this is creature-specific in practice, but the model should assume sharing.)

### 3. Two-target save orchestration — decide on the backend, not the frontend (recommendation)

The proposal leaves open whether the frontend issues two commands and reconciles, or a single command brackets both. My recommendation: **two separate commands, orchestrated in the frontend, but each target independently atomic.** Reasoning:

- The two targets have genuinely different write paths (`save_<entity>` re-reads JSON, upserts by id, sorts, atomic-writes; `save_script` is a plain file write). A single bracketing Rust command would have to special-case all six entity types — that's the `get_game_objects` match arm duplicated on the write side, which is real coupling for little gain.
- A true cross-file transaction isn't achievable anyway (no two-file atomic rename across `Data/` and `Scripts/`). So "single command" buys atomicity it can't actually deliver.
- The honest model: each command is individually atomic; the frontend aggregates results and reports partial failure explicitly. The proposal already demands partial-failure legibility — that's *easier* to honor with two visible commands than to thread back out of one opaque one. Save the dirty targets independently, collect both outcomes, surface "script saved, data failed" precisely.

The one thing to get right: **save script first or data first?** If the data field that *is* the pointer (`script`/`aiController`) is being edited in the DATA pane at the same time as the script contents, ordering matters. Recommend: validate the pointer field hasn't changed under us, or save data (the pointer) before script. Worth a sentence in the proposal.

### 4. "One source, two surfaces" for the API data is aspirational — the predecessor never achieved it (blocking the cheapness claim)

The proposal's strongest forward-looking bet is that the API reference and future intellisense ride the *same* structured data. I want this to be true, but I checked: in the predecessor, **`CompletionProvider.ts` (708 lines, 189 hardcoded completion items) does not import `gameApi.ts`.** They are two independently-authored sources. So "port `CompletionProvider` and `gameApi.ts` nearly verbatim" (in the For-the-engineer section) would **import the duplication**, not the single source — and the future intellisense goal would *not* be cheap; it'd be permanently forked data that drifts.

If the dual-use claim is load-bearing (and the proposal leans on it to justify the data modeling now), then the actual v1 work is: model **one** `ApiItem` tree as the source of truth, and write the Monaco completion provider (later) as a *projection* of that tree — not port the predecessor's separate hardcoded list. That's a real design decision, not a verbatim port. The proposal should either (a) commit to building the single source now and explicitly *not* porting `CompletionProvider` verbatim, or (b) drop the "one source, two surfaces" justification and treat the reference as standalone. It can't have both.

On **where the API data lives** (open question for me): keep it **static in the frontend** as a typed `ApiItem[]` module. It's authored content, not game data read from the install dir — it describes the game's Lua API, which is editor knowledge, not per-install data. Serving it from Rust buys nothing (no caching benefit, no disk source) and adds a command round-trip. A Monaco completion provider registers client-side anyway, so co-locating the source with its consumer is correct. Only reconsider if the API surface ever becomes per-install / moddable — not a v1 concern.

### 5. Can the DATA pane reuse the existing field schemas? Mostly yes, with one seam (answering the proposal's question)

The proposal hopes the DATA pane reuses `EntityField` schemas "where practical." Structurally this is achievable for abilities/biograms/effects/items — they're flat schema-driven records and that's exactly what `EntityDataTable`/`EntityEditDialog` already render from. The seams:
- **Items** join `itemDropTable.json` — the DATA pane inherits the two-record save the items table already does. That's a *third* save target for items specifically. Fine, but name it.
- **Creatures** have no flat schema — they're a bespoke form (base/growth stat grids, per-level unlocks). There is no `EntityField` schema to reuse. So "reuse the schemas" genuinely cannot cover creatures; the open question on creature-integration-depth is really "do we embed the Creature Editor or show raw JSON." My structural lean: for v1, embed/link the existing creature affordances rather than reinvent a raw-field editor, because a second creature editor is a second source of truth for the same record and they *will* diverge on normalization (the zero-stripping save logic lives in `creature.ts`). Reuse the real one or link out to it.
- **Charms** have no `script` *and* a non-flat `stats` map. They're already the odd one out (excluded from the script feed). Confirm they're in-scope for the DATA pane at all in v1, or whether the Workbench simply doesn't list them until "Add Script" exists.

### On the open questions
- **Editor engine (Monaco vs lighter):** this is the engineer's call on bundle/worker cost, but note the architectural pull: if "one source, two surfaces" (point 4) is committed, Monaco's `registerCompletionItemProvider` is the surface the second projection targets. A lighter editor makes the future intellisense lift larger. The two open questions (engine + dual-use data) are coupled — decide them together, not separately.
- **Add Script (script-less objects):** in scope is fine, but it's a *write to the manifest* too (a new `.lua` needs an `assets.json` entry, or it won't resolve through `resolve_asset` on next load). That's a third write target and touches the manifest cache. Non-trivial — I'd defer "Add Script" out of v1 and ship script-less objects as data-only, unless Matt needs to author new scripts immediately.

**Summary:** Request for Comment. The design is right; the implementation facts it hands to the engineer are partly wrong (path model), partly more achievable than stated (resolution already exists via `resolve_asset`), and one core justification (single API source) is contradicted by the very code it proposes to port verbatim. Fix the path/resolution description, name the shared-script coupling, and resolve the API-data-source question, and I'm aligned.

---
# Review: engineer

**Date**: 2026-06-06
**Decision**: Request for Comment

**Comments**

The design is buildable and I'm aligned on the shape: one-workspace-per-object, script editor as center, single-dirty/single-save across independently-atomic targets, scripts-as-shared-files, the static `ApiItem` single source, and embedding the real Creature Editor rather than forking it. The architect already settled the path model, the shared-script coupling, and the two-target orchestration — I'm not re-raising those. My concerns are all about **buildability seams the proposal glosses**: a couple are things I'd have to design-decide mid-build (which means they're architecture, not implementation), and one is a hard fork (Monaco worker setup) that should be resolved before this is planned, not discovered during it. None block the *design*; several block *handing it to an engineer as "go build it"* without guessing.

### 1. The DATA pane needs the full typed record — `get_game_objects` doesn't carry it (blocking-to-name)

The object list is fed by `get_game_objects`, which is a **lossy projection**: `GameObject { objectType, id, name, sprite, script, description }`. It deliberately drops every type-specific field — an item's `itemTags`, an ability's range/cost, an effect's payload. But the DATA pane's whole job is to edit *those* fields, and the existing `EntityField` schemas are typed against the **full** records (`Item`, `Ability`, …), not `GameObject`.

So selecting an object in the Workbench requires a **second fetch**: load the full per-domain record (via the existing `get_<domain>` command, or all of them up front like the data-table pages do) and find it by `id` within the selected `objectType`. The proposal's flow step 2 ("DATA pane shows its fields") quietly assumes the full record is in hand; it isn't. This is a real data-flow seam — name it, and decide whether the Workbench loads all six domains on mount (simple, matches how the tables already work, a few hundred rows total) or lazy-loads the selected object's domain. Either is fine; it just needs to be a decision, not a surprise.

### 2. "Reuse the `EntityField` schemas" is a `objectType`-dispatch + a form-body extraction, not a drop-in (blocking-to-scope)

Two concrete frictions behind the one-line claim:

- **`EntityField<T>` is generic over the concrete record type** — `key: Extract<keyof T, string>`. There is no single schema that spans all entity types; each data-table page authors its own `FIELDS: EntityField<ItemRow>[]`, `EntityField<Ability>[]`, etc. Reuse means the DATA pane imports all of them and switches on `objectType` to pick the schema + the right save command. That's a discriminated-union dispatch the proposal should acknowledge — it's the write-side twin of the `get_game_objects` match arm, the same coupling the architect flagged for the bracketing-save approach, just on the form side. Manageable, but it's the structural cost of "one DATA pane, six types."

- **The schema-driven *form body* is currently trapped inside `EntityEditDialog`.** That component owns the dialog chrome, its *own* draft state, its *own* dirty tracking (`JSON.stringify` compare), and its *own* Save button/footer. The Workbench can't use the dialog — it needs the field grid (`FieldControl` map) **without** the dialog and with dirty/save **lifted to the workspace** (commitment 2's single dirty state). So the real v1 task is: extract the form-body grid into a shared, controlled component (`fields` + `value` + `onChange`, no internal save), then have both `EntityEditDialog` and the Workbench DATA pane render it. That's a clean refactor and a good one, but it's *the* enabling piece for commitment 2 and the proposal doesn't mention it. Without it, the engineer either rebuilds the field grid (a second source of truth — exactly the drift the proposal warns about for creatures) or the single-dirty-state commitment doesn't hold.

Neither is hard. But "reuse the schemas" reads as zero-cost and it's actually "extract a controlled `EntityFieldsForm`, then dispatch it by type" — worth a sentence each so planning sizes them.

### 3. Dirty-state aggregation is the load-bearing mechanic and it has no owner yet (blocking-to-name)

Commitment 2's "single dirty state aggregating script + data" is the trust core, and it spans **three** independently-stateful sub-editors that today each own their dirty privately:
- the script editor (script contents vs. loaded contents),
- the DATA pane (which, per #2, must expose dirty rather than swallow it),
- and for creatures, the embedded Creature Editor — which has its *own* `dirty` (`sameCreature` compare in `CreatureEditor.tsx`) and its own save path (`saveCreature`, with the zero-stripping normalization in `creature.ts`).

For the single ⌘S to "write whichever targets are dirty," the workspace has to own an aggregate dirty derived from per-target dirty, and route the save to each dirty target's own command. The embedded Creature Editor case is the sharp one: the proposal says "embed or link" the existing editor — but *embedding* it under the unified save means its internal dirty/save must be lifted up too, which is a non-trivial change to a working component, whereas *linking out* sidesteps the unified-save promise for creatures entirely. That fork (embed-with-lifted-state vs. link-out) is an architecture decision with real cost asymmetry, and it's currently buried inside "embed or link." Pick one — I lean **link-out for v1** (creatures keep their own editor + own save; the Workbench script pane saves only the `.lua`), because lifting the Creature Editor's state into a shared dirty bus is a meaningful refactor of the one component that's most painful to get wrong, and it can come later without re-architecting.

### 4. Monaco + Vite/Tauri worker setup is the real fork — and it needs resolving *before* planning, not during (blocking)

The engine open question is framed as bundle/worker *cost*, but the concrete blocker is **worker wiring**, and it bites differently here than in the Electron predecessor. The predecessor used `@monaco-editor/react`, whose default loader pulls Monaco's workers from a **CDN at runtime**. A Tauri app is offline/`tauri://`-served — the CDN loader will silently fail to load the editor or its language workers. So Monaco here means one of:
- `vite-plugin-monaco-editor` (or `vite-plugin-monaco-editor-esm`) to emit and self-host the workers, **or**
- manual `self.MonacoEnvironment.getWorker` wiring with Vite `?worker` imports, self-hosted.

Either is a known, solved pattern, but it's setup the predecessor never had to do, it adds a non-trivial bundle (Monaco is ~3–5 MB of workers), and it interacts with the Tauri CSP. None of that is visible in "Monaco vs. lighter." My recommendation: **decide the engine in this proposal, not at build time**, because it gates the worker/CSP/bundle setup that has to land before the editor renders a single character. Given the committed single-`ApiItem`-source intellisense goal, Monaco's `registerCompletionItemProvider` is the natural projection target (the predecessor proves the registration pattern works and the `provideCompletionItems` mapping from `ApiItem` is straightforward). I'd commit to **Monaco, self-hosted workers via the Vite plugin**, and accept the bundle cost as the price of the committed intellisense path — *or* explicitly downgrade the intellisense commitment if we want CodeMirror's lighter footprint. The two decisions are coupled (the architect said this); I'd just resolve them now rather than leave the engine open, because "open" here means "the build can't start."

One concrete reuse note: the predecessor's `MonacoEditor.tsx` registers its completion/Monarch providers as **module-level globals keyed off `entityType`** and has a brittle internal/external-change dance (`isInternalChangeRef`). Don't port that wiring — it's the messiest file in the predecessor. Rebuild the editor as a controlled component (value + onChange + onSave), register the Lua language config + the single-source completion provider **once** at app init, not per-mount.

### 5. `get_script` / `save_script`: pin down the missing-file and create-on-save cases (non-blocking, but name it)

Mirroring `dal::sprites` is exactly right, but sprites get to treat "manifest entry points at a missing file" as "no art → placeholder." Scripts can't be that lax on the write side:
- **Read:** distinguish *three* states, not two — (a) name absent from manifest → object is genuinely script-less (the charm case), (b) name in manifest but file missing on disk → a real error worth surfacing (a registered script that isn't there is a broken install, not an empty editor), (c) resolved + read → contents. The proposal's "no script" state should map to (a) only; (b) shouldn't render as an editable blank that a save would then *create*, silently masking the breakage.
- **Save:** `save_script` writes to the resolved path. Since "Add Script" / new-`.lua` is deferred, `save_script` should only ever write to a path that already resolves through the manifest — i.e. refuse (or clearly error) if the name doesn't resolve, rather than writing an orphan file the manifest doesn't know about. One sentence in "For the architect" pins this.
- Reuse `atomic_write`'s temp-then-rename approach for the `.lua` write too (it's generic enough; just not `.json`-specific extension). Worth confirming the temp-extension assumption in `atomic_write` (`with_extension("json.tmp")`) is generalized, or scripts get a sibling helper.

### 6. Items' third save target compounds with the join-load (non-blocking)

The architect named items' `itemDropTable.json` as a third save target. Adding to that: the items DATA pane also inherits the **join-load** (`loadItemRows` merges `items` ⋈ `itemDropTable` and splits on save in `saveItemRow`). So for items specifically, the Workbench DATA pane isn't "render the `Item` schema" — it's "render the joined `ItemRow` schema and split-save two records," exactly as `ItemsDataTable` already does. The clean reuse is to lift `loadItemRows`/`saveItemRow` (already module-scope, already stable references) into a shared module both the table and the Workbench import — not to reimplement the join. Worth a line so it's reuse, not a re-write.

### On the open questions
- **Pane defaults:** agree with the lean (script-only, flanks collapsed). No engineering objection; it's also the cheapest initial render (DATA pane's per-domain load can be deferred until expanded if we lazy-load, per #1).
- **Editor engine:** see #4 — I'd close this *in* the proposal, not defer it to me, because it gates setup work that blocks everything downstream.
- **Charm treatment:** charms are already excluded from the script feed and have a non-flat `stats` map with no `EntityField` schema (they use a `custom` field render in their own table). Listing them as data-only in v1 means the DATA pane must handle the `custom` stats-map field too — which it can, since `EntityField` already has the `custom` escape hatch the charm table uses. So "list charms as data-only" is *cheaper than it looks* (the custom renderer already exists) — I'd include them rather than omit, for object-list completeness. Just confirm the charm save path (`save_charm` + zero-stripping) rides along.
- **Reference reach:** seed the full predecessor surface, merged into one `ApiItem` tree. The merge of `gameApi.ts` (1593 lines, already an `ApiItem`-shaped tree with `members`/`examples`) and `CompletionProvider.ts` (708 lines, 189 flat items) is the actual v1 content task and it's non-trivial *authoring* work (reconciling two hand-authored lists into one), not a port — size it as such in planning. A thin reference is cheap now but, as the proposal says, quietly erodes the modder trust we're investing in; do the merge once.

**Summary:** Request for Comment. The design is sound and the architect's corrections land it on the right path model. My asks are buildability seams that, left implicit, become mid-build architecture decisions: (a) name the full-record second-fetch behind the DATA pane, (b) call out that schema reuse requires extracting a controlled `EntityFieldsForm` and a per-type dispatch, (c) resolve the embed-vs-link-out fork for creatures under the unified save (I lean link-out for v1), (d) **decide Monaco + self-hosted workers in the proposal**, since it gates setup that blocks the build, and (e) pin the `get_script`/`save_script` missing-file and no-orphan-write rules. Fold those in and I'm aligned.

---
# Review: engineer (re-review)

**Date**: 2026-06-06
**Decision**: Aligned

**Comments**

All five of my seams landed accurately, and I re-verified each against the code. (a) the lossy-`get_game_objects` second-fetch is named in commitment 3 and "For the engineer." (b) the `EntityFieldsForm` extraction is the stated enabling task — confirmed `EntityEditDialog` still owns its own `draft`/`dirty`/Save internally, so the extraction is real and correctly scoped. (d) Monaco + self-hosted workers is now decided in the body, open questions, and "For the engineer," with the don't-port-`MonacoEditor.tsx` and register-once-at-init notes intact. (e) the `get_script`/`save_script` three-state read + no-orphan-write rule is folded into "For the architect" verbatim. (#6) items join-reuse (`loadItemRows`/`saveItemRow` → shared module) is in — confirmed those functions live in `ItemsDataTable.tsx` today.

**On the embed-creatures decision (the fork I'd left open) — I withdraw my link-out lean.** My lean rested on one assumption: that lifting the Creature Editor's state into a shared dirty bus was "a meaningful refactor of the one component most painful to get wrong." I read the actual code and that assumption is wrong. `CreatureForm.tsx` is *already* a pure controlled component (`creature` + `onChange`, "all state lives in the parent, which owns dirty tracking and saving" — its own docstring). The dirty/save it needs lifted lives in `CreatureEditor.tsx` as a ~15-line pattern: a `draft` working copy, `saved` from the population, `dirty = !sameCreature(draft, saved)` (JSON.stringify compare), and `handleSave` → `saveCreature(draft)`. That is the *same* controlled-component shape the flat types get from `EntityFieldsForm` — the workspace already has to own exactly this for every other type. So the embed isn't a risky refactor of a working component; it's dropping an already-pure form into the dirty/save bus the workspace builds anyway. The proposal names this as "the most delicate lift in v1, plan it discretely," which is honest and correctly sized — delicate because it's the bespoke save path (zero-stripping normalization in `creature.ts` must ride along), not because the component fights the lift. **Embed-with-lifted-state is acceptable v1 scope. Not a blocker.**

**One new, non-blocking seam the embed decision surfaces — flag for the planner, not a re-review gate.** `CreatureForm` renders the `ProgressionChart` *inside its own body* (its first `Section`). The proposal says on creatures "the right-side pane gives way to the existing progression view, as in the predecessor." If the workspace embeds `CreatureForm` as-is *and* also puts a progression view in the right pane, the chart renders twice. Resolution is cheap and is an implementation call, not a design fork — either (i) embed `CreatureForm` as-is and let the right API pane simply not apply to creatures (chart stays in the form body, no separate right-pane view), or (ii) lift `ProgressionChart` out of `CreatureForm` into the right pane and render the form without it. Either is fine; planning just needs to pick one so the engineer doesn't double-render or guess. I lean (i) for v1 — it's zero new layout work and keeps `CreatureForm` untouched.

**Summary:** Aligned. Every concern from my first review is folded in accurately, and the one decision I'd deferred (embed vs. link-out for creatures) is both decided *and*, on reading the code, the lower-risk choice than I'd assumed — `CreatureForm` is already pure, so the named cost is real but bounded. The only thing I'm leaving behind is a non-blocking layout note (the double-render of the progression chart) for the planner to resolve at build time.

---
# Review: architect (re-review)

**Date**: 2026-06-06
**Decision**: Aligned

**Comments**

All five of my original concerns are resolved, and I re-verified the load-bearing ones against the actual code rather than the prose.

1. **Script path model** — corrected throughout. Bare filename, `Scripts/` sibling of `Data/`, resolved via `dal::assets::resolve_asset`, `get_script`/`save_script` mirroring `dal::sprites`, a name-keyed `dal::scripts` Moka cache (not a domain singleton), and the non-recursive watcher's `Scripts/` gap is named. Confirmed against `dal/assets.rs` (`resolve_asset` → `Ok(None)` on manifest miss) and `dal/sprites.rs` (resolve-then-IO, name-keyed cache). The shape is right and buildable as written.
2. **Shared-script coupling** — folded into load-bearing fact 2 and commitment 2 (header names the *file*, surfaces "shared by N"). The coupling is now sighted, not invisible. Good.
3. **Two-target save** — decided: two individually-atomic commands, frontend-reconciled, data (the pointer) before script, with explicit partial-failure legibility. This is the honest model; a single bracketing command can't deliver cross-file atomicity anyway. Resolved as recommended.
4. **One API source** — commitment 4 now commits to building *one* `ApiItem` tree (seeded from the predecessor's two lists, merged, not ported verbatim) with the future Monaco provider as a projection of that same tree. The "one source, two surfaces" justification is no longer contradicted by the porting plan. Resolved.
5. **DATA pane schema reuse** — commitment 3 names the controlled `EntityFieldsForm` extraction, the per-`objectType` dispatch, the lossy-`get_game_objects` second fetch, items' third (`itemDropTable`) target with join-reuse, creatures embedded under the unified save (Matt's call, with the `CreatureForm`-state lift sized honestly), and charms data-only. All seams named.

**On the two new additions I was asked to sanity-check:**

- **`get_script`/`save_script` three-state read + no-orphan-write** — structurally sound and verified against code. `resolve_asset` returns `Ok(None)` for the manifest-absent case (state a = genuinely script-less), and because file I/O happens *after* resolution (as in `sprites.rs`), the in-manifest-but-missing-on-disk case (state b = broken install) is cleanly distinguishable from a resolved read (state c). Mapping the "no script" UI state to (a) only, and refusing a `save_script` whose name doesn't already resolve, is exactly the right boundary — it keeps "create a new script" (a manifest write) out of v1 by construction rather than by convention. One implementation note for the planner, not a design gap: `atomic_write` in `dal/mod.rs` hardcodes `path.with_extension("json.tmp")`, so a `.lua` write through it produces a `.json.tmp` sidecar before the rename. It functions, but the temp-extension must be generalized (or scripts get a sibling helper) — the proposal already flags this; I'm confirming the flag is real.

- **Charms gaining scripts as the near-term next phase** — structurally sound, and I'm comfortable deferring the manifest-write design rather than doing it now. Confirmed the `Charm` model (`model/mod.rs`) has no `script` field today, so the phase genuinely pairs a model-field addition with the manifest write — they're one unit of work, correctly bundled. The reason deferral is safe is that the v1 boundary is *load-bearing on its own*: the data-driven script affordance (presence of a `script`) and the no-orphan-write rule mean charms simply read as data-only until both the model field and a manifest entry exist, with no v1 code that assumes "charm = permanently script-less." Designing the manifest-write target now would be premature — it's a third write surface (install-root `assets.json` + the `manifest` Moka cache) whose shape is better settled when "Add Script" is actually built. The framing as "planned next phase, not someday-maybe" is the right altitude.

No new structural concerns. The implementation facts handed to the engineer are now correct, the coupling that matters (shared scripts, two-target save, the cross-file atomicity it can't have) is named, and the one forward bet (single API source) is no longer self-contradicting. Removing myself from reviewers.

**Summary:** Aligned.

---
# Review: engineer (re-review — tabbed model)

**Date**: 2026-06-06
**Decision**: Aligned

**Comments**

Re-confirm triggered by the one material change: object workspaces are now **tabbed** (multiple objects open at once, unit = object not script-file), with **per-tab dirty/save** and a new **cross-tab shared-script refresh** seam (commitment 5). I evaluated only the tab model, commitment 2's per-tab framing, commitment 5, the "Out of scope for v1" section, and the updated "For the engineer" bullets, against the code.

**Per-tab dirty/save scales cleanly — no new architecture.** Per-tab is N independent copies of the single-workspace dirty/save model the prior review already validated (aggregate dirty over script + DATA + embedded-creature, ⌘S saves the active tab's dirty targets). Tabs share no mutable frontend state *except the shared `.lua` file itself*, which is exactly what commitment 5 governs. The Monaco "register language config + completion provider once at app init, not per-mount" commitment (For the engineer; #4 prior review) is what makes N concurrent editor instances safe — N controlled editors over one global language registration is the standard Monaco pattern. The note to **not** reuse the predecessor's script-keyed `ScriptTabs` (ours is object-keyed) is correct and now stated. No objection.

**Commitment 5's in-app refresh is sound and frontend-orchestrable — the watcher is *not* its mechanism, and that's worth one sentence so it isn't over-built.** I verified the watcher in `dal/mod.rs`: it invalidates the matching **Rust cache** on a disk change; it does **not** emit any Tauri event. Confirmed there is zero event-emit machinery in `src-tauri/` (no `emit`/`Emitter`/`AppHandle`/`Channel`) and zero `listen` on the frontend. So the existing watcher's effect is invisible to open tabs — it only makes the *next* `invoke("get_…")` return fresh bytes; it never tells a tab to re-fetch.

That matters because commitment 5's load-bearing v1 behavior is the **in-app** case: tab A saves `ai_default.lua` → sibling tab B holding the same file refreshes (or warns before clobbering its unsaved edits). That flow is *purely frontend-orchestrated* — after `save_script` returns OK, the frontend already knows which open tabs share that file name and can refresh/guard them directly. It needs **no** watcher round-trip and **no** new event-push pipeline. This is good news (it's cheaper than the prose implies), but "For the architect" point 3 phrases it as "saving it from one tab must invalidate the cache and **notify open tabs to refresh** … a `Scripts/` watch … is the clean mechanism," which reads as if the watcher delivers the cross-tab notify. As built, it can't — wiring a watcher→frontend event bridge would be net-new backend scope (a Tauri `emit` + a frontend `listen`) that v1 does **not** need for the committed behavior. Recommend one clarifying sentence: the in-app cross-tab refresh is frontend-orchestrated off the `save_script` success; the `Scripts/` watch only freshens the `dal::scripts` **cache** for the *next read* (defense against disk-route edits), and with "Open in VS Code" out of scope, v1 does **not** promise live auto-refresh of an open tab on an external edit. Non-blocking — naming it just keeps an engineer from building an event pipeline the committed scope doesn't require. The `dal::scripts` name-keyed cache + `Scripts/` watch-invalidator (mirroring `sprites`) is still the right shape and I'm aligned on it; I'm only narrowing what it's responsible for.

**Out-of-scope section is honest and the deferrals are real, not gaps.** No Lua validation (highlighting only), no test-runner, no "Open in VS Code," no preview/pinned tabs, no tab-restore-across-restart. Each removes work, none leaves a seam the in-scope parts depend on. In particular, dropping "Open in VS Code" is what makes the watcher's "silent cache-only refresh" acceptable — the only v1 path that mutates a `.lua` is an in-app save, which the frontend orchestrates end to end. Consistent.

**Summary:** Aligned. The per-tab dirty/save model is a clean multiplication of the already-validated single-workspace model, and the one genuinely new cross-tab coupling (shared `.lua`) is correctly guarded by the save-refresh + clobber-warn rule. The only thing I'd fold in is non-blocking: clarify that commitment 5's in-app refresh is frontend-orchestrated off `save_script`, not delivered by the watcher (which today only freshens the cache, emits nothing) — so the committed behavior doesn't get mis-sized into a backend event-push pipeline it doesn't need. That's a one-sentence tightening, not a design hole, so I'm aligned and removing myself from reviewers.
