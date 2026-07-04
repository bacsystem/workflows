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
node bin/parse-plan.js /path/to/your-plan.md > /tmp/plan-graph.json

# 2. Ask Claude Code to invoke the Workflow tool with:
#    scriptPath: "<this repo>/workflows/parallel-plan-executor.js"
#    args: { tasks: <the "tasks" field of plan-graph.json>,
#            graph: <the "graph" field of plan-graph.json>,
#            planPath: "/path/to/your-plan.md",
#            repoPath: "/path/to/your/project" }
```

## Known limitations (v1)

- The `Consumes`/`Produces` parser reads one line at a time — a value that wraps onto a
  second line in the plan's prose won't be captured. A missed dependency fails safe: the
  scheduler's "possibly blocked, retry" path (see design spec §6) catches most cases, but
  isn't a substitute for keeping `Consumes`/`Produces` on one line per entry.
- No speculative re-execution of an abnormally slow task (evaluated and deferred, see
  design spec §7) — right-sizing tasks in the plan itself is the current mitigation.
