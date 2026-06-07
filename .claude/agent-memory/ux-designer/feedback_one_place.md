---
name: feedback-one-place
description: Matt values one-place-to-edit-everything over pragmatic surface-splitting
metadata:
  type: feedback
---

When there's a tension between "one place to edit everything" and splitting work across surfaces for implementation convenience, Matt favors **consolidation** — even when it costs engineering effort.

**Why:** On the Workbench design (2026-06-06), the engineer leaned "link-out for creatures" (keep the Creature Editor separate to avoid lifting its dirty/save state). Matt overrode: *"embed creatures too in one place, the other place is really only for balance anyway."* He accepted the harder refactor (lifting `CreatureForm` state into the unified workspace) to keep the edit-everything promise whole.

**How to apply:** When presenting embed-vs-split or consolidate-vs-defer forks, lead with the consolidated option and name its cost honestly rather than steering toward the cheaper split. Reserve standalone surfaces for genuinely distinct *purposes* (e.g. the Creature Editor as a balance/tuning surface), not as a workaround for implementation difficulty.
