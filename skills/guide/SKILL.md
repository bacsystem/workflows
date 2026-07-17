---
name: guide
description: Use when starting work with the cys plugin or unsure which cys skill applies — the index of the cys flow (design → plan → run → check → ship) and the rules for moving between stages.
---

# cys:guide

cys is a development methodology with parallel execution at its core.
Five stages, five skills — each stage's output is the next stage's input.

## The flow

| Stage | Skill | In → Out |
|---|---|---|
| 1. Design | `cys:design` | idea → approved spec (`docs/cys/specs/`) |
| 2. Plan | `cys:plan` | spec → parser-ready plan (`docs/cys/plans/`) |
| 3. Run | `cys:run` — the parallel-plan-executor Workflow (`/cys:run-plan`, or `/cys:flow` from an idea) | plan → implemented, reviewed, merged task branches |
| 4. Check | `cys:check` | change → verdicts (spec PASS/FAIL + quality APPROVED/NEEDS_FIXES) |
| 5. Ship | `cys:ship` | working tree → Conventional Commit, SemVer bump, PR |

Stage 3 is what makes cys different: independent plan tasks execute in
PARALLEL via a dependency DAG inferred from each task's Consumes/Produces
block — not one at a time. Stage 4 runs automatically inside stage 3 for
every task (adversarial review, one fix round); invoke it standalone for
ad-hoc reviews. Stage 5's PR merge is always a human gate — agents never
merge PRs.

## Rules

- `/cys:flow <repo> <idea>` runs the whole flow end to end; `/cys:run-plan`
  enters at stage 3 with an existing plan. Prefer them over improvising
  the sequence.
- If a cys skill applies to what you are about to do, invoke it BEFORE
  responding or acting — including before clarifying questions.
- Enter the flow at the stage matching what already exists: no spec →
  design; spec → plan; plan → run; implemented change → check; reviewed
  change → ship.
- Never skip forward: code without an approved spec and plan is how cys
  work does not happen.
- Branch topology: `main` ← `develop` ← `feature/<plan>` (integration
  branch) ← `task-N` (one per plan task). Agents never touch `main` or
  `develop` directly.

## What cys does not do

- No sequential plan execution mode — the executor's DAG already
  serializes what must be serial (shared files, Consumes/Produces
  dependencies) and parallelizes the rest.
- No agent-performed PR merges, ever.
