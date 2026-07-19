# Engine Limits — Design Spec

**Goal:** close three real gaps in `runDag`/`buildGraphWithDiagnostics` — no
concurrency ceiling, no warning for a consumed-but-never-produced symbol,
and a recursive (stack-bounded) cycle check — without changing default
behavior for any existing plan.

**Context:** this spec consolidates items A1–A3 from an external review
prompt (dated 2026-07-19, written after a full read of `src/`, `bin/`,
the template, all 15 test files, and every spec/plan in `docs/cys/`).
Each item's code and reasoning was independently verified against the
current `src/scheduler.js` and `src/graph-builder.js` before this spec
was written — the diffs below match the real files, not a stale reading.
Decisions on scope were already made in conversation with the user; this
spec records them, it doesn't re-open them.

## A1 — Optional concurrency limit in `runDag`

`runDag` fires every ready task in a DAG layer at once
(`Promise.allSettled(allIds.map(run))`, `src/scheduler.js`). No pilot run
to date has exceeded ~5 tasks, so this isn't fixing an observed crash —
the Claude Code `Workflow` tool already caps concurrent `agent()` calls
at `min(16, cores-2)` and queues the rest, and each `runDag` task body
runs *inside* one `agent()` call, so that platform cap already bounds
the expensive part today. What A1 adds is a **user-facing knob**: an
explicit, documented `maxConcurrency` a user can set lower than the
platform default (e.g. to avoid 16 simultaneous local git worktrees on
their own machine), rather than relying on an undocumented default they
have no way to discover from cys's own docs.

Default is `Infinity` — identical behavior to today, all 136 existing
tests pass unchanged.

**Validation plan (explicit, not deferred):** the user will run a real
pilot with 20+ mutually-independent tasks once this ships, to see
whether the platform's own cap was already sufficient or whether
`maxConcurrency` earns its keep in practice. Log the outcome in
`.cys/pending.md` either way.

### Semaphore placement

The gate goes **after** dependency resolution, around `taskFn` only —
never around `await deps`. Gating the dependency wait would let a task
occupy a concurrency slot while blocked on its own dependencies, which
can starve those same dependencies of a slot — deadlock.

## A2 — Warn when a consumed symbol has no producer

`buildGraphWithDiagnostics` (`src/graph-builder.js`) already warns on a
duplicate producer (two tasks claiming the same `Produces` symbol) and
the parser already warns on an empty `Consumes`/`Produces` value — but a
`Consumes` symbol nobody ever `Produces` today creates no dependency and
raises no warning (`producedBy.get(symbol)` is `undefined`, silently
skipped). This is the same family as the empty-value bug already fixed
this session: a silently-lost dependency, not a hard error. The fix
mirrors the existing duplicate-producer warning's shape and stays a
warning, not a `throw` — a symbol already present in the target repo
before the plan started is a legitimate producer-less consume,
indistinguishable from a typo by the parser alone.

## A3 — Iterative `assertAcyclic`

The current DFS (`src/graph-builder.js`) recurses one stack frame per
edge in the dependency **chain** being walked (not per task in a
layer — width doesn't add stack depth, only chain depth does). Real
plans run 5–40 tasks total, nowhere near a depth that would matter.

**Empirically checked before implementing** (not assumed): the
recursive version does not overflow the stack even at 8 million chained
tasks in this environment — this V8 build handles this particular
recursive shape far past any naive stack-depth estimate. So this item
has no reproducible failure behind it at all, at any scale a real plan
could plausibly reach. It's included anyway on the user's explicit call
("es bueno tener en cuenta las sugerencias, validamos contra el código")
as defense-in-depth for a platform with a smaller stack (a constrained
container, a different OS/Node build) — cheap to build, behavior-
identical to the recursive version, verified by reusing the exact same
cycle-detection tests. The corresponding test in the plan is framed as
a regression/behavior-equivalence guard, not a red-bar stack-overflow
reproduction — being honest about that distinction in the test's own
name and the commit message.

## Testing

- `tests/scheduler.test.js`: concurrency cap observed with 6 independent
  tasks (`maxConcurrency: 2` → peak concurrency == 2); `maxConcurrency: 1`
  over a `1→2→3` chain preserves topological order; no `options` →
  default `Infinity`, identical to today; a diamond (`1,2` base, `3`
  depends on both) with `maxConcurrency: 2` completes without deadlock.
- `tests/graph-builder.test.js`: warns when a task consumes a symbol no
  task produces; does not warn when the symbol has a real producer;
  `assertAcyclic` still detects a cycle and still accepts a valid DAG
  after the iterative rewrite (existing tests reused, behavior
  unchanged) plus one new test with a long linear chain to prove no
  stack error at a depth well past anything a real plan would produce.
- `tests/build-workflow.test.js`: template wires `args.maxConcurrency`
  into the `runDag` call.
- `src/validate-args.js` gets a new assertion (`maxConcurrency` is
  `undefined`, `Infinity`, or a positive integer) with its own test in
  `tests/validate-args.test.js` (or wherever that module's tests live —
  confirmed at plan time).

## Out of scope

- Anything from the same review prompt outside A1–A3 (B1–B3, C1–C2) —
  tracked as separate specs/branches.
- Retry-later for missed parser dependencies, speculative re-execution —
  already evaluated and deferred in the original design spec; untouched
  here.
