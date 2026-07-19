---
name: plan
description: Use when an approved design spec exists and you need the implementation plan — numbered tasks with Files and Consumes/Produces blocks that the parallel-plan-executor can parse into a dependency DAG. Comes after cys:design, before cys:run.
---

# cys:plan

Write an implementation plan a zero-context engineer could execute:
bite-sized tasks, exact paths, complete code, TDD, frequent commits.
The plan doubles as machine input — the parallel-plan-executor parses
its task blocks into a dependency graph, so format discipline is load-
bearing, not cosmetic.

**Announce at start:** "Using cys:plan to write the implementation plan."

**Save plans to:** `docs/cys/plans/YYYY-MM-DD-<feature-name>.md`
(user preferences for location override this default).

## Plan header

Every plan MUST start with:

    # [Feature Name] Implementation Plan

    > **For agentic workers:** execute this plan with the
    > parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
    > Steps use checkbox (`- [ ]`) syntax for tracking.

    **Goal:** [one sentence]

    **Architecture:** [2-3 sentences]

    **Tech Stack:** [key technologies]

    ## Global Constraints

    [Project-wide requirements, one line each, exact values copied
    verbatim from the spec. Every task implicitly includes this section.]

    ---

## Task format — the parser contract

    ### Task N: [Component Name]

    **Files:**
    - Create: `exact/path/to/file.js`
    - Modify: `exact/path/to/existing.js`
    - Test: `tests/exact/path/to/test.js`

    **Interfaces:**
    - Consumes: [backticked symbols from earlier tasks — exact signatures]
    - Produces: [backticked symbols later tasks rely on]

Hard rules (the executor's parser depends on them):

- Task headers are exactly `### Task N: Title` — sequential integer ids,
  never duplicated.
- Only **backticked** symbols count in Consumes/Produces; loose prose is
  ignored by the parser. Backtick every real interface (`createWidget()`,
  `src/db.js`); never backtick filler words.
- **One entry per line** in Consumes/Produces — a value wrapping onto a
  second line is silently lost by the parser.
- `Consumes: None` means an empty list; write it when a task is
  independent.
- Two tasks touching the same file are automatically serialized by the
  executor; design task boundaries so files are disjoint whenever
  possible — disjoint tasks run in parallel.

## Steps within a task

Each step is one 2-5 minute action, with complete content — never
"add error handling" or "similar to Task N":

1. Write the failing test (show the full test code).
2. Run it, expect FAIL (show the command and expected error).
3. Write the minimal implementation (show the full code).
4. Run the test, expect PASS.
5. Commit (show the exact `git add` + `git commit -m` commands,
   Conventional Commit message in English).

## Self-review before handing off

- **Spec coverage:** every spec requirement maps to a task; list gaps.
- **Placeholder scan:** no "TBD", no code-free code steps.
- **Type consistency:** names and signatures match across tasks — the
  Produces of task N must be exactly what task M Consumes.
- **Parser dry-run:** run `node <executor>/bin/parse-plan.js <plan>` and
  read the graph — verify the parallelism you designed is the parallelism
  it inferred, and surface any warnings to the user. Open the `graph`
  object itself and check every edge against the DAG you designed, task
  by task — don't stop at skimming for warnings.
  An empty warnings array is not proof the graph is right, only that the
  parser didn't flag anything; a plan-authoring mistake can still produce
  a graph that's silently wrong.
- **Exhaustive-coverage claims:** if the spec states a test suite "covers
  every case in this table" (or similar), the plan's test steps must
  enumerate each row as its own explicit test step — a summary claim
  without one step per row is a gap the plan itself introduced, not
  something later tasks can be trusted to infer.
- **Version/toolchain enforcement:** if Global Constraints pin an exact
  language/runtime version, at least one task must mechanically enforce
  it (a toolchain config, version-check step, or equivalent that fails
  the build on mismatch) — a config file merely declaring the version
  isn't enforcement.

## Hand off

After saving the plan, hand off to execution: on Claude Code, launch
with cys:run (or tell the user to run /cys:run-plan) — do NOT offer
sequential execution as a substitute; parallel execution via the DAG is
the cys default there. On platforms where cys:run isn't available
(Cursor, Gemini CLI), tell the user to execute the plan's tasks
themselves in dependency order, per cys:guide's fallback note.
