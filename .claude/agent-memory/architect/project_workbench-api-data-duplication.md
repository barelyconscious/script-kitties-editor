---
name: workbench-api-data-duplication
description: The Workbench's "one source, two surfaces" API-data claim is contradicted by the predecessor code it proposes to port
metadata:
  type: project
---

The Workbench design leans on a claim that the API **reference** pane and future inline **intellisense** can ride the *same* structured `ApiItem` data ("one source, two surfaces"), to justify modeling the API data carefully now.

Verified 2026-06-06 in predecessor `bcgeditor`: this was never true there. `gameApi.ts` (the reference content, typed `ApiItem` tree) and `services/CompletionProvider.ts` (708 lines, ~189 hardcoded completion items) are **two independently-authored sources** — `CompletionProvider` does not import `gameApi`. So porting both "nearly verbatim" would import the duplication, and the future intellisense goal would NOT be cheap.

To make the dual-use claim real: model ONE `ApiItem` tree as source of truth, and later write the Monaco completion provider as a *projection* of that tree — do not port the separate hardcoded list. Keep the API data **static in the frontend** (authored editor knowledge, not per-install game data; serving from Rust buys nothing and a Monaco provider registers client-side anyway).

**Why:** the proposal can't have both "port verbatim" and "single source" — they contradict.
**How to apply:** if the dual-use justification stays in the proposal, hold the build to a single source + projection, not a verbatim port. Couples with the Monaco-vs-lighter-editor open question. See [[workbench-script-model]].

**Resolved (2026-06-06):** the revised Workbench proposal now commits to building ONE `ApiItem` tree (seeded by *merging* `gameApi.ts` + `CompletionProvider.ts`, not porting verbatim), static in the frontend, with the future Monaco provider as a projection of that tree. Monaco + self-hosted workers is the decided engine (the projection target). The merge of the two hand-authored lists is real authoring work, sized as such. Architect Aligned on re-review. Hold the build to this single-source-then-projection shape.
