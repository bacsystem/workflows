# Contributing to parallel-plan-executor (cys)

## The one rule that matters

Every behavior change ships with a test that traces to a real finding
or a concrete motivation, and a comment explaining *why* — not what the
code does, which the code itself already says. This repo has no
"nice to have" tests or "just in case" comments. Two real examples
already in the codebase:

- `src/graph-builder.js`'s duplicate-producer warning carries a comment
  explaining *why* it's a warning and not a hard error: "no impide
  ejecutar, pero el usuario debe enterarse en vez de que se resuelva en
  silencio por orden de aparición."
- Test names across `tests/*.test.js` frequently cite the pilot or
  finding that motivated them (e.g. `"...hallazgo real de persons-crud"`,
  `"pilot 8, F8"`) — a test with no traceable motivation is a smell,
  not a contribution.

If you're not sure a change is justified by a real finding, it probably
isn't ready yet. Speculative hardening for a scenario nobody has hit is
a request for discussion, not a PR.

## Workflow

1. **TDD, strictly**: write the failing test, confirm it fails for the
   reason you expect, write the minimal implementation, confirm it
   passes, then run the full suite (`npm test`).
2. **One commit per fix or feature**, Conventional Commits, in English
   (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, ...).
3. **Never hand-edit `workflows/parallel-plan-executor.js`** — it's
   generated. After touching any of the inlined modules
   (`src/scheduler.js`, `src/graph-builder.js`, `src/validate-args.js`,
   `src/time.js`) or `workflows-src/parallel-plan-executor.template.js`,
   run `npm run build` and commit both the source and the regenerated
   file. CI checks `git diff --exit-code workflows/parallel-plan-executor.js`
   after a fresh build — a stale generated file fails the build.
4. **Check for an open PR against the same base branch before opening a
   new one**: `gh pr list --state open --base develop`. Parallel PRs
   touching `commands/`, the version files (`package.json`,
   `CHANGELOG.md`, the `plugin.json`s, `gemini-extension.json`), or the
   workflow template have caused real merge conflicts and version-number
   collisions — coordinate instead of racing.

## Architecture, in one paragraph

This repo is split in two halves by necessity: the Claude Code
`Workflow` sandbox has no filesystem access and can't use
`Date.now()`/`new Date()`. So plan parsing and dependency-graph
inference (`src/plan-parser.js`, `src/graph-builder.js`,
`bin/parse-plan.js`) are pure Node, fully unit-tested, run *outside* the
sandbox. The actual parallel execution
(`workflows/parallel-plan-executor.js`) runs *inside* the sandboxed
`Workflow` tool and is generated from
`workflows-src/parallel-plan-executor.template.js` by inlining the
shared modules above — see rule 3.

## Running the tests

```
npm test                            # everything
node --test tests/scheduler.test.js # one file
npm run build                       # regenerate workflows/parallel-plan-executor.js
```

Requires Node >= 20.
