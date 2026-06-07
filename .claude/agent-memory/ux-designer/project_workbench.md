---
name: project-workbench
description: The Workbench design effort — third tool in Script Kitties Editor
metadata:
  type: project
---

Designing the **Workbench**, the third tool (currently a stub: `src/pages/Workbench.tsx` returns "Workbench here!"). Started 2026-06-06.

Three functionalities Matt named:
1. Left sidebar listing **every editable game object** (VS Code file-list style). Fed by the existing `get_game_objects` command, which already unifies abilities/biograms/charms/creatures/effects/items into `GameObject {objectType, id, name, sprite, script, description}`.
2. A **Lua script editor** with syntax highlighting to edit object scripts.
3. An **API reference**, ideally hooked into the editor (sidebar panel is fine for v1, but leave room for true intellisense-style inline hints later).

Matt's decisions:
- Workbench should be able to **edit everything** about an object, not just the script (full overlap with Data Tables + Creature Editor — coherence/source-of-truth is a key design risk to resolve).
- API reference: side panel acceptable now, **inline intellisense is a forward goal** — keep the architecture open to it.

**Why:** Workbench is the one surface where the editor becomes a code tool, not a form-filler. That shifts the trust model (dirty state, save, "did my change take").

**Design proposal (ACCEPTED 2026-06-06, commit b907676):** `.frames/sdlc/proposals/accepted/20260606-workbench-design.md` (author ux-designer; architect + engineer both Aligned). Next step when Matt wants it: plan into tasks.

**Resolved facts & decisions (load-bearing):**
- `script` is a **bare filename** pointing at a `.lua` file in `Scripts/` (sibling of `Data/`), already in `assets.json` → resolves via `dal::assets::resolve_asset` like a sprite. Backend gap: need `get_script`/`save_script` (a `dal::scripts` domain mirroring `dal::sprites`) + a `Scripts/` watcher.
- **Scripts are shared** (e.g. `ai_default.lua` controls many creatures) → editor header names the *file* and shows "shared by N" to prevent blind edits.
- **Two save targets** (entity JSON + `.lua` file), two atomic commands reconciled in the frontend, **data saved before script**; one aggregate workspace dirty state, one ⌘S.
- **Editor = Monaco**, self-hosted workers (CDN loader fails offline in Tauri); register completion once at app init.
- **One static `ApiItem` source** feeds the reference now and Monaco intellisense later (a projection) — merge the predecessor's two forked lists (`gameApi.ts` + `CompletionProvider.ts`), don't port verbatim.
- **Creatures embedded** under the unified save (Matt's call — one place to edit everything); lifts `CreatureForm` dirty/save into the workspace (most delicate v1 piece). Standalone Creature Editor narrows to the balance surface.
- **Enabling refactor:** extract a controlled `EntityFieldsForm` out of `EntityEditDialog` (no internal save); DATA pane dispatches on `objectType`. `get_game_objects` is lossy → second fetch of full per-domain record on select.
- **Charms** data-only in v1 but will gain scripts → script affordance is data-driven; "Add Script" is the planned next phase (needs `script` on Charm model + manifest write).
- **Pane default:** script editor only, DATA + API collapsed.
- **Tabs = objects (not scripts):** clicking an object in the list opens it as a tab; each tab is a full object workspace; multiple open at once (VS-Code model, unit = object). Per-tab dirty/save. **Cross-tab shared-script hazard:** two tabs can hold the same `.lua` (e.g. shared `ai_default.lua`) — saving from one refreshes the others, warns before clobbering unsaved edits. This re-justifies the `Scripts/` watcher (cross-tab consistency, not external editors). Predecessor's `ScriptTabs` was script-keyed; ours is object-keyed — don't reuse directly.
- **Out of scope for v1 (named deferrals):** Lua validation/error feedback (syntax highlighting only — Matt's call), script test-runner, "Open in VS Code", "Add Script"/new scripts, inline intellisense (panel only), preview-tabs, restore-tabs-across-restart.

**How to apply:** Reuse the predecessor [[reference-bcgeditor]] for content (API data, completion items) re-skinned to shadcn. When this proposal is accepted it gets planned into tasks.
