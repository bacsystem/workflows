# parallel-plan-executor

A technology-agnostic Claude Code `Workflow` that executes a `superpowers:writing-plans`
implementation plan, running independent tasks in parallel via a dependency DAG inferred
from each task's `Consumes`/`Produces` block — instead of one task at a time like
`superpowers:subagent-driven-development` does by default.

Design spec: `docs/superpowers/specs/2026-07-04-parallel-plan-executor-design.md`.

## How it works

1. `bin/parse-plan.js` reads a plan file and computes its task list + dependency graph
   (pure Node, fully unit tested — see `tests/`).
2. `workflows/parallel-plan-executor.js` (built from `workflows/parallel-plan-executor.template.js`
   via `npm run build`) takes that graph and runs each task in its own git worktree via
   `agent()`, starting a task the moment its specific dependencies finish rather than
   waiting for a whole batch.
3. Each task gets an adversarial review agent instead of a human checkpoint per task,
   since a `Workflow` can't pause mid-run to ask you anything.
4. Merges happen one at a time, serialized, respecting the dependency order.
5. You get a single report at the end. This workflow does **not** open a PR — hand off
   to the `git-flow` skill (`bacsystem/skills`) once you've reviewed the result and
   decided it's ready to ship.

## Usage

```bash
npm install    # no dependencies, just wires up npm scripts
npm test       # run the unit tests
npm run build  # regenerate workflows/parallel-plan-executor.js after any src/ change

# 1. Compute the task graph for your plan
#    (stdout is pure JSON; ambiguity warnings — e.g. two tasks producing the same
#    symbol — go to stderr and are also included in the JSON's "warnings" field)
node bin/parse-plan.js /path/to/your-plan.md > /tmp/plan-graph.json

# 2. Ask Claude Code to invoke the Workflow tool with:
#    scriptPath: "<this repo>/workflows/parallel-plan-executor.js"
#    args: { tasks: <the "tasks" field of plan-graph.json>,
#            graph: <the "graph" field of plan-graph.json>,
#            planPath: "/path/to/your-plan.md",
#            repoPath: "/path/to/your/project",
#            integrationBranch: "feature/my-plan",  # the branch every task merges into (required)
#            openPr: true,                          # optional: push + open the PR at the end
#            pr: { base: "develop", assignees: ["me"], labels: ["story"],
#                  milestone: "v1.2", closes: 42 } }  # optional PR fields (git-flow contract)
```

## Handoff phase (v0.5.0)

When at least one task merged, a final **handoff agent** prepares the git-flow closing
for you — without executing it. It writes `.superpowers/sdd/handoff.md` in the target
repo with: a suggested Conventional-Commit PR title, a full PR body (Summary / Type of
change / Main changes / Version / Checklist), the proposed SemVer bump derived from the
run's commits (git-flow rules, `0.x` included), the final review verdict, and a post-run
cleanup checklist.

With **`openPr: true`** (explicit consent given at launch) it additionally pushes the
integration branch and **creates** the pull request via `gh` against `pr.base` (default
`develop`), applying the optional `pr` fields — assignees, labels, milestone, and
`Closes #<closes>` in the body. **It never merges the PR**: that gate is human, always.

## Recommended branching topology (validated in pilot 4)

Point `integrationBranch` at an **ephemeral feature branch cut from `develop`** — never
at `develop`/`main` directly:

```
master (release)                 ← never touched by agents
  └── develop (integration)     ← never touched by agents
        └── feature/<plan>      ← integrationBranch: task branches merge here ★
              ├── task-1        ← one isolated worktree per implementer
              └── task-N
```

Why: mainline stays protected by construction (agent-written code never lands on a
shared branch without human review), a failed run costs one `git branch -D`, and the
human gate sits exactly where it belongs — the single `feature/<plan> → develop` PR you
open via `git-flow` after reviewing the finished branch.

**Permissions note**: if you run under Claude Code's auto mode, the permission
classifier requires human authorization for the workflow's merge agents regardless of
the target branch. Either add an allow rule via `/permissions` before the run, or expect
to authorize merges explicitly (naming branches and target) when prompted.

## Safety checks (v0.2)

- **Startup validation**: the workflow validates `args` before launching any agent —
  a cyclic graph or an id present in `graph` but missing from `tasks` fails fast with a
  clear error instead of deadlocking `runDag` silently.
- **Same-file chaining**: tasks touching the same file are serialized as a chain (each
  depends on the *last* task to touch it), so they never run in parallel against each
  other.
- **Duplicate-producer warnings**: two tasks declaring the same `Produces` symbol is
  surfaced as a warning (first producer still wins); it does not abort the run.
- **Skip reasons point at the root cause**: a task skipped through a cascade reports the
  task that originally failed, not the intermediate skipped link.

## Known limitations (v1)

- Only backtick-quoted symbols count in `Consumes`/`Produces` (e.g.
  `` - Produces: the `createWidget()` factory `` produces `createWidget`). Bare prose is
  ignored on purpose: extracting every identifier turned words like "the" or "None" into
  symbols and created spurious dependencies — even false cycles — between unrelated tasks.
  `Consumes: None` is therefore simply an empty list.
- The `Consumes`/`Produces` parser reads one line at a time — a value that wraps onto a
  second line in the plan's prose won't be captured. A missed dependency does **not**
  silently misorder tasks: the task starts without its real dependency in place, so it
  either fails loudly (or self-reports `BLOCKED`) and its transitive dependents are
  skipped, all surfaced in the final report. A retry-later mechanism (re-attempt once more
  of the DAG has closed) was evaluated and deferred — see design spec §7 — so today the
  only mitigation is keeping `Consumes`/`Produces` on one line per entry.
- No speculative re-execution of an abnormally slow task (evaluated and deferred, see
  design spec §7) — right-sizing tasks in the plan itself is the current mitigation.
- `task-<id>` branches of failed or BLOCKED tasks survive the run on purpose: they
  preserve whatever partial state exists for diagnosis. Clean them up afterwards with
  `git branch -D task-<id>` once you no longer need them.
