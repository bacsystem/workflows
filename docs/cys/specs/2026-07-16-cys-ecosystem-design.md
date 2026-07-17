# cys — Design Spec: Own Skill Ecosystem with Parallel Execution

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan
**Repo:** `parallel-plan-executor` (this repo)

## 1. What and why

**cys** (initials of the author's twin daughters, **C**ielo **y** **S**ophia — the homage
must appear in the README) is this repo's own skill ecosystem for Claude Code: a set of
skills covering the full development methodology — idea → design → plan → parallel
execution → review → PR — with **no dependency on the superpowers plugin**.

Today the repo depends on superpowers in two ways:

1. **Methodology**: plans are designed/written with `superpowers:brainstorming` and
   `superpowers:writing-plans`. When a user asks those skills naturally, they end up
   offered superpowers' *sequential* executors (subagent-driven-development /
   executing-plans) — and `parallel-plan-executor` never runs unless explicitly named.
   This happened in a real pilot run on 2026-07-16.
2. **Machinery**: the workflow's implement/review agents run superpowers'
   `task-brief` and `review-package` scripts, located at runtime by scanning the
   filesystem for the plugin cache (`FIND_SDD_SCRIPTS` — source of pilot finding F7).

cys removes both: own skills for the methodology, own scripts for the machinery. The
differentiator over superpowers is the execution engine — this repo's `Workflow` script
runs independent plan tasks **in parallel** via the dependency DAG, while superpowers
only executes sequentially.

## 2. Decisions (all closed in brainstorming, 2026-07-16)

| # | Decision | Choice |
|---|---|---|
| 1 | Skill brand / prefix | `cys` |
| 2 | Skill names (deliberately distinct from superpowers') | `cys:guide`, `cys:design`, `cys:plan`, `cys:run`, `cys:check`, `cys:ship` |
| 3 | Repo structure | Single repo: `parallel-plan-executor` keeps its technical name and gains `skills/`; cys is the brand of the skills inside |
| 4 | Installation | Formal Claude Code plugin (manifest + own marketplace), installable via `/plugin` — like superpowers, not hand-copied folders |
| 5 | `cys:ship` origin | Migrated/adapted from the author's existing git-flow skill (github.com/bacsystem/skills/git-flow): `type/description` branches, Conventional Commits, SemVer via `scripts/next-version.sh`, PR template, auto-tag on main. All other skills written from scratch — no superpowers text copied |
| 6 | Engine independence | Own `bin/task-brief.js` + `bin/review-package.js` in pure Node (zero deps, tested in `tests/`, task-brief reuses `src/plan-parser.js`). Workflow gains an `executorPath` arg; prompts run `node <executorPath>/bin/...` with exact paths. `FIND_SDD_SCRIPTS` is deleted entirely (kills F7 at the root) |
| 7 | Script language | Node, not `.sh`: parser already tested, single runtime, Windows-safe. (The Workflow script itself must be JS — tool restriction.) |
| 8 | Run-record directory | `.cys/` in the target repo replaces `.superpowers/sdd/` (progress.md ledger, task-N-brief.md, task-N-report.md, review-*.diff, handoff.md — same mechanism, own folder) |
| 9 | Entry points | `/cys` (all-in-one: idea → design → plan → parallel run) + `/cys-run` (plan already exists; replaces `/run-plan`) — **shipped in F3 as `/cys:flow` and `/cys:run-plan`** (plugin commands auto-namespace under `cys:`; see §10 addendum) |
| 10 | Language | Skills in English (read by Claude, better performance, shareable); READMEs bilingual EN/ES — same pattern the repo already uses |
| 11 | Versioning | Single repo SemVer (`package.json`, currently 0.5.2) versions engine + plugin + skills together |
| 12 | Branch topology | Unchanged from today, with `main` naming: `main` ← `develop` ← `feature/<plan>` (integrationBranch) ← `task-N`. PR base defaults to `develop` |

## 3. The skill set

| Skill | Function | Replaces (superpowers) | Origin |
|---|---|---|---|
| `cys:guide` | Index: teaches when to use each cys skill | using-superpowers | New |
| `cys:design` | Idea → approved design spec (one question at a time, 2-3 approaches, spec file + user review gate) | brainstorming | New |
| `cys:plan` | Spec → implementation plan with `### Task N:` blocks and `Consumes`/`Produces` (the format `bin/parse-plan.js` already parses; enforce one-line-per-entry, today a known parser limitation) | writing-plans | New |
| `cys:run` | Execute the plan in parallel — launches the `parallel-plan-executor` Workflow | subagent-driven-development / executing-plans | Engine already exists |
| `cys:check` | Adversarial review / verification conventions used by the workflow's reviewer agents and available standalone | requesting-code-review + verification-before-completion | New |
| `cys:ship` | Handoff: staging, Conventional Commit, SemVer bump, PR creation | finishing-a-development-branch (+ the handoff agent's hand-rolled conventions) | **Migrated from bacsystem/skills git-flow** |

Not carried over (v1): systematic-debugging, receiving-code-review,
dispatching-parallel-agents (the workflow *is* that), writing-skills, using-git-worktrees
(the workflow manages worktrees itself).

## 4. Repo layout (target)

```
parallel-plan-executor/          ← this repo (D:/github/workflows)
├── src/, bin/, workflows/       ← engine (existing; bin/ gains task-brief.js, review-package.js)
├── skills/                      ← NEW: the cys skills
│   ├── guide/  ├── design/  ├── plan/
│   ├── run/    ├── check/   └── ship/
├── commands/                    ← /cys and /cys-run (run-plan.md retired/aliased)
├── <plugin manifest + marketplace files>
└── scripts/, tests/, docs/
```

## 5. Engine changes (fase 1 scope)

1. **`bin/task-brief.js`** — `node bin/task-brief.js <planPath> <taskId> <outDir>`:
   extracts one task's brief from the plan (reusing `src/plan-parser.js`) and writes
   `<outDir>/task-<id>-brief.md`, printing its path. Unit-tested.
2. **`bin/review-package.js`** — `node bin/review-package.js <repoPath> <baseSha>
   <headSha> <outDir>`: writes a diff-package file (diff + metadata) to
   `<outDir>/review-<base>..<head>.diff`, printing its path. Unit-tested.
3. **`executorPath` arg** — new required workflow arg (validated in
   `src/validate-args.js`); the launching command already knows it as `REPO`.
4. **Prompt cleanup** — delete `FIND_SDD_SCRIPTS`; implement/review prompts call the
   scripts by exact path; every `.superpowers/sdd/` path becomes `.cys/`; the handoff
   agent's prompt follows `cys:ship` conventions instead of restating them.
5. **Build + tests** — `npm run build` regenerates the workflow; new tests assert the
   built output contains the exact-path invocations and no filesystem scanning.

## 6. Bootstrap (3 fases)

- **F1 — Engine independence** (§5 above). Planned with superpowers *for the last
  time*; executed with our own workflow (dogfooding from day one).
- **F2 — Plugin + skills**: plugin skeleton (manifest, `skills/`, marketplace);
  migrate git-flow → `cys:ship`; then `cys:design` + `cys:plan`; then `cys:check` +
  `cys:guide`. From here on, each new piece is designed with the cys skills already
  built.
- **F3 — Commands + cut the cord**: `/cys` and `/cys-run`; full end-to-end pilot run
  **without superpowers installed** (the independence proof), logged as a pilot
  bitácora like pilots 1-8. **Descoped from the F3 plan** (see §10 addendum) — the
  independence proof runs as a separate interactive session with the user, not as
  an automated plan task (installing/uninstalling the actual plugin isn't something
  a task-brief can drive).

Pilot project: `D:/github/project-test-plan-executor` (disposable, branch topology
already set up), one small greenfield mini-project per fase.

## 7. `/cys` command behavior (absorbed from the /plan-and-run design)

- Usage: `/cys <repo-path> <idea>` — first token is the absolute repo path, the rest is
  the idea in natural language. Anything missing is asked, never guessed.
- Flow: sanity checks → `cys:design` (against repo-path, not the session cwd) →
  `cys:plan` → parse graph → launch the workflow. **Never offers sequential
  execution** — invoking `/cys` *is* the choice of parallel execution.
- `integrationBranch`: suggested as `feature/<plan-slug>` once the plan exists; user
  confirms or renames. Warn + confirm if the user names `main`/`develop` directly.
- Error handling: dirty working tree or missing repo stops before design; user
  declining the design/plan stops everything (no partial launch); parse errors are
  reported verbatim; working tree is re-checked just before launch; an existing
  integrationBranch prompts continue-or-rename.
- `/cys-run <plan> <repo> <branch>`: today's `/run-plan` behavior, renamed, with the
  same merge-authorization flow (user names the branches; never fabricated).

## 10. F3 addendum (2026-07-17) — naming reconciliation and descoped pilot

Two corrections after F3 shipped, so this document stays ground truth rather than
misleading a future reader:

- **Command names**: §6/§7 above describe flat names `/cys` and `/cys-run`. What F3
  actually shipped is `/cys:flow` (same behavior as the `/cys` described in §7) and
  `/cys:run-plan` (same behavior as `/cys-run`) — plugin commands auto-namespace
  under the plugin name (`cys:`), which turned out better than fighting it with a
  flat alias. Treat every `/cys`/`/cys-run` mention in §6/§7 as `/cys:flow`/
  `/cys:run-plan`.
- **The independence-proof pilot** (§6, F3 bullet) was **descoped from the automated
  F3 plan**: installing/uninstalling the actual superpowers plugin and driving a
  real `/plugin marketplace add` + `/plugin install` flow isn't something a
  task-brief can execute — it needs the user's own Claude Code session. It happens
  as a separate interactive activity with the user after F3 merges, not as one of
  F3's plan tasks. The pilot-9 bitácora entry F3 added documents F1/F2 dogfooding
  retroactively, not this pilot — the independence-proof run gets its own bitácora
  entry when it happens.

## 8. Testing / verification

- `bin/task-brief.js` and `bin/review-package.js`: unit tests in `tests/` (node --test),
  same style as `parse-plan`.
- Built workflow: `tests/build-workflow.test.js` gains assertions for exact-path script
  invocation, `.cys/` paths, and absence of `FIND_SDD_SCRIPTS` text.
- Skills (text, not code): validated by pilot runs with bitácora entries, per the
  repo's established pilot practice.
- Commands: manual end-to-end smoke test per the F3 pilot.

## 9. Out of scope (v1)

- Rewriting the engine as a pure skill (evaluated: would lose background execution,
  resume caching, and reliable concurrency — the Workflow tool stays).
- The deferred engine features from the original design spec §7 (retry-later,
  speculative re-execution).
- Publishing to any public marketplace beyond the repo's own.
