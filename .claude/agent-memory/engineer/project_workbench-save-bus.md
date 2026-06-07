---
name: workbench-save-bus
description: The Workbench per-tab dirty/save bus contract that 5 downstream tasks (423,424,425,427,428) plug into
metadata:
  type: project
---

The Workbench shell (task 422, proposal `20260606-workbench-design`) establishes a per-tab save bus that downstream pane tasks depend on. Contract lives in `src/components/workbench/saveBus.ts`.

**Why:** Tasks 423/424/425 (real DATA/SCRIPT/API panes), 427 (⌘S + partial-failure UX), 428 (cross-tab shared-script refresh) all plug into this contract. It must stay stable.

**How to apply:** When building a pane, call `useSaveTarget({ id, order, dirty, save })` inside the tab's `SaveBusProvider`. Concrete orders in use: data pane `id:"data" order:0`, script pane `id:"script" order:10` (data/pointer saves run BEFORE script). The tab derives `aggregateDirty` and exposes `saveAll(): Promise<SaveOutcome[]>` (runs dirty targets ascending by order, catches per-target). Tabs stay MOUNTED, inactive ones hidden via the `hidden` CSS class (display:none) to preserve draft/dirty state — do not unmount tabs.

**GOTCHA — keep `save` ref-stable:** `useSaveTarget`'s effect deps include `save`, so a `save` closure that changes every keystroke re-registers the target every keystroke. Read the live draft from a ref inside `save` and wrap it in `useCallback([])` (empty deps). Then the bus only re-registers when `dirty` toggles. ScriptPane (`src/components/workbench/ScriptPane.tsx`, task 423) is the reference implementation.

Related: [[game-objects-pascalcase-serialization]]
