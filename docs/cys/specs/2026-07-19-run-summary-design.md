# Run Summary Stats — Design Spec

**Goal:** make cys:run's actual differentiator — real inferred
parallelism — visible in its own final summary, using data the workflow
already computes, without fabricating a precise "speedup" number. Item
B2 from the same external review prompt (2026-07-19) as the three merged
branches (`feat/engine-limits`, `docs/onboarding`, `chore/contributing`).
Sequenced after all three, since this also touches
`workflows-src/parallel-plan-executor.template.js`.

## Design

### `computeParallelWidth(graph)` — new pure function in `src/graph-builder.js`

The plan's *inferred* parallel width (not the runtime's actual peak
concurrency, which `maxConcurrency` from `feat/engine-limits` can now
cap below the DAG's natural width — the two numbers can legitimately
differ, and the summary should not conflate them). Computed by layering
each task at `1 + max(layer of its dependencies)` (0 for a task with no
dependencies), then taking the largest layer's size — the same notion
already used informally when describing this repo's own pilots ("Tasks
2 and 3 ran in parallel").

### Duration aggregates — inline in the template, reusing existing helpers

For `done` tasks only (the only ones with real `startedAt`/`finishedAt`):

- **Sequential-equivalent work**: sum of each task's own duration
  (`hhmmssToSeconds(finishedAt) - hhmmssToSeconds(startedAt)`, same
  midnight-wrap handling `formatDuration` already has).
- **Wall-clock window**: from the earliest `startedAt` to the latest
  `finishedAt` across done tasks — the closest available proxy for the
  run's actual wall-clock span, given the sandbox has no
  `Date.now()`/run-level timestamp and every time value comes from an
  agent's own `date +%H:%M:%S` report.

No computed "Nx speedup" — the text presents both numbers side by side
and lets them speak, per the review prompt's own explicit warning
against fabricating false precision from agent-reported (not
monotonic-clock) timestamps.

### Summary block

Appended to the existing `summaryLines` block in the template, right
before `log(summaryLines.join('\n'))`: total tasks, done/failed/skipped
counts, the plan's inferred parallel width, and the two duration
aggregates (skipped entirely if zero done tasks — nothing meaningful to
report).

## Testing

- `tests/graph-builder.test.js`: `computeParallelWidth` against known
  graphs — 3 independent tasks → 3; a linear chain → 1; a diamond (2
  base tasks, 1 dependent) → 2; an empty graph → 0.
- `tests/build-workflow.test.js`: the template calls
  `computeParallelWidth(graph)` and includes it in the summary; the
  duration-aggregate lines are present and guarded by "at least one done
  task."

## Out of scope

- Any runtime peak-concurrency tracking (the *actual* number of tasks
  that ran simultaneously, as opposed to the DAG's inferred width) — not
  requested by the review prompt, and would need new bookkeeping in
  `runDag` itself; a separate future item if real data ever motivates it.
- A numeric "speedup" figure — deliberately excluded, see above.
