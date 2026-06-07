---
name: reference-bcgeditor
description: The predecessor Electron editor — blueprint for the Workbench and source of the Lua API reference
metadata:
  type: reference
---

`bcgeditor` is the **predecessor editor** for the same game, at `/Users/matt/Documents/GitHub/worlds-cpp/editor/bcgeditor` (separate repo from script-kitties-editor). Electron + React + MUI + Monaco. It already implemented most of what the new Workbench wants — treat it as a blueprint, not a spec to copy verbatim (the new app is Tauri + Tailwind + shadcn, not Electron + MUI).

Key files (under `bcgeditor/src/`):
- `workbench/GameObjectView.tsx` — the left object list / sidebar.
- `workbench/ScriptEditor.tsx` — Monaco-based Lua editor; loads `selectedObject.script`, save + "Open in VS Code", read-only when no script.
- `workbench/apiViewer/gameApi.ts` — **the API reference data** (`GameAPI: ApiItem[]`). `GameDocumentationViewer.tsx` renders it as a searchable, drill-in panel.
- `services/CompletionProvider.ts` — **the intellisense source**: Lua keywords, stdlib, per-entity `self.*` completions, and game API (GetBag/GetParty/combat/battle/CombatAction/DamageType/ArenaEffects…). Singleton, Monaco CompletionItemKind.
- `services/ScriptValidator.ts`, `services/ScriptTestingFramework.ts` — validation + test-run panels (advanced; likely later phases).
- `components/scripteditors/` — ScriptToolbar, ScriptTabs, ErrorPanel, TestResultPanel, MonacoEditor.

**Note — script storage differs between the two apps.** In bcgeditor, `object.script` is a **path** to a `.lua` file (file-based, opened via a service). In script-kitties-editor the Serde model holds `script: String` inline (creatures call it `aiController`; charms have none; items/dlc are `Option`). Confirm whether the new app's `script` is inline Lua source or a path reference before designing the load/save model — it changes the dirty/save UX.

**How to apply:** When designing or building the Workbench, mine bcgeditor for the API content, completion data, and interaction patterns. Port the *content* (gameApi.ts, CompletionProvider) nearly as-is; re-skin the *UI* to shadcn/Tailwind.
