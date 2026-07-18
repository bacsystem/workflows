# Fase 4b — Structured State and Cross-Session Recovery

**Date:** 2026-07-17
**Status:** Approved

## 1. Goal

Give the engine a structured, machine-readable record of an in-progress run
(`.cys/state.json`), so that if a run gets cut short by something external
to the plan itself (a Claude Code session limit, a crash, a closed
terminal) — as opposed to reaching its own natural end — a **later
session** (not just the same session's `resumeFromRunId` cache, which is
same-session-only) can detect the leftover state and offer to continue
only what's pending, instead of the user having to notice, investigate,
and hand-build a reduced plan/graph themselves (as was done manually
during the cys independence-proof smoke test).

**Explicitly out of scope for Fase 4b**: automatically triggering that
retry without the user asking (that needs `ScheduleWakeup`, which only
the orchestrating Claude Code session has access to — not the sandboxed
`Workflow` script). This spec only builds the detection + manual-resume
infrastructure; automatic scheduling is a separate Fase 4c, built on top
of what this ships.

## 2. `.cys/state.json` — schema and lifecycle

### Schema

```json
{
  "planPath": "docs/cys/plans/2026-07-17-example.md",
  "repoPath": "D:/github/example-repo",
  "integrationBranch": "feature/example",
  "updatedAt": "14:32:07",
  "tasks": {
    "1": { "status": "done", "branch": "task-1", "headSha": "abc1234" },
    "2": { "status": "failed", "branch": "task-2", "reason": "merge CONFLICT: ..." },
    "3": { "status": "skipped", "reason": "blocked by a failed dependency (task 2)", "rootCauseId": 2 }
  }
}
```

`status` is one of `pending` (never started), `done`, `failed`, `skipped` —
the same vocabulary `runDag`/`settle()` already use internally.

### Lifecycle

1. **Written once at the very start** of the run (right after
   `validateWorkflowArgs` passes, before any agent launches): every task
   listed as `pending`. This means even a run that dies before its first
   task ever finishes still leaves evidence an attempt happened, rather
   than looking like nothing was ever tried.
2. **Rewritten after every `settle()`** (the same point that already
   appends to the ledger and updates the progress bar) — same mechanism as
   `appendLedger`: the script computes the full JSON content itself (it
   already holds `results`, `tasksById`, `graph` in scope) and dispatches
   an agent to write that exact content to `.cys/state.json`, since the
   sandboxed script has no filesystem access of its own.
3. **Deleted at the very end of the script**, right before the final
   `return` — regardless of whether some tasks ended `failed` or
   `skipped`. Reaching that final line means the script itself ran to
   natural completion; a "real" failure the user already sees in the
   final report is not the same thing as an *interrupted* run. Presence
   of `.cys/state.json` therefore means specifically "the script itself
   got cut off before finishing," not "something failed."

## 3. `bin/plan-remainder.js` — computing what's left

A new pure-Node CLI, same philosophy as `bin/parse-plan.js`
(deterministic, unit-tested, no agent judgment needed):

```
node bin/plan-remainder.js <planPath> <stateJsonPath>
```

- Parses the plan (reuses `src/plan-parser.js` + `src/graph-builder.js`,
  same as `parse-plan.js`).
- Reads `state.json`, drops every task whose status is `done` from both
  the task list and the graph (their outputs already exist, merged into
  `integrationBranch` — nothing to redo), and drops now-satisfied
  dependencies from the remaining tasks' dependency lists (a task that
  only depended on an already-`done` task becomes dependency-free).
- Prints `{ tasks, graph, warnings }` — the exact same shape
  `parse-plan.js` already prints, so it's a drop-in replacement for the
  "parse the plan" step when resuming, not a new consumption contract for
  the commands to learn.
- Throws a clear error if `state.json`'s `planPath` doesn't match the
  `planPath` argument passed in (a caller bug — commands must always
  confirm the match themselves *before* invoking this, per §4; this is a
  safety net, not the primary check).

## 4. Command integration (`commands/flow.md`, `commands/run-plan.md`)

Add a check right after `repo-path` is known (before design/plan in
`flow.md`; right after argument parsing in `run-plan.md`):

- If `<repo-path>/.cys/state.json` does not exist: proceed as today,
  nothing changes.
- If it exists, read it and compare its `planPath` to the plan this
  invocation is about to use (for `flow.md`, this check has to happen
  *after* `cys:plan` produces a plan path, since `flow.md` doesn't know
  the plan path upfront — see note below):
  - **Same `planPath`**: tell the user which tasks are already
    `done`/`failed`/`skipped`, and offer to continue with only what's
    pending via `bin/plan-remainder.js` instead of the full plan. If they
    agree, use its output in place of `bin/parse-plan.js`'s. If they
    decline, ask whether to discard the old state (delete
    `.cys/state.json` — it'll be rewritten fresh) or stop.
  - **Different `planPath`**: warn that there's incomplete state from a
    different, unrelated run and ask the user how to proceed (look at it
    first / discard it and continue / stop) — never decide silently.

**Note on `flow.md` ordering**: since `flow.md` starts from an idea, not
an existing plan, the leftover-state check can only meaningfully compare
`planPath` once `cys:plan` has produced one — so in `flow.md` specifically,
do the *existence* check early (to warn the user something is there before
they invest time in design/plan again for what might be the same feature),
but do the actual `planPath` comparison and remainder-offer right before
the launch step, same position as `run-plan.md`.

## 5. Testing / verification

- `bin/plan-remainder.js`: unit tests in `tests/`, `node --test` — mirrors
  `bin/parse-plan.js`'s existing test style (a plan fixture + a
  hand-built `state.json` fixture, asserting the reduced `{tasks, graph}`
  matches expectations, including the "drop now-satisfied dependencies"
  behavior and the `planPath` mismatch error).
- `tests/build-workflow.test.js`: new assertions that the built workflow
  writes `.cys/state.json` at start, after every settle, and deletes it
  before the final return.
- Commands (`.md`, no automated test surface): verified manually, same
  as the Fase 4a branch-creation fix — by deliberately interrupting a run
  (e.g. killing the workflow mid-task) and confirming a fresh command
  invocation against the same repo/plan detects and offers the reduced
  resume.

## 6. Out of scope

- Automatic `ScheduleWakeup`-driven retry without the user asking (Fase
  4c).
- Detecting *why* a run was interrupted (session limit vs. crash vs.
  closed terminal) — `.cys/state.json`'s mere presence is the signal;
  distinguishing causes is not needed for manual resume to work.
- Retry-later for missed dependencies and speculative re-execution of
  slow tasks (original design spec §7, still separately deferred).
