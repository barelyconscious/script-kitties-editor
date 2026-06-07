---
name: git-commit
description: Use this skill whenever you are about to commit files to git. Teaches the commit format, when to write a body, and how to stage files without pulling in someone else's work.
---

# Git Commit

## What a commit is

A commit is communication with the future reader — not a log entry. The reader might be you in six weeks trying to remember why a line changed, or a new agent trying to understand a pattern, or a reviewer doing PR review, or a bisect run hunting a regression. All of them are going to read the commit message before they read the diff. If the message is strong, the diff reads itself. If the message is weak, the diff is a mystery.

Treat every commit as a two-part artifact: **a headline** (the subject line) and, when the change warrants it, **a story** (the body). The subject is what the reader remembers. The body is what the reader returns to.

## Gotchas
1. Memory files are gitignored

---

## Anatomy

### The subject line

One line. Always present. Follows this format:

```
<type>(<scope>): <short description>
```

- **`<type>`** — see the types table below. Always present.
- **`<scope>`** — optional. Usually `task #<id>` when a task is driving the work, or `PR #<id>` when the commit is addressing review feedback on a specific PR. Omit when neither applies — `feat: ...` is perfectly valid.
- **`<short description>`** — what the commit does, in the plainest possible language. Present tense, no period at the end, capitalized only if the first word is a proper noun.

Subject lines should be specific. `fix: correct follower decay on scandal resolve` tells the reader something. `fix: bug` tells the reader nothing. When in doubt, make the subject longer and more specific — most subject lines in substantive commits are 50-100 characters, and that's fine.

### The body

Optional, but required in specific cases (see "When to write a body" below). When present, the body comes after the subject line, separated by a blank line.

What goes in a body:
- **The *why*** — what problem this solves, what it was motivated by, what constraint forced the change.
- **Scope notes** — what's included, what's deliberately left out, what was considered and rejected.
- **Technical details that aren't obvious from the code** — edge cases, performance implications, order-of-operations constraints.
- **References** — tasks, PRs, proposals, or discussions that provide additional context.
- **Breaking change warnings** — anything that will affect how downstream code has to be written.

What does NOT go in a body:
- **Restating the diff in prose.** The reader can read the diff. The body adds the *why*, not the *what*.
- **Effort narrative.** "This was harder than expected," "spent a lot of time on X." Nobody cares how hard it was.
- **Marketing language.** "Elegant solution," "significantly improves," "massively simplifies." Cut every adjective that could be on a product page.
- **Apology.** "Sorry for the large diff," "couldn't figure out a cleaner way." If the commit is what it is, ship it and move on.

Bodies can be prose or bullets. Use whichever better fits the change. Prose works for interconnected reasoning. Bullets work when you're naming several distinct things in one commit.

### The co-authored-by trailer

**When an agent authored the commit, a co-author trailer is required.** This is a project-wide policy grounded in the principle that public artifacts created by an AI must be clearly attributed (it's dishonest to the reader and it undermines the public thesis to hide it).

The trailer comes at the very end of the commit message, separated from the body (or subject) by a blank line:

```
Co-authored-by: Claude <noreply@anthropic.com>
```

---

## Types

| Type | When to use |
|------|-------------|
| `feat` | New functionality — a tool, a behavior, a capability that didn't exist before. |
| `fix` | Corrects something broken — a bug, a regression, a misalignment with the design. |
| `chore` | Tooling, config, dependency updates, skill file edits, agent definition tweaks — no behavior change to the system. |
| `design` | A proposal or design doc written or updated. Use for anything that lands in `proposals/` or `design/`. |
| `arch` | An architecture spec written or updated. |
| `test` | Tests added or updated with no other change. If the commit has new tests *alongside* new code, use the type for the code (usually `feat` or `fix`) — the tests come along. |
| `refactor` | Code restructured without behavior change. The old tests should still pass unchanged — if they don't, it's not a refactor. |

---

## When to write a body

Body **required** when any of these is true:

- The commit introduces new functionality or changes behavior in a way the diff alone doesn't explain.
- The commit touches multiple files whose relationship needs naming.
- The commit is a fix where the root cause isn't obvious from the change.
- The commit modifies shared infrastructure that other work depends on.
- The commit is a `refactor` that renames or moves something; the body should name what was included and what was deliberately left out.
- The commit has a breaking change or migration step.

Body **optional** when:

- The diff is self-explanatory (a one-line bug fix, a typo, a formatting change).
- The change is trivial (version bump, lint fix, dependency update).
- The commit is part of a series and the context already exists in a sibling commit's body.

Body **not needed** for:

- Asset additions where the filename is the description (`chore: add logo.svg`).
- Mechanical updates that aren't interesting (`chore: update lockfile`).
- Extremely small fixes with obvious intent (`fix: typo in README`).

When in doubt, write the body. A commit with a body nobody needed is cheap. A commit without a body that somebody needed is expensive six months later.

---

## How to commit

For **subject-only** commits (no body), use a single `-m`:

```bash
git commit -m "fix: correct scope-lock check for milestone tag migration" \
  -m "Co-authored-by: Claude <noreply@anthropic.com>"
```

For **commits with a body**, use multiple `-m` flags. Each `-m` becomes its own paragraph, separated by a blank line. This is how you get a subject + body + trailer in a single shell command:

```bash
git commit \
  -m "feat(task #42): add scope-lock enforcement to task queue" \
  -m "Adds milestone tag validation on task creation and edit. Tasks attempting to land in a locked milestone are rejected with a clear error pointing at the PM's escalation path. Does not touch existing tasks — only new writes enforce the lock." \
  -m "Co-authored-by: Claude <noreply@anthropic.com>"
```

For **longer bodies** with multiple paragraphs or bullet lists, you can use multiple `-m` flags (one per paragraph) OR a heredoc when the body is genuinely multi-paragraph and multi-`-m` gets awkward:

```bash
git commit -F- <<'EOF'
refactor: rename friction-report fields to match proposal schema

Aligns field names in .frames/sdlc/friction/*.md with the names already used
in proposals/draft/*.md, so downstream tools can parse both with the same
schema.

Changed:
- `from` → `author`
- `severity` → `priority`
- `root cause guess` → `hypothesis`

Existing friction reports have NOT been migrated — they'll still parse under
the old schema because the parser accepts both. A follow-up `chore` commit
will migrate them once the new schema has been validated in practice.

Co-authored-by: Claude <noreply@anthropic.com>
EOF
```

The multi-`-m` pattern is preferred for its cleanliness in shell history. Heredoc is fine when the body is long enough that multiple `-m` flags become hard to read. Use whichever fits the commit.

---

## What to stage

You MUST stage only the files you personally modified during this session. Nothing else. This is non-negotiable.

```bash
# Right — explicit file paths only
git add .claude/agents/engineer.md .claude/skills/pr-creator/SKILL.md

# Wrong — stages everything, including files you didn't touch
git add -A
git add .
```

Before committing, run `git status` and review every staged file. If a file appears that you did not intentionally modify, do NOT include it. Unstage it with `git restore --staged <file>` and leave it for whoever owns that change.

When in doubt: pause and ask the user what to do.

**Note**: the user wishes that you do NOT rely on stashing just to avoid committing extra changes. Before stashing, you MUST raise this to the user and ask for guidance.

---

## Examples

### Subject-only commits (no body needed)

```
fix: correct typo in designer.md principle #4
```

```
chore: update task-man MCP to v0.3.1
```

```
design(task #12): add proposal for peer-hub contention escalation
```

```
test: add unit tests for friction-report parser
```

### Commits with substantive bodies

```
feat: add scope-lock enforcement to task queue

Adds milestone tag validation on task creation and edit. Tasks attempting to
land in a locked milestone are rejected with an error pointing at the PM's
escalation path. Existing tasks are not touched — only new writes enforce the
lock, so the rollout is safe against in-flight work.

Co-authored-by: Claude <noreply@anthropic.com>
```

```
fix(PR #17): address review comments — trailer format, stage check, missing test

Four things from @matt's review:
- Use `Co-authored-by:` (capital C) not `co-authored-by:` — GitHub's
  parser is case-sensitive for the first letter of the trailer key.
- Add a staged-files sanity check before committing; surfaces if any
  `.no-ai/` files sneak in from a prior unclean session.
- The test for the heredoc path was missing a newline in the fixture,
  making the parser think the body was empty. Fixed the fixture and
  added a regression test for the empty-body case.
- Remove the stale comment in commit.sh that referenced the old one-line
  policy.

Co-authored-by: Claude <noreply@anthropic.com>
```

```
refactor: extract friction-report parser into its own module

Pulls the friction-report parsing logic out of board.sh's inline sed
handling and into parse_friction.py. The parser now handles both the
YAML frontmatter and the body sections, returning a structured object
the board tool can render directly.

No behavior change. All existing friction reports still parse identically.
The old inline handling has been deleted — there is no compatibility shim.

Co-authored-by: Claude <noreply@anthropic.com>
```

```
arch(task #8): specify contention detection model for PeerHub topics

Writes the first cut of the contention-detection spec. Documents how
PeerHub identifies when two specialists hold conflicting answers on the
same topic, and defines the escalation signal that raises the contention
to the human.

Open questions captured inline:
- What's the authority threshold for "conflicting" vs. "complementary"?
- Does a contention escalation block downstream work, or run in parallel?

These are called out in the spec as TODO sections. The designer and I
will resolve them in next week's proposal review.

Co-authored-by: Claude <noreply@anthropic.com>
```
