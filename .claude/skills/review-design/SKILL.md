---
name: review-design
description: Use when the user asks for a review of a proposal or design document. The goal is to leave the document better than you found it — with your feedback written in, questions answered, and new questions surfaced. Example - `Review .frames/sdlc/proposals/draft/20210101-some-topic.md`
---

# Review Design

## Overview

Review a draft proposal from the perspective of your role. The goal is to leave the document better than you found it — with your feedback written into the file, questions answered, and new questions surfaced. A review that stays in conversation and never reaches the document is a review that never happened.

## The Role

As the reviewer, your job is to bring expertise and judgment — not just read the words.

Think about how this must actually be built. What does the proposal assume that isn't stated? What breaks at the edges? What's been left out because the author didn't know to include it, or quietly hoped no one
would ask?

Consider the author's perspective: where they're coming from shapes what they see clearly and what they miss. Use that to find the gaps, not to excuse them.

## Resources

You MUST load these resources along with this skill to gain full context:
- `./.claude/context/proposal-template.md`

## Input

- **proposal_path** (required): The path to the proposal document in `.frames/sdlc/proposals/draft/`

**Constraints for parameter acquisition:**
- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding
- When asking for parameters, You MUST request all parameters in a single prompt
- When asking for parameters, You MUST use the exact parameter names as defined

## Output

A proposal document with feedback, open questions answered, and maybe more open questions asked. The proposal document may from here remain in draft, or move to accepted or rejected if you are the final reviewer.

## Enter

When a proposal document in draft needs to be reviewed.

## Exit (Done)

When the proposal document has been fully read and all relevant questions addressed and feedback has been entered back into the document and the user is happy with the output.

## Steps

### 1. Verify You Are a Reviewer

Read the proposal's frontmatter and confirm your role is listed in the `reviewers` field.

**Constraints:**
- You MUST read the frontmatter before reading the body, because the frontmatter tells you whether this proposal is waiting for your input
  - Read lines 1-8 first
- If your role is NOT listed in `reviewers`, you MUST NOT review this proposal — inform the user that this proposal is not tagged for your role

### 2. Read the Full Proposal

Read the entire proposal body, including any existing Review Log entries from other roles.

**Constraints:**
- You MUST read existing Review Log entries before forming your own response, because other reviewers may have raised points that affect your review
- You MUST focus your review on your role's knowledge domain as defined in FRAME.yml — respond only to aspects that fall within your expertise
- You MUST NOT speak for other roles, because each role reviews independently from their own domain
- You SHOULD actively seek out deferrals and flag them to the user to affirm they are meant to be deferred because an agent may choose on its own to defer something the user wanted to address. No deferrals should exist in the proposal that the user didn't explicitly sign off on

### 3. Discuss with the User

Before writing anything, share your assessment of the proposal with the user. Surface concerns, ask clarifying questions, and reach a position.

**Constraints:**
- You MUST name specific concerns with specific reasoning — "this feels wrong" is not a review
- You MUST distinguish between blocking concerns (things that must change before you can approve) and non-blocking observations (things worth noting but not worth holding up the proposal)
- You SHOULD propose alternatives when you raise concerns, because a concern without an alternative is a dead end
- You MAY ask the user for guidance when the proposal touches the boundary between your domain and another role's domain
- If you need complex input from the user — multi-part decisions, comparisons across more than two options, anything where rich context (a screenshot, a side-by-side, a code snippet) would land better next to the question than approximated in chat — consider using the `ask-user` skill instead of asking in chat. Default to chat; reach for the form when the payload of the question itself justifies it.

### 4. Write Your Review into the Document

Append a Review Log entry to the proposal document. This is the transactional step — if this doesn't happen, the review didn't happen.

**Constraints:**
- You MUST append your review to the end of the proposal using the correct format
- You MUST NOT modify the proposal body itself, because you are a reviewer — changes to the proposal content belong to the author. Your review lives in the Review Log.
- You MUST NOT skip this step, because a review that exists only in conversation is invisible to the next agent in the next session

Format:
```md
---
# Review: <ROLE_NAME>

**Date**: YYYY-MM-DD
**Decision**: Aligned/Not Aligned/Request for Comment

**Comments**

Enumerate your thoughts on the proposal and summarize your decision.
```

### 5. Update the Frontmatter

After writing your review, update the proposal's frontmatter to reflect your review. Two fields are involved — the `reviewers` queue and the `reviewer_decisions` map. They answer different questions and must both be updated in the same write so they never diverge.

**Constraints — `reviewer_decisions` (programmatic decision state):**
- You MUST write `reviewer_decisions[<your-role>] = <decision value>` in the frontmatter, using the exact same string you wrote on the `**Decision**:` line of your Review Log entry. Valid values are `Aligned`, `Not Aligned`, `Request for Comment` — no other values, no synonyms, no lowercase variants. This is the field the API and workbench read; the Review Log section in the body is commentary only.
- If `reviewer_decisions` does not yet exist in the frontmatter (an older proposal that predates this schema), You MUST add it as a new field — an empty map `{}` at minimum plus your own entry.
- If your role already has an entry in `reviewer_decisions` (you are re-reviewing after the author revised), You MUST overwrite it with your new decision. The map holds the current state, not a history.
- You MUST NOT write or modify entries for roles other than your own, because each role's decision is its own to record.

**Constraints — `reviewers` (queue of who still owes a review):**
- If your assessment is **Aligned** and UNLESS you have binding requests: You MUST remove your role from the `reviewers` list, because your review is complete
- If your assessment is **Request for Comment** or **Not Aligned**: You MUST leave your role in the `reviewers` list and add the author to the `reviewers` list, because you need to re-review after changes are made
- You MUST NOT remove other reviewers from the `reviewers` list because you do not know why they are in the list and do not have the discretion to make that decision
- If your review identifies questions or concerns that require input from a role NOT currently in the `reviewers` list, You MUST add that role to the `reviewers` list, because a question directed at a role that isn't listed as a reviewer will never be seen by that role — the routing only works if the frontmatter reflects who needs to respond

**Constraints — lifecycle:**
- If the `reviewers` list is not empty: You MUST leave the file in `proposals/draft/` with `status: draft` — the next reviewer will find it
- You MUST NOT move a proposal to `accepted/` while any role remains in the `reviewers` list, because partial alignment creates ambiguity that surfaces as bugs during implementation
- You MUST NOT move a proposal to `accepted/` if there are any unresolved open questions
- Once there are no more `reviewers`, you SHOULD confirm with the user before moving the proposal to accepted or rejected.

## Examples

### Example: Approving a proposal (one of two reviewers)

**Before frontmatter:**
```yaml
---
name: Core Game Loop
description: Defines the primary gameplay cycle.
date_created: 2021-01-01
author: game-designer
status: draft
reviewers: [architect, engineer]
reviewer_decisions: {}
---
```

**After architect approves (Aligned, no binding requests):**
```yaml
---
name: Core Game Loop
description: Defines the primary gameplay cycle.
date_created: 2021-01-01
author: game-designer
status: draft
reviewers: [engineer]
reviewer_decisions:
  architect: Aligned
---
```
Review Log entry appended. Architect's role removed from `reviewers` (review complete) but recorded in `reviewer_decisions` (their position, preserved). File stays in `.frames/sdlc/proposals/draft/`. Engineer still needs to review — their pending state is derived from being in `reviewers` with no entry in `reviewer_decisions`.

### Example: Last reviewer approves

**Before frontmatter:**
```yaml
---
name: Core Game Loop
description: Defines the primary gameplay cycle.
date_created: 2021-01-01
author: game-designer
status: draft
reviewers: [engineer]
reviewer_decisions:
  architect: Aligned
---
```

**After engineer approves and author re-reviews:**
```yaml
---
name: Core Game Loop
description: Defines the primary gameplay cycle.
date_created: 2021-01-01
author: game-designer
status: accepted
reviewers: []
reviewer_decisions:
  architect: Aligned
  engineer: Aligned
---
```

### Example: Not Aligned or Request for Comment (reviewer stays in queue)

**Before frontmatter:**
```yaml
---
name: Core Game Loop
description: Defines the primary gameplay cycle.
date_created: 2021-01-01
author: game-designer
status: draft
reviewers: [architect, engineer]
reviewer_decisions: {}
---
```

**After architect records Not Aligned:**
```yaml
---
name: Core Game Loop
description: Defines the primary gameplay cycle.
date_created: 2021-01-01
author: game-designer
status: draft
reviewers: [architect, engineer, game-designer]
reviewer_decisions:
  architect: Not Aligned
---
```
Architect stays in `reviewers` (re-review required after author revises). Author added to `reviewers` so they know to respond. Architect's decision recorded in `reviewer_decisions` — both fields stay in sync with the review activity.

## Moving to Accepted

Once all reviewers have reviewed and aligned on the proposal, the proposal is sent back to the original author and together with the user, the file with be moved to accepted.

## Moving to Rejected

Only the user can move a proposal to rejected.

## Troubleshooting

### You disagree with another reviewer's assessment
Your review is independent. State your position in your own Review Log entry. If the disagreement is significant, flag it for the user to resolve — do not argue with the other review in the document.

### The proposal is unclear or missing information
Use assessment `request-changes`. In your Review Log entry, list exactly what's missing and what you need before you can approve. Leave your role in the `reviewers` list.

### You're not sure if something is in your domain
If a concern falls on the boundary between your domain and another role's, raise it in your review and tag it as `flag-for-discussion`. The user or the other role can pick it up.
