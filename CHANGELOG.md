# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.6.16 — 2026-07-19

Added:

- `examples/hello-parallel/`: a minimal, real, parseable plan whose own
  dependency graph shows genuine inferred parallelism — two independent
  tasks with no edge between them, not a description of parallel
  execution. Tested so it can't silently rot if the parser changes.
- `docs/diagram/flujo-cys-ecosystem.mmd`: a Mermaid diagram of the whole
  5-skill flow (`design → plan → run → check → ship`), each stage's
  input/output artifact, and the two human approval gates. Linked from
  both READMEs and `cys:guide`'s stage table.

Both items originated from the same external code-review prompt (dated
2026-07-19) as the `feat/engine-limits` branch (v0.6.15) — see
`docs/cys/specs/2026-07-19-onboarding-design.md`. Versioned as 0.6.16
(one ahead of the already-open `feat/engine-limits` PR) to avoid a
version-number collision when both merge to `develop`.

## 0.6.14 — 2026-07-19

Added:

- Gemini CLI portability: `gemini-extension.json` makes cys installable
  via `gemini extensions install <url>`, which clones the whole repo and
  auto-discovers the existing `skills/` directory by pure directory-name
  convention — no manifest field, no copying, no symlinks needed (simpler
  than the Cursor port, which needs a `"skills"` path field). Re-verified
  the day before that Gemini CLI's Agent Skills feature (stable since
  v0.44.0) activates in the same conversation thread as a same-shape
  match to Claude Code's Skill tool, not a separate-context subagent as
  first assumed when this was deferred on 2026-07-18.
- "Gemini CLI" install section in both READMEs, alongside the existing
  Claude Code and Cursor ones.

Changed:

- `skills/guide/SKILL.md` and `skills/plan/SKILL.md`: the platform-
  fallback note (what to do when `cys:run` isn't available) now names
  Gemini CLI alongside Cursor instead of Cursor alone — still a single
  shared paragraph, no per-platform fork.

Out of scope (tracked in `.cys/pending.md` if picked up later): porting
`cys:run` itself to Gemini CLI's subagents.

## 0.6.13 — 2026-07-19

Added:

- CI workflow (`.github/workflows/ci.yml`): runs `npm test` and a
  build-sync check (`npm run build` then `git diff --exit-code` against
  the committed `workflows/parallel-plan-executor.js`) on every push/PR
  to `develop`/`main`.
- GitHub issue template for bug reports
  (`.github/ISSUE_TEMPLATE/bug_report.md`), pointing reporters at
  `.cys/pending.md`, `task-N-report.md`, and `review-*.diff` as the most
  useful attachments.
- "Reporting bugs" / "Reportar un bug" section in both READMEs, linking
  to GitHub Issues.
- "See it in action (60 seconds)" / "Viéndolo en acción (60 segundos)"
  section near the top of both READMEs, using real pilot-run timing data.
- Expanded GitHub repo topics.

Changed:

- Credited Christian Bacilio as cys's creator: `author` field in
  `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` (was
  `"bacsystem"`, the org/marketplace identifier — left untouched
  everywhere else), new `author` field in `package.json`, and both
  READMEs now name him where the Cielo y Sophia origin story is told.

## 0.6.12 — 2026-07-18

Fixed:

- `commands/flow.md` / `commands/run-plan.md`: both now ensure
  `<repo-path>/.gitignore` has a `.cys/` entry (adding and committing it
  if missing) right before launching. cys never checked this before —
  it only "worked" in this repo because `.gitignore` here was set up by
  hand. Any other target project had no protection: task briefs/reports,
  review diffs, `handoff.md`, `pending.md`, and `progress.md` were one
  `git add .` away from landing in the project's history. Reported by a
  real user who found 21 untracked `.cys/*` files ready to be committed
  on a project that had never had this checked.

## 0.6.11 — 2026-07-18

Fixed — second retrospective from the Persons CRUD pilot:

- `commands/flow.md` / `commands/run-plan.md`: creating the integration
  branch now uses `git branch --no-track <integration-branch> develop`.
  Without `--no-track`, if the target repo has no local `develop` (only
  `origin/develop`), git resolves `develop` against the remote-tracking
  branch and sets the new branch's upstream to `origin/develop` by
  default — a later `git push` with no explicit refspec from that branch
  would push straight to `develop`. Reported by a real user who hit
  exactly this and had to `--unset-upstream` by hand.

New:

- `cys:plan`'s "Parser dry-run" self-review step now explicitly requires
  checking every edge of the printed `graph` against the DAG you
  designed — an empty `warnings` array is not proof the graph is right,
  only that the parser didn't flag anything.
- `cys:design` gained a principle: environment-dependent constraints
  (blocked binaries, no Docker, etc.) must be verified empirically for
  the current project, not inherited from a different prior spec/pilot.
  Found live: a Java/Spring pilot inherited "Docker probably doesn't
  work" from an unrelated Go pilot's spec without checking — Docker was
  actually available, and the resulting mocks-only test strategy missed
  a real bug (`GlobalExceptionHandler` swallowing exceptions) that only
  an integration test against a real MongoDB could have caught.

## 0.6.10 — 2026-07-18

New — retrospective from the Persons CRUD pilot (Spring Boot/MongoDB, run
on another machine via Claude Code):

- `.cys/state.json` now marks a task `in_progress` with its current
  `phase` (`Implement`/`Review`/`Merge`) as it moves through execution,
  instead of staying `pending` — indistinguishable from "hasn't started"
  — for the task's entire run. Diagnostic only: `bin/plan-remainder.js`'s
  resume semantics are unchanged, only `done` tasks are excluded either
  way.
- Task merges now always run `git merge --no-ff`, so every task leaves an
  explicit merge commit — previously git could silently fast-forward
  depending on execution order, producing an inconsistent history across
  tasks of the same run.
- `skills/check/references/code-standards.md` gained a "Data integrity"
  section: an application-layer-only uniqueness check (no DB unique
  index/constraint) is now an explicit review finding (TOCTOU), even when
  the design spec only ruled out Bean-Validation-style annotations for
  the check.
- `cys:plan`'s self-review gained an "Exhaustive-coverage claims" rule:
  if a spec says a test suite covers every case in a table, the plan must
  enumerate each row as its own test step.
- `cys:plan`'s self-review gained a "Version/toolchain enforcement" rule:
  if Global Constraints pin an exact language/runtime version, at least
  one task must mechanically enforce it, not just declare it in a config
  file.

## 0.6.9 — 2026-07-18

Fixed:

- `src/plan-parser.js`'s `parseInterfaces()` silently dropped a
  `Consumes:`/`Produces:` line with nothing after the colon — indistinguishable
  from an intentional `None`/`N/A`/`nothing` — producing a completely
  empty dependency graph with zero warnings when a plan author nested
  the symbols as sub-bullets instead of writing them flat on the same
  line. Now warns (with a specific hint when a nested sub-bullet follows)
  instead of failing silently. Found and reported, with full repro and a
  requested fix, by a real user writing a plan via `cys:plan`.

## 0.6.8 — 2026-07-18

Fixed:

- `bin/plan-remainder.js` compared plan paths with `path.resolve()`, which
  never touches the filesystem and so can't see through symlinks. On
  macOS, where `/var` is a symlink to `/private/var`, a resumed run's
  `state.json` and the CLI's own `planPath` argument could point at the
  exact same file yet resolve to two different strings, wrongly reporting
  "a different plan." Now compared via `realpathSync(resolve(...))` on
  both sides. Reported by a real user installing cys on macOS.

## 0.6.7 — 2026-07-18

New — cys on Cursor (see `docs/cys/specs/2026-07-18-cursor-portability-design.md`):

- `.cursor-plugin/plugin.json`: the five non-engine skills (`design`,
  `plan`, `check`, `ship`, `guide`) are now installable in Cursor,
  reusing the exact same `skills/` directory as the Claude Code plugin —
  no forked copy to keep in sync.
- `cys:guide` explains what to do when `cys:run` isn't available
  (Cursor, for now): execute a plan's tasks yourself, without the
  automated DAG scheduling, adversarial review, or serialized merging
  that Claude Code's `cys:run` provides.
- `README.md`/`README.es.md` document the new Cursor install path and
  its scope (5 skills, not the parallel engine).

## 0.6.6 — 2026-07-18

New (Fase 4c — see `docs/cys/specs/2026-07-18-fase-4c-manual-retry-guide-design.md`):

- `/cys:run-plan` and `/cys:flow` now offer, right after launching a run,
  ready-to-paste config for a Claude Code Desktop Local Routine that
  checks `.cys/state.json` and resumes the run unattended if it gets cut
  short by a session/token limit. Purely generated text — no engine
  changes, no automatic/silent creation (confirmed not possible with
  currently available tools), and resumed merges still pause for the
  user's own permission click (no authorization is persisted or assumed).

## 0.6.5 — 2026-07-17

New (Fase 4b — see `docs/cys/specs/2026-07-17-fase-4b-state-recovery-design.md`):

- `.cys/state.json`: the engine writes a full per-task status snapshot
  at start and after every task settles, and deletes it only once the
  script reaches its own natural end — its mere presence signals a run
  got cut off before finishing, not that something failed normally.
- `bin/plan-remainder.js`: deterministic CLI that reduces a plan +
  `state.json` to only what's left, for `/cys:run-plan` to resume with.
- `/cys:flow` and `/cys:run-plan` detect leftover `.cys/state.json` and
  offer to resume instead of starting over.

Fixed (post-review, same branch — the whole-branch review's two
Important findings, resolved before merge):

- `bin/plan-remainder.js` now compares `planPath` via resolved paths
  instead of a literal string, so a command's LLM-judged "same plan"
  match (e.g. relative vs. absolute, backslashes on Windows) can't be
  rejected by a stricter downstream check.
- A run interrupted after every task merged but before Final
  Review/Handoff completed can now be resumed: `bin/plan-remainder.js`
  reports `allDone: true` in that case, and `args.finishOnly` (new,
  optional) tells the engine to skip straight to Final Review/Handoff
  instead of requiring a non-empty task list.

Known follow-ups (documented, not yet fixed): the design spec's
`updatedAt` field was dropped from `state.json` without being explicitly
descoped; the initial `state.json` write is mislabeled under the
`Merge` phase; the README doesn't yet document `bin/plan-remainder.js`
or the resume flow.

## 0.6.4 — 2026-07-17

Fixed (Fase 4a — see `docs/cys/specs/2026-07-17-fase-4a-quick-fixes-design.md`):

- `/cys:flow` and `/cys:run-plan` now create the integration branch from
  `develop` if it doesn't already exist, right before launching. Both
  commands previously assumed it existed — a missing branch made the
  first task's merge fail with a confusing "not a valid object name"
  error, found live during the cys independence-proof smoke test.
- The workflow template moved from `workflows/` to `workflows-src/` —
  `cys:parallel-plan-executor` was appearing twice in the installed
  plugin's skill listing because `workflows/` held two files carrying an
  identical `Workflow`-tool `meta` block (the hand-edited template and
  the generated artifact); `workflows/` now holds only the generated file.

## 0.6.3 — 2026-07-17

Changed:

- Progress log lines now name the `task-N` branch explicitly: `Task N:
  started (implement) on branch task-N`, and the settle line reads
  `... — Task N (branch task-N) <label>`. Found useful during the cys
  independence-proof smoke test (first real run against a plugin
  installed from GitHub) — following a run across worktrees or `git log`
  was one mental hop harder without it.

## 0.6.2 — 2026-07-17

New (cys F3 — see `docs/cys/specs/2026-07-16-cys-ecosystem-design.md`):

- `/cys:flow` — the all-in-one plugin command: idea → `cys:design` →
  `cys:plan` → parallel-plan-executor run, with user approval gates at
  every stage. Zero-config via `${CLAUDE_PLUGIN_ROOT}`.
- `skills/check/references/code-standards.md` — clean-code standards;
  the engine's implement **and review** prompts point agents at it by
  exact path, and `cys:check` cites it in its code-quality verdict
  (post-review fix: the doc claims reviewers hold implementations to it —
  now they actually do).
- Pilot 9 bitácora: F9 validated in production; F10 (consent-check
  wording flagged as bypass) and F11 (classifier citing stale assistant
  memory) documented with their fixes.
- `tests/skills.test.js` now guards command frontmatter too.
- Design spec addendum (§10): reconciles `/cys`/`/cys-run` naming with
  the shipped `/cys:flow`/`/cys:run-plan`, and documents that the
  standalone-install independence-proof pilot is descoped from the
  automated plan — it runs as a separate interactive session with the user.

## 0.6.1 — 2026-07-16

New (cys F2 — see `docs/cys/specs/2026-07-16-cys-ecosystem-design.md`):

- The **cys plugin**: `.claude-plugin/plugin.json` + self-hosted marketplace
  (`/plugin marketplace add bacsystem/parallel-plan-executor`, then
  `/plugin install cys@bacsystem`).
- Five skills under `skills/`: `cys:ship` (migrated from the author's
  git-flow skill), `cys:design`, `cys:plan`, `cys:check`, `cys:guide`
  (written from scratch, English).
- `tests/skills.test.js` guards manifests and SKILL.md frontmatter.
- Docs: plugin install section (EN/ES); the external plan-authoring
  dependency demoted from hard requirement to optional (`cys:plan` covers
  it natively now).

Fixed (out-of-plan, same branch):

- `fix(merge)` F10: the merge prompt now affirms the user's authorization
  without instructing agents to skip consent checks — the previous F8
  wording was flagged by the permission classifier as a bypass attempt and
  killed 3 of 5 merge agents mid-run.
- Project `ask` permission rule for `git merge` in `.claude/settings.json`:
  agent merges pause for the user's dialog click instead of being judged
  by the automatic classifier.
- `.gitignore` now covers `.cys/` run records and `.worktrees/`.
- Post-review polish: `skills/ship/README.md` rewritten for its cys:ship
  identity (plugin install, no symlink/auto-tag instructions), `/cys-run`
  references corrected to the real `/cys:run-plan`, `commands/run-plan.md`
  defaults REPO to `${CLAUDE_PLUGIN_ROOT}` (zero-config as a plugin
  command), and `tests/skills.test.js` pins plugin.json version to
  package.json.

## 0.6.0 — 2026-07-16

**BREAKING** (0.x → minor per git-flow rules):

- `args.executorPath` is now required: the absolute path of this clone. The
  implement/review prompts invoke `bin/task-brief.js` and `bin/review-package.js`
  by exact path — no more locating an external plugin's scripts by scanning the
  filesystem (kills pilot finding F7 at the root; F4's copy step is gone too,
  the brief is written straight into the target repo).
- The run record moved from an external plugin's convention to `.cys/`
  (progress.md ledger, task briefs/reports, review packages, handoff.md).
- The engine no longer depends on any external plugin at runtime. Plans
  authored elsewhere still worked as a stopgap until cys F2 shipped
  `cys:plan` natively.

New (cys F1 — see `docs/cys/specs/2026-07-16-cys-ecosystem-design.md`):

- `bin/task-brief.js <plan> <taskId> <outDir>` — extracts one task's block.
- `bin/review-package.js <repo> <base> <head> <outDir>` — commit list + stat + diff.

## [0.5.2] - 2026-07-16

### Docs

- Add `commands/run-plan.md`, a Claude Code slash command template that wraps launching
  the workflow (parse the plan, ask for what's missing, confirm, invoke `Workflow`) so
  users don't have to type the natural-language request by hand every time.
- Document installing it (global `~/.claude/commands/` vs. project-scoped) and using it,
  in both `README.md` and `README.es.md`.
- New "What kind of thing is this?" section in both READMEs: this is a `Workflow`
  script, not a plugin and not a skill — clone it anywhere, Claude Code runs it by
  absolute path.
- Document an **external skill plugin as a hard requirement** (its
  task-orchestration scripts, TDD and code-review skills were used by the
  workflow's agents at the time), including how to install it (`/plugin`) as step 0.
- New "One-time permissions setup (merges)" section: in default mode the native
  Allow/Deny dialog just works; in auto mode add an `ask` rule for `git merge` to the
  target project's `.claude/settings.json`. Corrected the permissions note accordingly:
  `mergeAuthorization` mitigates merge-agent self-blocking (F8) but does **not** bind
  the auto-mode permission classifier, which rejected the relayed text as unverifiable
  in a real run — the deterministic fix is the user-added permission rule.
- Pilot 8 log updated with the full F8 outcome and the proposed F9 (skip merge agent
  when the task branch is already an ancestor of the integration branch).

## [0.5.1] - 2026-07-16

### Fixed

- Merge agents now receive the user's explicit merge authorization
  (`args.mergeAuthorization`) directly in their prompt. Previously, authorization given
  in conversation with the orchestrating session never reached the merge subagent, which
  sometimes self-blocked — reading the account's "merges require human authorization"
  policy from memory — inconsistently between tasks in the same run (pilot 8, finding F8).
- The script-locating helper no longer starts with a whole-filesystem `find /` to
  locate the external plugin's task-orchestration scripts; it now scopes the first
  attempt to the user's home directory, avoiding ~10 minutes of wasted time and
  orphaned background shells per agent on Windows (pilot 8, finding F7).

### Docs

- Added `README.es.md` (Spanish translation) with installation instructions, clarifying
  that the workflow requires Claude Code specifically — not "any AI assistant".
- `README.md`: added Requirements/Installation sections, updated the merge-authorization
  example and permissions note, removed an outdated line contradicting the Handoff phase.

## [0.5.0] - 2026-07-15

### Added

- **Handoff phase**: when at least one task merged, a final agent prepares the git-flow
  closing — a `handoff.md` run-record file with a suggested PR title, full PR body
  (Summary/Type/Main changes/Version/Checklist), the SemVer bump proposed from the run's
  Conventional Commits (git-flow rules incl. `0.x`), the final review verdict, and a
  post-run cleanup checklist. Adopted from the user's `ign-workflow` FASE 7 contract.
- **`args.openPr` (optional boolean)**: with explicit consent given at launch, the
  handoff agent pushes the integration branch and **creates** the PR via `gh` against
  `pr.base` (default `develop`), applying the optional `pr` fields (`assignees`,
  `labels`, `milestone`, `closes`). It never merges the PR — that gate stays human.
- Startup validation covers the new args: `openPr` must be a boolean, `pr` an object.
- The workflow's return value now includes `handoff` (file path, proposed bump, PR URL).

## [0.4.3] - 2026-07-15

### Fixed

- The `results` object returned by the workflow now carries each failed task's error
  **message** instead of a raw JS `Error` that serialized to `{}` (observed in pilots 2
  and 5 — the cause survived only in logs and the ledger, not in the programmatic result).

### Added

- README: documents that `task-<id>` branches of failed/BLOCKED tasks deliberately
  survive the run for diagnosis, with the cleanup command.

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
  prompt now ensures a copy lands under the target repo's run-record directory where
  the reviewer reads it.
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
  failing simultaneously raced on the same ledger file), and the ledger line is
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
