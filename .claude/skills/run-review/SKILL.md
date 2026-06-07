---
name: run-review
description: Use to run the review process.
disable-model-invocation: true
user-invocable: true
---

# Run Review

The purpose of this skill is to take a draft proposal and have each reviewer review the proposal document and leave feedback. The review is run until all reviewers have aligned on the proposal.

## Required Input

**proposal-slug**: the name of the proposal to run a review for; eg: `20260101-implement-review-process` would correspond to the file: `.frames/sdlc/proposals/draft/20260101-implement-review-process.md`.

## Output

A version of the proposal that has the confidence across all reviewers that the user will be happy and accept it.

# Execution

Follow these steps to run the review

## Step 0. Verify Authorship

You MUST ensure that you are the author of this proposal by validating your agent name against the `author` field in the proposal frontmatter, guaranteed to be on line 5. If you are not the author, then you MUST stop here and gently suggest the author switch to that agent instead.

## Step 1. Spawn Subagents

Identify the subagents by looking at the `reviewers` list in the proposal frontmatter, guaranteed to be on line 7. If there are 0 reviewers, then you MUST stop here and inform the user to seek their guidance because the review process cannot occur without reviewers. Your goal is to seek alignment across all reviewers. This also correlates to an empty `reviewers` list.

The review process is broken down into **rounds**. In a round, each reviewer gets a chance to review the proposal document and leave feedback. You MUST spawn subagents in sequence based on the following priority:
1. dx-designer
2. architect
3. engineer
4. {ANYONE_ELSE}

Subagents will respond with Aligned or Request for Comment. Any other response is a failure and you MUST stop here and inform the user.

## Step 2. Review the Review

Once all subagents have reviewed the proposal and left their comments, you should re-read the proposal in full and summarize the changes to the user so that the user understands what changes are being proposed by the reviewers without the user needing to re-read the proposal themselves. Wait here for the user to tell you to continue.

## Step 3. Revise

Once the user agrees, revise the document based on the comments and the follow-up conversation with the user. This involves writing in-place any changes so that the entire document stays internally consistent.

## Step 4. Run the Review Again

Check if there are any more reviewers in the `reviewers` list in the proposal frontmatter, guaranteed to be on line 7. If there are 0 reviewers, then your work is done and you should ask the user if they are ready to accept the proposal and move on to step 5. Otherwise, spawn another round of the review.

### Step 4.1. Stopping Early

If after the second round there are still reviewers, you should stop here and let the user know this will take longer and consume more tokens.

## Step 5. Results

Once all reviewers and the user are aligned, move the proposal to the `accepted` folder and commit the proposal.
