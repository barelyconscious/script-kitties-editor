---
name: plan
description: Decompose an accepted design into concrete, assignable work items. The goal is a set of tasks with explicit done-whens that an engineer or other agent can pick up and execute without guessing.
---

# Plan

## Overview

Decompose an accepted design into concrete, assignable work items. The output is a set of tasks written to disk with explicit done-whens, assigned to specific agents. Tasks may be of any type — design, review, plan, or build — whatever the work actually requires. Use this behavior when a large or ambiguous piece of work needs to be broken into discrete items that other agents can pick up without guessing.

## Parameters

- **source** (required): The accepted proposal or conversation that defines what needs to be planned. This may be a path to a file in `.frames/sdlc/proposals/accepted/` or a conversation with the user.
- **scope** (optional): Any constraints on scope — what's in and what's out for this planning pass

**Constraints for parameter acquisition:**
- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding
- When asking for parameters, You MUST request all parameters in a single prompt
- When asking for parameters, You MUST use the exact parameter names as defined

## Output

A list of tasks written to disk and assigned to their respective agents.

## Enter

When a large or ambiguous task or design artifact needs to be broken down into bite-sized work items for other agents to take on.

## Exit (Done)

When the task has been saved to disk and the user is happy with the output.

## Steps

### 1. Understand the Source Material

Read and understand the design that needs to be decomposed.

**Constraints:**
- You MUST read the full source document if one is provided, because planning against a partial understanding produces tasks that miss requirements or contradict the design
- You MUST identify any open questions or ambiguities in the source material before creating tasks, because a task built on an unanswered question will block the person who picks it up
- If the source has open questions that affect planning, You MUST surface them to the user before proceeding, because creating tasks around ambiguity forces the implementer to make design decisions they shouldn't be making
- You MUST read all architecture docs referenced by the work being planned and identify any deferred decisions, because a deferred decision that blocks a downstream task will stall the person who picks it up. A deferred decision MUST be resolved before creating the dependent task, or it MUST become a separate blocking task assigned to the agent that owns the decision.
- You SHOULD check existing architecture docs in `.frames/sdlc/architecture/` for constraints that affect decomposition
- **You MUST NEVER defer without alignment.** When planning out large tasks, you do not own the scoping. You do not decide unilaterally if something belongs in V1 or V2 or shouldn't belong at all. This is your user's decision ALWAYS. If you are unsure whether something is too big to fit in V1 and want to put it in V2, **STOP** and ask the user. You MUST NEVER create an imaginary V2 milestone without the user's express permission because you will end up cutting features that the user intended to ship.

### 2. Go Wide Before Going Deep

Before decomposing into concrete work items, sketch the entire surface area of the work at shallow depth. List every area the design touches without drilling into any one of them. This is a breadth pass — it answers "what work areas exist?" It is NOT the same as step 3, which is a depth pass at the seams between components. Do not collapse the two.

**Constraints:**
- You MUST produce a shallow inventory of every work area the design implies before sizing or assigning any single task, because the first interesting corner is almost never the corner that matters most
- You MUST resist drilling into implementation detail during this step — if you catch yourself writing acceptance criteria, breaking down sub-tasks, or describing data shapes, stop and return to the wide pass
- You SHOULD express the wide pass as a flat bulleted list of work areas, not a hierarchy, because hierarchy implies decisions you haven't made yet
- You MUST NOT skip this step when the design looks small, because small designs are where unseen coupling hides and the wide pass is what catches it

### 3. Map Data Shapes and Component Boundaries

Enumerate the artifacts the design produces and the component boundaries it touches. On non-trivial work, this step is where the design actually becomes real — the other steps are scaffolding around it. Expect it to dominate the planning session, and do not rush it to "finish the plan." Planning against a design without writing its data shapes down is how coupling enters the system by accident — tasks get built, artifacts get created, and nobody notices until two components are depending on each other in a way nobody named.

If this step reveals that the proposal is not structurally ready — missing fields, unnamed coupling, shapes that do not fit together — stop and kick it back to design. Do not paper over a structural gap with tasks. That is the single most important failure mode this step exists to prevent.

**Constraints:**
- You MUST list every artifact the design produces or modifies — proposals, tasks, state machine definitions, knowledge entries, config files, whatever — with concrete field names and types where the design specifies them. If the design does not specify a field or type that the plan requires, that is a gap that MUST be resolved before tasks are created.
- You MUST identify every component boundary the design crosses (SystemOS, PeerHub, Bootstrap) and name which components read or write each artifact
- You MUST name any new coupling this plan introduces between components and state whether that coupling is explicit (named in a contract, tool interface, or schema) or accidental (two components happen to read the same file or share an undocumented convention). Accidental coupling MUST be converted to explicit coupling — either by creating a contract task that defines the interface, or by restructuring the plan to remove the shared dependency.
- If the design does not specify a data shape that the plan requires, You MUST either resolve it with the designer or architect before proceeding, or create a design task for it and mark dependent tasks as blocked on it
- If you discover a structural gap mid-plan, You MUST NOT silently plan around it. You MAY create a blocking design task assigned to the agent that owns the gap (usually the designer) and continue planning the slice of work that does not depend on it, so the independent work can still ship while the gap gets resolved in a second pass.
- You SHOULD capture the output of this step in the plan's `related_items` or task overviews so engineers picking up tasks can see the structural picture, because a task detached from its data shape is a task that will drift during implementation

### 4. Identify Work Items

Break the work into discrete, independent tasks. Each task must be owned by exactly one teammate (agent). If a task would require switching agents to complete, it is two tasks, not one. Not all tasks are implementation. Expect to create design tasks, review tasks, build tasks, and even further planning tasks.

- If a sub-system needs its own design deliberation before anyone can build it, create a design task for the appropriate agent. Implementation tasks that depend on it must block on it.
- If a proposal needs a specialist's review before it can be accepted, create a review task.
- If a large design area needs its own planning pass, create a plan task for the architect. (Sequencing and scope planning is held by the user directly — do not create plan tasks for "product-manager"; surface sequencing questions to the user instead.)
- If the work is well-defined and ready to implement, create a build task for the engineer.

The planner's job is to make the path to implementation clear — not to skip steps that aren't ready yet. If there are tasks beyond the horizon you can't see yet, front it with a task that investigates the unknowns. Do not skip the unknowns because if you do they will be forgotten.

**Sizing by complexity:**

Use the `complexity` field to signal scope. These are not model recommendations — they are scope constraints:

- `haiku` — a tightly scoped change with a clear, narrow target. One function, one component, one file. An engineer can orient, implement, and verify in under an hour. Example: *"Add input validation to the deposit form field — reject non-numeric input, show inline error."*
- `sonnet` — a self-contained feature or system with a defined boundary. Multiple files, a clear interface, testable output. Expect a full session. Example: *"Implement the badge unlock flow — check condition on action, write badge to state, trigger unlock animation."*
- `opus` — a full session (or more) of focused implementation where the design is settled and the work spans multiple coherent surfaces that have to stay consistent with each other. The judgment required is integration judgment, not design judgment. If design judgment is needed, it is not opus — it is an architect task followed by an engineer task. Example: *"Implement the mood engine — scoring function, decay curve, event hook integration, full test coverage."*

If a task feels like `opus` but the architecture isn't settled, that is a missing architect task, not an oversized engineer task.

**Constraints:**
- You MUST make each task independently specifiable — a task that requires another task to be half-done first is not independent, it has a dependency that needs to be explicit
- You MUST assign each task to a specific agent, because unassigned tasks are tasks nobody picks up
- You MUST assign a complexity level to every task — if you are unsure, size down, not up
- You MUST identify dependencies between tasks — which tasks block which other tasks
- You MUST explicitly identify which tasks can run in parallel, because a plan going into a shared queue needs to communicate concurrency, not just ordering. "Not blocked on anything else in this plan" is the signal.
- You SHOULD order tasks so that blocking work comes first in the sequence
- When creating a design task for another agent, You MUST populate the reviewers for that task's resulting proposal (or note who must review), because a design task handed off without reviewers will loop back for an unplanned review cycle
- You MUST NOT create tasks that span more than one agent or one state — split them
- You MUST NOT create tasks that are too large for their complexity level — if an `opus` task still feels too big, it needs an architect pass first
- You MUST NOT create tasks that are too small to be meaningful — a task should represent a complete, verifiable unit of work, not a line item inside a larger change. "Rename a variable" is not a task. "Add validation to the deposit input and write a test for it" is a task.

### 5. Define Done-Whens

Every task needs a specific, testable completion condition.

**Constraints:**
- You MUST write a done-when for every task, because a task without a done-when cannot be verified — it will either stay open forever or get closed arbitrarily
- You MUST make done-whens testable — "works correctly" is not testable, "all tests pass and the API returns the expected response shape" is testable
- You SHOULD include what to test and how, because the person completing the task may not know the best way to verify their own work
- You MUST NOT write done-whens that depend on subjective judgment ("feels good", "looks right"), because those require a design review, not a task completion check. If subjective evaluation is needed, make the review a separate task assigned to the appropriate agent.

### 6. Write the Plan

Write your plan as a JSON array to a temp file, then submit it via the task tool.

**Constraints:**
- You MUST write the plan to `/tmp/plan-{short-name}.json` first — do NOT pipe JSON inline with heredocs
- You MUST submit the plan using the appropriate task-man MCP server tools.
- You MUST include a complexity rollup in your summary to the user (e.g. "3 opus, 5 sonnet, 2 haiku") so sequencing conversations have weight at a glance
- If the user is present in the session, You MUST confirm the breakdown with them before submitting. If no user is present (async work from an accepted proposal), You MUST submit the plan and leave a summary for later review rather than stalling — the job is to keep work moving.

**Plan format:** A JSON array where each element is a task object:
```json
[
  {
    "alias": "A1",
    "assignee": "architect",
    "complexity": "haiku|sonnet|opus",
    "title": "Short descriptive title",
    "requester": "designer",
    "overview": "What needs to be done and why.",
    "related_items": [
      "path/to/file.md",
      "https://website.com"
    ],
    "acceptance_criteria": [
      "Testable condition that must be met"
    ],
    "open_questions": [],
    "blocked_on": []
  },
  {
    "alias": "E1",
    "assignee": "engineer",
    "complexity": "sonnet",
    "title": "Implement the thing",
    "requester": "architect",
    "overview": "Implement per the architecture spec.",
    "related_items": [],
    "acceptance_criteria": ["All tests passing"],
    "open_questions": [],
    "blocked_on": ["A1"]
  }
]
```

**Key fields:**
- `alias` — short identifier for this task within the plan (e.g. "A1", "E3"). Used only for `blocked_on` references within the same plan.
- `requester` — your agent name (eg designer or architect)
- `assignee` — which agent this task is assigned to
- `blocked_on` — array of alias strings referencing other tasks in this plan that must complete first. The tool resolves these to integer IDs automatically.
- `related_items` — array of references (documents, URLs, code) relevant to completing the task
- `acceptance_criteria` — an exhaustive list of items which must be completed before the task can be closed
- `open_questions` — any questions that need to be answered before the task can be completed, but which do not block starting the task

The tool validates that all aliases resolve, assigns real integer IDs, and writes all tasks atomically. If any alias in `blocked_on` doesn't match a task in the plan, the entire batch is rejected.

**Note**: you MUST NOT reference tasks by alias within a task's description, acceptance criteria, or related items because once you submit your plan the aliases are permanently lost. Instead, clearly define acceptance criteria such that each task is isolated.

### 7. Update Proposal Frontmatter

SKIP THIS STEP IF YOU USED plan_epic THROUGH task-man

If the source of this plan was a proposal file, refer back to the proposal document. You MUST update the status field to `planned` to signify that all tasks have been created. This is to prevent duplicating planning work.

If the source was a conversation with the user rather than a proposal file, skip this step — there is no frontmatter to update. 

### 8. Update Architecture (if needed)

If planning reveals the need for architecture specs, create them.

**Constraints:**
- If any task requires an architecture spec that doesn't exist yet, You MUST create it in `architecture/` or create a task for the architect to create it
- You MUST NOT create tasks that reference architecture specs that don't exist, because the engineer will pick up the task, look for the spec, find nothing, and stall
- You MAY defer architecture spec creation to a separate task assigned to the architect, but that task MUST be a dependency of any implementation task that needs the spec

### 9. Commit

Before committing any files, ask the user for permission, then create a commit using the `git-commit` skill.

## Troubleshooting

### Source material has unresolved design questions
Do not plan around the ambiguity. Surface the questions to the user. If the questions are significant, they may need to go through the design behavior first. Planning resumes after the questions are resolved.

### A task is too big but can't be split
If a task is genuinely atomic (splitting it would create two halves that can't function independently), leave it as one task but flag it as large in the description. The person picking it up should know to expect a longer session.

### Dependencies create a long sequential chain
Some chains are unavoidable. But if every task depends on the one before it, ask whether some of them can truly run in parallel. Often what looks like a dependency is actually just a sequencing preference.

### The plan overlaps with existing tasks
When a new proposal refines or replaces work that was already planned, you will find tasks in the queue that cover the same functional scope but describe the wrong shape — a later design decision invalidated them. Do not create parallel replacement tasks and leave the old ones open with a "[SUPERSEDED]" tag. That leaves dead work in the active queue that the engineer has to read past to understand what's real. Instead: mark the old tasks `nofix` (they were never done — they were overtaken by a design change, and completing them would be a lie about what happened), note the supersession in their titles so history reads clean, and create the replacement tasks fresh. The queue should never have two live tasks covering the same scope.
