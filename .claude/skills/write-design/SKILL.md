---
name: write-design
description: Use this skill when writing a proposal or design document.
---

# Write Design

## When to Use This

Use when a large or ambiguous decision needs to be explored, debated, and committed to paper before work can begin. The output is a proposal document that other agents can review and act on.

Do NOT use for small, reversible decisions that can be made inline. Do NOT use if an accepted proposal already answers the question — check `.frames/sdlc/proposals/` first.

---

## Resources

You MUST load these resources along with this skill to gain full context:
- `./.claude/context/proposal-template.md`

## Inputs

- **topic** (required): The design question or area being explored
- **context** (optional): References, prior proposals, or conversation history that inform this decision

If any required inputs are missing, ask for all of them in a single prompt before proceeding.

## Outputs

- A markdown file in `proposals/draft` following these instructions

## Enter

When a large or ambiguous decision is being discussed which needs to be heavily deliberated by multiple agents and/or the user.

## Exit (Done)

When the design has been written to disk and the user is happy with the output.

---

## Steps

### 1. Understand the Question

Before proposing anything, understand what is actually being decided and why it matters.

- You MUST read any referenced context materials before forming a position
- You MUST name the specific decision — not the topic area, but the question with a yes/no or A/B/C answer
- You SHOULD identify which agents will be affected by this decision
- You MUST NOT skip to a proposal — premature formalization kills good ideas and hides tradeoffs
- You MUST NEVER defer an action that needs to happen at some point because when the session dies, the context is lost and users and agents will not have this context and it will be lost
- You MUST explicitly raise deferrals to the user with clear tradeoffs if the decision is deferred

### 2. Explore Tradeoffs

Discuss the question with the user. Surface options, name tradeoffs, consider second-order effects.

- You MUST present at least two viable approaches with named tradeoffs for each
- You SHOULD name the feeling or experience each approach produces for the player
- You MUST flag when the conversation approaches the engagement/manipulation line
- You MAY bring references from other games or systems to ground the discussion
- You MUST NOT make the decision unilaterally — you explore, the user decides
- If you need complex input from the user — multi-part decisions, comparisons across more than two options, anything where rich context (a screenshot, a side-by-side, a code snippet) would land better next to the question than approximated in chat — consider using the `ask-user` skill instead of asking in chat. Default to chat; reach for the form when the payload of the question itself justifies it.

### 3. Frame the Proposal

Once the user has reached a position, frame it as a specific, debatable statement.

- You MUST frame the proposal as a clear statement that someone could disagree with
- You MUST identify which agents need to review and list them as reviewers
- You SHOULD name what this decision locks in and what it leaves open

### 4. Write to Disk

Write the proposal document to `.frames/sdlc/proposals/draft/` using the exact template below.

- You MUST use the frontmatter and body template exactly as specified
- You MUST initialize the frontmatter with `reviewer_decisions: {}` (an empty map). Roles listed in `reviewers` start as pending — pending is the absence of a `reviewer_decisions` entry, not a stored value. The map is maintained by the `review-design` skill as reviewers record decisions.
- You MUST wrap the `name` and `description` values in double quotes (`name: "..."`, `description: "..."`) — every time, even when the current value contains no colon. Both fields are free text and routinely contain colons (e.g., `"The goal is X: ..."`); unquoted YAML reads the second colon as a mapping separator, the frontmatter fails to parse, and the proposals DAL silently drops the file from the list response. The UI then shows nothing and the author has no signal that anything went wrong. Quote always — see the proposal template's "quoting rule" section for the full rationale.
- You MUST NOT leave the proposal in conversation only — if it's not on disk, it doesn't exist
- You MUST confirm with the user that the written proposal accurately captures the decision before exiting
- You MUST match your voice for agents because they are your primary target audience. Use agent-targeted language and structures.

---

## Output

File location: `.frames/sdlc/proposals/draft/YYYYMMDD-{short-kebab-title}.md` following the PROPOSALS template.

---

## Example

**topic:** How should players discover new stock categories?

**Resulting proposal statement:** "Stock categories are unlocked through portfolio milestones, not time gates, because milestone unlocks tie discovery to player agency."

**Reviewers:** architect (implementation complexity), ux-designer (onboarding impact)

---

## Exit

When the proposal is written and confirmed:

1. Update the `reviewers` field with all agents who need to weigh in
2. Do NOT move the proposal out of `draft/` — that is the reviewer's responsibility
3. When the user is ready to move on, commit the proposal file:
   - You MUST stage only the proposal file — use its explicit path with `git add`
   - You MUST verify with `git status` before committing
   - You MUST write a commit message following the project commit format (see `context/COMMITS.md`)

---

## Troubleshooting

### User isn't ready to commit
Stay in Step 2. The exit condition includes "the user is happy with the output" — if they're not ready, you're not done.

### Decision spans multiple domains
List all relevant agents in `reviewers`. The review behavior handles multi-role review.

### Proposal contradicts an existing accepted proposal
Flag the contradiction explicitly in the proposal body under ## Context. Reviewers need to know that accepting this proposal implicitly modifies or overrides a prior decision.

### No clear winner between options
That's fine. The proposal can commit to "we chose A knowing B was viable — here's why." A documented close call is better than a vague consensus.

# Proposals

This file instructs you on how to structure proposal files so that agents can better coordinate with each other to build a successful product. A proposal is a document that describes a problem and a solution and provides a space for multiple agents to work together to align on a solution together. Proposals go through several stages, starting in the `draft` state and moving to the `accepted` or `rejected` state depending on the alignment.

# Writing a proposal

Start with a conversation with the user to understand the full context of the problem and solution at hand. Ask the user questions whenever you are unsure. The proposal MUST capture the full problem statement, solution (the proposal itself), any open questions, in addition to the frontmatter that describes the state of the document. The proposal MUST be prefixed with today's date (YYYYMMDD). Example: `YYYYMMDD-proposal-topic-name.md`. You MUST NOT commit until the user has signed off on the document or changes.
