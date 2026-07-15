# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
