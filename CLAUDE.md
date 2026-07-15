# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                            # run all unit tests (node --test)
node --test tests/scheduler.test.js # run a single test file
npm run build                       # regenerate workflows/parallel-plan-executor.js
```

Requires Node >= 20. ESM (`"type": "module"`), zero runtime dependencies.

## What this repo is

A Claude Code `Workflow` script that executes a `superpowers:writing-plans` implementation plan, running independent tasks in parallel instead of one at a time. The dependency DAG between tasks is inferred from each task's `Consumes`/`Produces` block and from files touched in common.

## Architecture

The project is split in two halves because the Workflow sandbox has no filesystem access and forbids `Date.now()`/`new Date()`:

1. **Local, pure-Node preparation** (`src/`, `bin/parse-plan.js`) — runs outside the Workflow, fully unit-tested:
   - `src/plan-parser.js` parses `### Task N:` blocks out of a plan file (normalizes CRLF first; only backtick-quoted symbols count in `Consumes`/`Produces`, matched one line at a time — a value wrapping to a second line is a known limitation, see README; duplicate task ids are rejected).
   - `src/graph-builder.js` infers dependencies (Produces→Consumes symbol matching, plus tasks touching the same file are chained — each depends on the *last* previous toucher) and rejects cycles.
   - `bin/parse-plan.js` ties both together and prints `{ tasks, graph }` as JSON, which the user passes as the Workflow's `args` along with `planPath`, `repoPath` and `integrationBranch` (the branch every task merges into — required, so merge agents never guess).

2. **Workflow execution** (`workflows/`):
   - `workflows/parallel-plan-executor.js` is **generated** — never edit it by hand. It is built by `scripts/build-workflow.js`, which inlines `src/scheduler.js`, `src/graph-builder.js` + `src/validate-args.js`, and `src/time.js` into `workflows/parallel-plan-executor.template.js` at the `/* __SCHEDULER_SOURCE__ */`, `/* __VALIDATION_SOURCE__ */` and `/* __TIME_SOURCE__ */` placeholders. After changing any of those inlined modules or the template, run `npm run build` and commit both the source and the regenerated file.
   - Per task: implement in an isolated git worktree (branch `task-<id>`) → adversarial review (spec PASS/FAIL + quality APPROVED/NEEDS_FIXES) → at most one fix round → serialized merge (one at a time, DAG order). A failed task (including merge CONFLICT, BLOCKED, NEEDS_CONTEXT) cascades SKIP to all transitive dependents.
   - Wall-clock times come from the agents themselves (they run `date`); the script only does string math on `HH:MM:SS` values.

Design spec: `docs/superpowers/specs/2026-07-04-parallel-plan-executor-design.md` (§7 documents evaluated-and-deferred features — retry-later for missed dependencies, speculative re-execution). Flow diagram: `docs/diagram/flujo-parallel-plan-executor.mmd`.

## Branches

Work happens on feature/fix branches off `develop`; PRs target `develop`, and `master` is the release branch.
