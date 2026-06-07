---
name: task-runner
description: Use this skill whenever the user wants you to pick up a specific task from task-man MCP in an interactive session.
---

# Task Runner (interactive)

Use this skill when the user has assigned you a task to do in an
interactive Claude Code session. The user is present and will confirm
acceptance.

## Core steps

The steps every task-runner skill follows. Interactive and headless
variants both reference this file and extend it with mode-specific
affordances.

## Steps

1. **Pick up the task.** Call `mcp__task-man__get_task` with the task ID.
   Read overview, acceptance criteria, related items, and open questions.
2. **Mark as in-progress.** Use `mcp__task-man__update_task` to record
   you've picked it up. Stamp your role in `last_edited_by`.
3. **Do the work.** Implement against the acceptance criteria. Follow
   existing codebase conventions.
4. **Write tests alongside the code.** Every function with branching
   logic gets a unit test. Every new tool/endpoint gets an integration
   test. No "I'll add tests later" — if it's worth writing, it's worth
   testing.
5. **Self-verify.** Run the full test suite. Confirm every acceptance
   criterion on the task holds. If one doesn't, either extend the
   implementation or flag the criterion as wrong before claiming done.

## What counts as "done"

Every entry in the task's `acceptance_criteria` field. Not "most". All
of them. If a criterion is wrong or outdated, say so before marking
complete — don't silently ignore.

## If you hit reality pushing back

If implementation reveals something the task didn't account for, stop
and surface it. Don't improvise at the architecture level. A small
comment on the task, a proposal draft if it's structural, an escalation
to the architect if the plan itself has a hole. See the engineer agent
description for the full "surfacing a design gap" workflow.

## Interactive-specific

After completing the work and confirming all tests pass:

1. **Ask the user to verify on their end.** Give them a concrete
   validation checklist — commands to run, URLs to open, things to
   click. Pause and wait.
2. **Mark the task complete** via `mcp__task-man__complete_task` once
   the user is aligned.
3. **Ask the user if they want to commit.** They confirm scope and
   message before you stage anything.

## Non-goals in interactive mode

- No auto-commit. The user decides.
- No exit before the user has verified and given you completion
  direction.
- You MUST NEVER call a task done or awaiting for review if there are ANY lint, test or build failures because it is your responsibility to create always functional, working code. Leave the campsite better than you found it.
