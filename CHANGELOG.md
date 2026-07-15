# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-07-15

### Fixed

- **Pilot finding F3 (blocking for real parallel use)**: the harness's
  `isolation: 'worktree'` isolates the *session* repo, not `repoPath` — in the first
  end-to-end run both parallel implementers shared the target repo's single working tree
  and their branches raced (task-2's commit landed on task-1; the agents self-remediated).
  Implement agents now create their **own worktree of the target repo**
  (`git worktree add <repo>/.worktrees/task-N -b task-N`), work entirely inside it, and
  release it when done — which also frees `task-N` for the fix round (the old
  checkout-conflict caveat disappears).
- Pilot finding F4: `task-brief` writes the brief into the agent's cwd; the implement
  prompt now ensures a copy lands under `<repoPath>/.superpowers/sdd/` where the reviewer
  reads it.
- Pilot finding F5: the workflow logs `Task N: started (implement)` when a task begins —
  previously the progress bar only emitted on settlement, leaving the first ~10 minutes
  of a run silent.
- Pilot finding F1: `.gitattributes` forces LF on `workflows/*.js` so the checked-out
  artifact is never rejected by the Workflow permission dialog for CRLF control characters.

## [0.4.1] - 2026-07-15

### Fixed

- The workflow now tolerates `args` delivered as a JSON **string** (observed in the first
  real end-to-end run: the harness handed the script a serialized string, destructuring
  yielded `tasks: undefined` and startup validation aborted with a misleading message).
  The template parses string args before destructuring.

### Added

- `docs/pilots/2026-07-15-pilot-stats-bitacora.md`: logbook of the first real pilot run —
  findings, what worked, what to watch.

## [0.4.0] - 2026-07-15

### Changed

- **BREAKING (args contract)**: the workflow now requires `args.integrationBranch` — the
  branch every `task-<id>` merges into. Previously each merge agent (and the final
  whole-branch review) had to guess "the integration branch"; in a repo with both
  `master` and `develop`, two agents could pick different branches and both report
  MERGED. Startup validation fails fast when the arg is missing or empty, and the merge
  and final-review prompts interpolate the explicit branch name.

## [0.3.0] - 2026-07-15

### Added

- `parsePlanWithDiagnostics`: a `Consumes`/`Produces` line with content but no
  backtick-quoted symbol now emits a warning (surfaced by the CLI on stderr and in the
  JSON `warnings` field) instead of being dropped in complete silence.
- `assertUniqueTaskIds` shared guard: duplicate task ids are now rejected in the parser,
  in `buildGraph`/`buildGraphWithDiagnostics` (the module whose Map actually collapsed
  them), and in the workflow's args validation — one implementation, three entry points.

### Changed

- **Symbol extraction now only considers backtick-quoted spans** in `Consumes`/`Produces`
  lines. Extracting every bare identifier turned prose words ("the", "task", "None") into
  symbols, creating spurious dependencies between unrelated tasks and even false cycles
  that rejected valid plans. `Consumes: None` now parses as an empty list instead of a
  phantom dependency on whichever task "produced" `None` first.

### Fixed

- **fix-vs-merge working-tree race**: fix agents and merge agents each had their own
  serialization queue, but both check out branches in the main repo — they could still run
  concurrently against the same working tree. Both now share a single `enqueueMainRepo`
  queue (a fix blocks a merge and vice versa; the real parallelism lives in the
  implement agents, which run in isolated worktrees).
- Duplicate task ids in a plan are rejected by the parser and by the workflow's args
  validation; previously both tasks silently collapsed into one graph entry and one of
  them never executed.
- Line-range stripping in `Files` entries no longer truncates paths containing colons:
  `C:/legacy/app.py:10-20` now yields `C:/legacy/app.py` instead of `C`.
- The workflow re-checks `BLOCKED`/`NEEDS_CONTEXT` after the fix round (previously only
  after the initial implement), and guards every `agent()` result against `null` (user
  skip or terminal API error) instead of crashing with a cryptic `TypeError`.
- The fix agent now receives the original `baseSha` in its prompt instead of being asked
  to keep a value it was never given, plus guidance for when `task-<id>` is still checked
  out in the implementer's worktree.
- `formatDuration` validates `HH:MM:SS` inputs (they come from free-form agent output) and
  reports `duration unknown` instead of `NaNmNaNs`; the time helpers moved to `src/time.js`
  and are unit-tested and inlined at build time.
- A section header of several bold words (e.g. `**Global Constraints:**`) now terminates
  the previous `**Files:**`/`**Interfaces:**` section during parsing.
- Build hardening: placeholder substitution uses a replacer function so `$&`-style
  patterns in inlined code can't corrupt the artifact; `inline-source` strips multi-line
  imports whole (including a trailing `//` comment) and fails loudly on `export default`,
  re-exports (`export {...}` / `export * from`), and any import form it could not strip —
  previously those shipped invalid syntax that only exploded when the sandbox loaded the
  generated workflow.
- Backtick-quoted file paths in `Consumes`/`Produces` count as a single whole-path symbol;
  tokenizing them made fragments like `src` a symbol shared by half the plan, recreating
  the spurious-dependency problem for path-heavy plans.
- Line-range stripping also handles multi-range suffixes (`:10-20,40-55`), which the 0.3.0
  single-range regex left attached to the path, breaking same-file chaining.
- A bold annotation with trailing text (`**Watch Out:** ...`) inside a section no longer
  terminates it (entries after it were silently dropped); only a bold header occupying the
  whole line does, and header names may now contain digits, hyphens or `&`
  (`**Non-Goals:**`).
- Ledger appends go through the same main-repo queue as fixes and merges (two tasks
  failing simultaneously raced on `.superpowers/sdd/progress.md`), and the ledger line is
  framed in `<line>` tags so quotes in free-form agent text can't break the prompt.
- `formatDuration`/`hhmmssToSeconds` accept 1–2 digit components but validate ranges:
  `10:75:00` now yields `duration unknown` instead of a confidently wrong duration.

## [0.2.1] - 2026-07-15

### Fixed

- `npm run build` (and the build tests) failed on Windows working copies checked out with
  `core.autocrlf=true`: the import/export-stripping regexes were anchored to `\n` and did
  not match CRLF line endings, leaving `import` lines in the built artifact. The inlining
  transform now lives in `scripts/inline-source.js`, normalizes CRLF to LF first (same
  family as the 0.1.0 plan-parser CRLF fix), and is covered by unit tests with both
  line endings.

## [0.2.0] - 2026-07-14

### Added

- `validateWorkflowArgs`: the workflow validates `args` at startup — a cyclic graph or an
  id present in `graph` but missing from `tasks` now fails fast with a clear error instead
  of deadlocking `runDag` silently (the graph arrives as hand-pasted JSON).
- `buildGraphWithDiagnostics`: exposes duplicate-producer warnings when two tasks declare
  the same `Produces` symbol. First producer still wins (warning, not error); the CLI
  prints warnings to stderr and includes a `warnings` field in its JSON output.
- Regression tests for file chaining, args validation, fix serialization, progress
  accounting, duplicate producers, and skip root-cause reporting (16 → 33 tests).

### Changed

- Skip reasons now distinguish a failed dependency from a skipped one and point at the
  task that originally caused the cascade, not the intermediate link.
- Progress accounting is centralized in a `settle()` helper and reconciled after the DAG
  settles, so the progress bar always closes at N/N.

### Fixed

- Tasks touching the same file are serialized as a chain (each depends on the last task
  to touch the file); previously all of them depended on the first toucher and could run
  in parallel against each other, causing avoidable merge conflicts.
- Fix-round agents are serialized through a dedicated queue; they check out branches in
  the main repo, and two concurrent fix rounds could race over the same working tree.

## [0.1.0] - 2026-07-04

### Added

- Initial release: plan parser (`Consumes`/`Produces` blocks, CRLF-safe), dependency
  graph builder with cycle detection, fine-grained DAG scheduler with cascading
  skip-on-failed-dependency semantics, `parse-plan` CLI, and the self-contained
  `parallel-plan-executor` Workflow (implement in isolated worktrees → adversarial
  review → one fix round → serialized merges → final whole-branch review).
