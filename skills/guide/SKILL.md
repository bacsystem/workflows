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

**Stage 5 overlaps with stage 3 when `openPr: true` was requested.** The
Workflow's own Handoff agent (part of stage 3) already does everything
`cys:ship` would do — classify commits, compute the SemVer bump, write
the PR title/body, push, create the PR — because the sandboxed `Workflow`
script cannot invoke the `Skill` tool itself, so it carries a hand-rolled
copy of the same conventions instead of calling `cys:ship` directly.
Invoke `cys:ship` **only** when stage 3 ran without `openPr: true` (it
just leaves `handoff.md` with suggestions, nothing pushed), or for any
change that never went through `cys:run` at all. Running both after an
`openPr: true` run would just duplicate the PR-creation work.

**On platforms other than Claude Code (Cursor, Gemini CLI), `cys:run`
isn't available** — only stage 3's automated DAG scheduling, adversarial
review, and serialized merging are Claude-Code-only. After `cys:plan`
produces a plan there, execute its tasks yourself in dependency order:
one at a time, or by hand-dispatching the platform's own subagents per
task, without cys:run's orchestration.

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

## Pendientes (`.cys/pending.md`)

An optional, freeform file at `<repo>/.cys/pending.md` for tracking bugs,
gaps, and pending tasks across sessions instead of letting them evaporate
from chat. Three fixed sections, always in this order:

    # Pendientes

    ## Bugs
    - [ ] broken or incorrect behavior

    ## Gaps
    - [ ] scope left out of a design/spec/review, on purpose or by omission

    ## Tareas
    - [ ] anything else pending

Anyone adds a line (`- [ ]`) or checks one off (`- [x]`) by editing the
file directly — no special tooling, and `cys:guide` never creates it. On
invocation, `cys:guide` is the only place that reads it to remind the
user: if the file exists and has unchecked items, list them grouped by
section before presenting the flow table (skip a section with nothing
open). `cys:run`'s Handoff agent and `cys:check` write to it when a
review finding is left unresolved — see `cys:check`.

## What cys does not do

- No sequential plan execution mode — the executor's DAG already
  serializes what must be serial (shared files, Consumes/Produces
  dependencies) and parallelizes the rest.
- No agent-performed PR merges, ever.
